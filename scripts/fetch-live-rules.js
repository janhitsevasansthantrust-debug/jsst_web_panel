/**
 * Download the rules CURRENTLY DEPLOYED to your Firebase project.
 *
 *   npm run rules:fetch
 *
 * Why this exists: your rules were written in the Firebase console, so they
 * live nowhere in either repo. `firebase deploy --only firestore:rules`
 * REPLACES them wholesale — and the old app still reads Firestore straight
 * from the browser under `users/**`, in this SAME project, so a careless
 * deploy locks its users out with no copy of what was there before.
 *
 * This writes what is live to `firebase-rules-backup/`, so you can diff it
 * against the new files and merge the legacy block deliberately.
 *
 * Read-only. It never deploys anything.
 */

import fs from 'node:fs';
import path from 'node:path';

import { adminApp } from '../src/server/firebase/admin.js';

const OUT_DIR = 'firebase-rules-backup';

/**
 * firebase-admin's Credential returns a `GoogleOAuthAccessToken`, whose field
 * is `access_token` — NOT `token`. Destructuring the wrong name silently gives
 * `undefined`, which becomes the header `Authorization: Bearer undefined`, and
 * Google answers 401 UNAUTHENTICATED rather than anything that hints at the
 * real cause. Accept either shape and fail loudly if neither is present.
 */
async function accessToken() {
  const result = await adminApp.options.credential.getAccessToken();
  const token = result?.access_token ?? result?.token;

  if (!token) {
    throw new Error(
      'Could not obtain an access token from the service account. ' +
      `Got: ${JSON.stringify(result)}`,
    );
  }
  return token;
}

async function api(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`${response.status} ${response.statusText}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return response.json();
}

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set in .env.local');

  console.log(`\nProject: ${projectId}`);
  console.log(`Service account: ${process.env.FIREBASE_CLIENT_EMAIL}\n`);

  const token = await accessToken();

  const { releases = [] } = await api(
    `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`,
    token,
  );

  if (!releases.length) {
    console.log('No rules releases found — nothing is deployed yet.');
    console.log('That means deploying these files is safe.\n');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  for (const release of releases) {
    // e.g. projects/x/releases/cloud.firestore  →  cloud.firestore
    const service = release.name.split('/releases/')[1] ?? 'unknown';

    const ruleset = await api(
      `https://firebaserules.googleapis.com/v1/${release.rulesetName}`,
      token,
    );

    for (const file of ruleset.source?.files ?? []) {
      const safe = service.replace(/[^\w.-]/g, '_');
      const out = path.join(OUT_DIR, `${safe}.${stamp}.rules`);
      fs.writeFileSync(out, file.content);

      const lines = file.content.split('\n').length;
      console.log(`✓ ${service}`);
      console.log(`    updated ${release.updateTime}`);
      console.log(`    saved   ${out}  (${lines} lines)\n`);
    }
  }

  console.log(`Backups are in ./${OUT_DIR}/\n`);
  console.log('Next: open the cloud.firestore backup, and copy anything that');
  console.log('protects `users/**` into the LEGACY block of firestore.rules');
  console.log('before you deploy. Otherwise the old app may break.\n');
}

main().catch((error) => {
  console.error('\n✗ Failed:', error.message);

  if (error.status === 401) {
    console.error(
      '\n  401 means the request carried no usable token at all.\n' +
      '  Check FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL in .env.local.',
    );
  } else if (error.status === 403) {
    console.error(
      '\n  403 means the credentials are valid but not allowed to read rules.\n' +
      '  Give the service account the "Firebase Rules Viewer" role in\n' +
      '  Google Cloud Console → IAM, or just read the rules in the Firebase\n' +
      '  console and paste them into firestore.rules yourself.',
    );
  } else if (error.status === 404) {
    console.error(
      '\n  404 — the Firebase Rules API may not be enabled for this project.\n' +
      '  Enable it at:\n' +
      '  https://console.cloud.google.com/apis/library/firebaserules.googleapis.com',
    );
  }

  if (error.body) console.error(`\n  Response: ${error.body.slice(0, 400)}`);
  console.error(
    '\n  Either way you are not stuck: open the Firebase console →\n' +
    '  Firestore → Rules, copy what is there, and paste it into the LEGACY\n' +
    '  block at the bottom of firestore.rules. That is all this script does.\n',
  );
  process.exit(1);
});
