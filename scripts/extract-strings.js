/**
 * Find every piece of user-facing Devanagari text in the app.
 *
 *   npm run i18n:extract          list strings with no translation
 *   npm run i18n:extract -- --all dump every string found
 *
 * The UI was written in Hindi, so the Hindi text IS the message key. That
 * makes the catalogue self-checking: this walks the source, collects every
 * literal containing Devanagari, and reports the ones `en` or `gu` has not
 * translated yet. A missing translation is a listed line here rather than a
 * surprise on screen.
 */

import fs from 'node:fs';
import path from 'node:path';

import enBase from '../src/i18n/en.js';
import enApps from '../src/i18n/en.apps.js';

const en = { ...enBase, ...enApps };
import gu from '../src/i18n/gu.js';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const DEVANAGARI = /[ऀ-ॿ]/;

function files(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'i18n' || entry.name === 'node_modules') continue;
      files(full, out);
    } else if (
      /\.jsx?$/.test(entry.name) &&
      !entry.name.endsWith('.test.js') &&
      // Master DATA, not UI text — states, districts, relations. It is seeded
      // into the masters screen and edited there, in whatever language the
      // trust uses. Translating a village name is not a UI concern.
      entry.name !== 'staticData.js'
    ) {
      out.push(full);
    }
  }
  return out;
}

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const jsx = require('acorn-jsx');
const Parser = acorn.Parser.extend(jsx());

/**
 * Every string literal and JSX text run containing Devanagari.
 *
 * Parsed, not matched with a regex. The first version of this used one and it
 * swallowed entire files: a quote inside a comment ran the match on to the
 * next quote three hundred lines later, and the "strings" it reported were
 * whole blocks of source. A parser knows what a string is.
 */
function stringsIn(code) {
  const found = new Set();

  let ast;
  try {
    ast = Parser.parse(code, {
      ecmaVersion: 'latest', sourceType: 'module', locations: false,
    });
  } catch {
    return found; // a file that does not parse is the checker's problem
  }

  const keep = (value) => {
    const text = String(value ?? '').trim();
    if (text && DEVANAGARI.test(text)) found.add(text);
  };

  walk(ast, (node, parent) => {
    if (node.type === 'Literal' && typeof node.value === 'string') {
      // Import paths and object keys are not user-facing text.
      if (parent?.type === 'ImportDeclaration') return;
      if (parent?.type === 'Property' && parent.key === node) return;
      keep(node.value);
    } else if (node.type === 'TemplateElement') {
      keep(node.value.cooked);
    } else if (node.type === 'JSXText') {
      keep(node.value);
    }
  });

  return found;
}

function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, node);
    } else if (value && typeof value.type === 'string') {
      walk(value, visit, node);
    }
  }
}

const all = new Map(); // string -> Set of files

for (const file of files(SRC)) {
  for (const s of stringsIn(fs.readFileSync(file, 'utf8'))) {
    if (!all.has(s)) all.set(s, new Set());
    all.get(s).add(path.relative(ROOT, file));
  }
}

const showAll = process.argv.includes('--all');
const sorted = [...all.keys()].sort();

const missingEn = sorted.filter((s) => !en[s]);
const missingGu = sorted.filter((s) => !gu[s]);

if (showAll) {
  for (const s of sorted) {
    console.log(`${en[s] ? '✓' : '·'}${gu[s] ? '✓' : '·'}  ${JSON.stringify(s)}`);
  }
  console.log('');
}

if (missingEn.length) {
  console.log(`\n── ${missingEn.length} without English ──`);
  for (const s of missingEn.slice(0, 400)) {
    console.log(`  ${JSON.stringify(s)},`);
  }
}

if (missingGu.length) {
  console.log(`\n── ${missingGu.length} without Gujarati ──`);
  for (const s of missingGu.slice(0, 400)) {
    console.log(`  ${JSON.stringify(s)},`);
  }
}

console.log(
  `\n${sorted.length} strings · ${sorted.length - missingEn.length} English · ` +
  `${sorted.length - missingGu.length} Gujarati`,
);
