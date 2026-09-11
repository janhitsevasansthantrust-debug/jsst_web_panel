<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Trust Management System — working rules

Read `docs/ARCHITECTURE.md` first. It explains why this system is shaped the
way it is. The rules below are the short version, and they are not negotiable —
each one exists because the previous version of this system broke without it.

## Next.js 16 specifics

- Middleware is called **Proxy** now: `src/proxy.js`, exporting `proxy`.
- Route handler `context.params` is a **Promise** — `const { id } = await context.params`.
- Route handlers are **not cached** by default. Opt in deliberately.
- The project is **ESM** (`"type": "module"`). Use `import`, include the `.js`
  extension in relative imports.

## The five rules

**1. The browser never queries Firestore.**
`src/lib/firebase/client.js` exports auth and storage only — deliberately no
Firestore. Every list, every count, every report goes through a route handler
so the read count is visible, projected, paginated and cacheable. This single
rule is most of why the new system is ~1000× cheaper than the old one.

**2. Obligations are derived, never stored.**
Never create a document per (member × closing). If you find yourself writing a
loop over members to record what they owe, stop — that is the 2.5-million-row
mistake the rewrite exists to undo. Eligibility comes from
`ledger.isEligible()` and nothing else.

**3. Money moves only inside a transaction.**
Never `batch.update()` a payment. Receipt + member ledger + closing counters +
program stats + commission entry are written together or not at all. The server
re-reads the member inside the transaction and decides for itself what is due —
the browser's list of seqs is a *request*, never the decision.

**4. Nothing that records money is ever deleted.**
Cancel, revert, reverse — always with a reason, an author and an audit log
entry. A closing that is reverted keeps its document and retires its seq.

**5. `ledger.js` and `commission.js` stay pure.**
No Firestore, no `Date.now()`, no I/O. They are the only two files where a bug
silently costs the trust real money, so they must stay testable in isolation.
Add a test to `ledger.test.js` for every rule you touch.

## Scale targets

Design every screen against these numbers, and check the read count:

| | |
|---|---|
| members | 5,000 |
| closings | 500 |
| derived obligations | 2,500,000 (**stored: 0**) |
| reads for the dashboard | **2** |
| reads for a member's full ledger | **2** |
| reads for one page of members | **50** |
| reads for member search | **5** (cached to 0) |

If a change makes any of those grow with the size of the trust, it is wrong.

## Multi-trust

Everything is under `trusts/{trustId}/…` and all branding — logo, header lines,
seal, signature, colours, receipt prefix — is **data** in the trust document.
Never hardcode a trust's name, logo or address anywhere, and never inline an
image or font as base64 in a source file (the old project shipped 1.4 MB of
base64 in its bundle). Giving the system to another trust must stay: insert one
document, upload a logo.

## Language

The UI is Hindi-first with English fallbacks. Keep Devanagari fonts as real
`.ttf` files in `/public/fonts`, registered once server-side for PDFs.

## Commands

```bash
npm run dev            # dev server
npm test               # ledger + commission unit tests — run before every commit
npm run migrate:verify # reconciliation report against the old Firebase project
npm run reindex        # rebuild the closings + members index documents
```
