/**
 * Static check: syntax, path resolution, AND named-export existence.
 *
 *   npm run check
 *
 * The third one is the point, and it exists because of a real bug.
 *
 * An edit to `config/schemas.js` replaced a block that happened to span
 * `programCreate`, silently deleting it. The import in
 * `api/programs/route.js` still resolved — the FILE was there — and every file
 * still parsed. Nothing caught it until the dev server tried to link the
 * modules and threw "Export programCreate doesn't exist in target module",
 * in the browser, in front of the user.
 *
 * A missing named export is invisible to a syntax check and to a path check.
 * It needs the exports of every module compared against what every other
 * module asks for, which is what this does.
 *
 * Not a substitute for `next build` — it does not typecheck or run anything.
 * It is the fast check worth running after any bulk edit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let Parser;
try {
  const acorn = require('acorn');
  const jsx = require('acorn-jsx');
  Parser = acorn.Parser.extend(jsx());
} catch {
  console.error(
    'This check needs acorn and acorn-jsx:\n' +
    '  npm install -D acorn acorn-jsx\n',
  );
  process.exit(1);
}

const ROOT = process.argv[2] ?? process.cwd();

function walk(d, out = []) {
  if (!fs.existsSync(d)) return out;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.(js|jsx|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'scripts'))];

const GLOBALS = new Set([
  // Language
  'undefined', 'NaN', 'Infinity', 'globalThis', 'arguments', 'this',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Math', 'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError',
  'SyntaxError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Proxy',
  'Reflect', 'Intl', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'structuredClone', 'queueMicrotask',
  // Runtime
  'console', 'process', 'Buffer', 'URL', 'URLSearchParams', 'TextEncoder',
  'TextDecoder', 'AbortController', 'AbortSignal', 'fetch', 'Request',
  'Response', 'Headers', 'FormData', 'Blob', 'File', 'ReadableStream',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
  'crypto', 'performance', 'require', 'module', 'exports', '__dirname',
  '__filename',
  // Browser
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage',
  'location', 'history', 'HTMLElement', 'Image', 'FileReader', 'Event',
  'CustomEvent', 'IntersectionObserver', 'ResizeObserver', 'MutationObserver',
  'createImageBitmap', 'getComputedStyle', 'alert', 'confirm', 'prompt',
  // JSX
  'React',
]);

const exportsOf = new Map();   // file -> Set of export names ('default' included)
const importsOf = [];          // {from, spec, names:[{imported, line}], line}
let syntaxErrors = 0;
let undefinedNames = 0;

for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  let ast;
  try {
    ast = Parser.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (err) {
    syntaxErrors++;
    console.log(`SYNTAX  ${path.relative(ROOT, f)}:${err.loc?.line} ${err.message}`);
    continue;
  }

  const names = new Set();
  for (const n of ast.body) {
    if (n.type === 'ExportDefaultDeclaration') names.add('default');
    else if (n.type === 'ExportNamedDeclaration') {
      if (n.declaration) {
        if (n.declaration.type === 'VariableDeclaration') {
          for (const d of n.declaration.declarations) {
            if (d.id.type === 'Identifier') names.add(d.id.name);
          }
        } else if (n.declaration.id) names.add(n.declaration.id.name);
      }
      for (const sp of n.specifiers ?? []) names.add(sp.exported.name);
    } else if (n.type === 'ExportAllDeclaration') names.add('*');

    if (n.type === 'ImportDeclaration' && n.source.value.startsWith('.')) {
      importsOf.push({
        from: f,
        spec: n.source.value,
        line: n.loc.start.line,
        names: n.specifiers.map((sp) => ({
          imported:
            sp.type === 'ImportDefaultSpecifier' ? 'default'
            : sp.type === 'ImportNamespaceSpecifier' ? '*'
            : sp.imported.name,
        })),
      });
    }
  }
  exportsOf.set(f, names);

  // ── undefined identifiers ────────────────────────────────────────────────
  //
  // A name that is used but declared NOWHERE in the file, and is not imported
  // and not a global. This is the class of bug that survives every other check
  // here: `npm run check` was clean, the imports all resolved, and
  // `filterMembers` still called a `norm()` that had been moved to another
  // file — which only showed up when a test ran that exact line.
  //
  // Deliberately permissive: "declared somewhere in this file" counts,
  // whatever the scope. Real scope analysis would catch shadowing bugs too,
  // but it would also need to be right about closures and hoisting, and a
  // checker that cries wolf gets switched off.
  const declared = new Set();
  const used = [];

  walkAll(ast, (node, parent) => {
    switch (node.type) {
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
      case 'ImportSpecifier':
        declared.add(node.local.name);
        return;
      case 'VariableDeclarator':
        collectPattern(node.id, declared);
        return;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (node.id) declared.add(node.id.name);
        for (const param of node.params ?? []) collectPattern(param, declared);
        return;
      case 'CatchClause':
        if (node.param) collectPattern(node.param, declared);
        return;
      case 'Identifier':
        if (isReference(node, parent)) used.push(node);
        return;
      default:
    }
  });

  for (const node of used) {
    if (declared.has(node.name) || GLOBALS.has(node.name)) continue;
    undefinedNames++;
    console.log(
      `UNDEF   ${path.relative(ROOT, f)}:${node.loc.start.line}  ` +
      `"${node.name}" is used but never declared or imported`,
    );
  }
}

/** Every name a destructuring or default pattern binds. */
function collectPattern(node, out) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier': out.add(node.name); break;
    case 'ObjectPattern':
      for (const prop of node.properties) {
        collectPattern(prop.value ?? prop.argument, out);
      }
      break;
    case 'ArrayPattern':
      for (const el of node.elements) collectPattern(el, out);
      break;
    case 'AssignmentPattern': collectPattern(node.left, out); break;
    case 'RestElement': collectPattern(node.argument, out); break;
    default:
  }
}

