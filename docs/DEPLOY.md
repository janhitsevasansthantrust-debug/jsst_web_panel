# Deploying rules & indexes

Four files were added:

| file | what it does |
|---|---|
| `firestore.rules` | who may touch Firestore from a browser |
| `firestore.indexes.json` | every composite index the app's queries need |
| `storage.rules` | who may upload photos and documents |
| `firebase.json` | tells the Firebase CLI where those three live |

---

## ⚠️ Read this before your first deploy

Your rules were written in the **Firebase console**, so they exist nowhere in
either repo. `firebase deploy` **replaces** what is live — it does not merge.

Your old app (`D:\Development\trust-app`) still reads Firestore **directly from
the browser** under `users/**`, and its members sign in as `regNo@gmail.com`.
Deploy the new rules without checking, and those users can be locked out with
no copy of what was there before.

So the first step is always:

```powershell
npm run rules:fetch
```

That downloads the currently-deployed rules into `firebase-rules-backup/`,
read-only. Open the `cloud.firestore` file, and copy anything protecting
`users/**` into the **LEGACY** block at the bottom of `firestore.rules`.

The placeholder in that block is deliberately loose about reads
(`request.auth != null`, not `request.auth.uid == userId`) precisely because
the old app has members reading the *admin's* subtree. Tightening that is what
would break them.

---

## One-time setup

```powershell
npm install -g firebase-tools
firebase login
firebase use --add          # pick your project, alias it "default"
```

`firebase use --add` writes `.firebaserc`, which is gitignored — it just
records which project this folder deploys to.

---

## Deploying

Indexes first. They are additive and cannot break anything:

```powershell
firebase deploy --only firestore:indexes
```

Large collections take a few minutes to build; the console shows progress. A
query whose index is still building fails with `FAILED_PRECONDITION`, so wait
for green before deploying rules.

Then storage, then Firestore rules last (the riskiest):

```powershell
firebase deploy --only storage
firebase deploy --only firestore:rules
```

Check the old app still works before moving on. If anything breaks, restore
from `firebase-rules-backup/` — paste it back in the console, which is instant.

---

## What the rules actually say

### Firestore: the new system is fully closed

```
match /trusts/{trustId}/{document=**} {
  allow read, write: if false;
}
```

That is not an oversight — it is the security model.

The browser never queries Firestore in this system. `lib/firebase/client.js`
exports only Auth and Storage; there is no Firestore client at all. Every read
and write goes through a Next.js route handler using `firebase-admin`, which
runs with full privileges and **bypasses these rules entirely**.

So denying all client access costs nothing and removes a whole class of
problem: no rule can be quietly too permissive, no client can craft a query
that reads another trust's members, and the read count stays bounded because
there is no path to an unbounded client query. Authorisation lives in
`server/auth/session.js`, where it can check the verified session cookie, the
role and the trust — things rules express poorly.

### Storage: this one does real work

Photos and documents **are** uploaded straight from the browser, so
`storage.rules` is the only client-facing rule set that matters. It requires a
signed-in user, caps uploads at 15 MB, restricts content types to images and
PDFs, and **denies deletes** — a photo may be referenced by a printed receipt,
and a mis-click must not destroy it.

---

## The index file, and one thing worth understanding

Indexes use `queryScope: "COLLECTION"` with a `collectionGroup` name, so one
entry covers that collection under **every** trust and program. You never add
indexes when a new trust or योजना is created.

The `fieldOverrides` at the bottom are a genuine cost saving, not tidiness:

```json
{ "collectionGroup": "members", "fieldPath": "paidSeqs", "indexes": [] }
```

Firestore indexes **every element of an array separately**. A member who has
paid 300 closings out of order carries 300 entries in `paidSeqs` — so a single
write to that member would also write 300 index entries, and index storage
grows with it. We never query by `paidSeqs`; it is read as part of the member
document and computed over in memory. Turning its index off makes every payment
meaningfully cheaper.

Note the contrast on `payments`: `items` is index-exempt (never queried) while
`seqs` keeps its index, because `revertClosing` does
`where('seqs', 'array-contains', seq)`. That is exactly why the two are
separate fields — one is for display, one is for the single query that makes a
revert touch a few hundred payers instead of millions of rows.

---

## Adding a query later

If you add a query without its index, Firestore fails with an error containing
a one-click console link. Clicking it creates the index — **but the next
`firebase deploy --only firestore:indexes` will delete it again**, because the
file is the source of truth. Always add it to `firestore.indexes.json` too.

---

## Emulators (optional)

`firebase.json` is already configured:

```powershell
firebase emulators:start
```

Auth on 9099, Firestore on 8080, Storage on 9199, UI on 4000. Useful for
testing rules changes without touching live data.

## Migrating to the flat members collection

Members moved out of `trusts/{t}/programs/{p}/members` into `trusts/{t}/members`, with `programId` as a field (§3.1 of ARCHITECTURE.md). If you created members before that change, move them across:

```bash
npm run deploy:indexes                            # the new composite indexes first
npm run migrate:flatten -- --trust <trustId>          # dry run — writes nothing
npm run migrate:flatten -- --trust <trustId> --apply  # copy + rebuild the index
```

Deploy the indexes **before** migrating: the migration finishes by rebuilding the search index, and a query whose index is still building fails with `FAILED_PRECONDITION`.

The migration preserves document ids, skips any member already present in the flat collection, and **deletes nothing**. The old sub-collections stay exactly where they are — check the members list works, then remove them from the Firebase console yourself. Re-running it is safe.

If the list ever looks out of step with reality — a payment taken but the member still showing a due — rebuild the index rather than guessing:

```bash
npm run reindex -- --trust <trustId>
```

Nothing in `firestore.rules` changed: `trusts/{trustId}/{document=**}` already denied all browser access, and the new collection sits under it.