/**
 * Is this Identifier a VALUE being read?
 *
 * `a.b` reads `a` but not `b`; `{ b: 1 }` reads neither; a label is neither.
 * Getting this wrong in the permissive direction only costs a missed bug;
 * getting it wrong the other way fills the output with noise.
 */
function isReference(node, parent) {
  if (!parent) return true;

  // `a.b` reads `a`, not `b`.
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;
  // `{ b: 1 }` — the key is a name, not a value being read.
  if (parent.type === 'Property' && parent.key === node && !parent.computed) return false;
  // `class X { constructor() {} }` — likewise.
  if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') &&
      parent.key === node && !parent.computed) return false;

  // `import { ref as storageRef }` — `ref` is a name in the OTHER module.
  if (parent.type === 'ImportSpecifier' && parent.imported === node) return false;
  if (parent.type === 'ExportSpecifier') return false;

  // `import.meta`
  if (parent.type === 'MetaProperty') return false;

  if (parent.type === 'JSXAttribute' || parent.type === 'JSXIdentifier') return false;
  if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' ||
      parent.type === 'ContinueStatement') return false;

  return true;
}

/** Walk every node, handing each one its parent. */
function walkAll(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walkAll(child, visit, node);
    } else if (value && typeof value.type === 'string') {
      walkAll(value, visit, node);
    }
  }
}


function resolve(from, spec) {
  const r = path.resolve(path.dirname(from), spec);
  for (const c of [r, r + '.js', r + '.jsx', path.join(r, 'index.js')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

let unresolved = 0, missingExports = 0;

for (const imp of importsOf) {
  const target = resolve(imp.from, imp.spec);
  if (!target) {
    unresolved++;
    console.log(`PATH    ${path.relative(ROOT, imp.from)}:${imp.line}  cannot resolve "${imp.spec}"`);
    continue;
  }
  const available = exportsOf.get(target);
  if (!available || available.has('*')) continue;

  for (const { imported } of imp.names) {
    if (imported === '*') continue;
    if (!available.has(imported)) {
      missingExports++;
      console.log(
        `EXPORT  ${path.relative(ROOT, imp.from)}:${imp.line}  ` +
        `"${imported}" is not exported by ${path.relative(ROOT, target)}`,
      );
    }
  }
}

console.log(
  `\n${files.length} files · ${syntaxErrors} syntax · ${unresolved} bad paths · ` +
  `${missingExports} missing exports · ${undefinedNames} undefined names`,
);
process.exit(
  syntaxErrors + unresolved + missingExports + undefinedNames > 0 ? 1 : 0,
);
