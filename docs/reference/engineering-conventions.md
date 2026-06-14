# Engineering Conventions

Durable engineering rules for **contributors to this toolkit** (the `.claude/core/` Node code and its tests). These are NOT adopter-facing guidance — they describe how the toolkit's own internals are built and tested. Promoted from the agent-memory store (`/sweep` 2026-06-06) so they survive memory decay and are discoverable in review.

## Code patterns

### Constants stay static — override at the call site, identically

Never read `process.env` inside a constants module (e.g. `.claude/core/constants.js`). A `process.env` read at module-load time makes `require()` of that module non-deterministic across tests — the value is captured once at first load and frozen.

When a constant needs an env override:
- Define the **static default** in the constants module.
- Apply the override with an **identical expression at each call site**.
- When two or more files consume the same overridable constant, the call-site expression must be **byte-identical** so the sites can never diverge.

*Why:* the per-category memory cap once drifted between two hardcoded `50`s; a downstream project raised one to `100` and the two silently disagreed (MP-1.1/MP-2.1, memory-performance-analysis, 2026-06-03).

### Additive SQLite migrations go through one idempotent `ensureColumn` seam

To add a column to a table created with `CREATE TABLE IF NOT EXISTS`, route **every** additive migration through one reusable helper — `ensureColumn(table, column, ddl)` — that checks `PRAGMA table_info(table)` and only runs `ALTER TABLE ADD COLUMN` when the column is absent.

Do **not** use a blind per-migration `try/catch`-on-duplicate-column. Two divergent idempotency strategies in one `initDb` are the hardest adopter-DB bug to debug, and a swallowed `ALTER` error leaves a column missing while reads silently default.

*Why:* the `importance` column was added this way (ME-2.1); `invalid_at`/`superseded_by` extend the **same** helper (ME-3.1). The backend-agnostic test simulates a pre-migration DB via `ALTER TABLE DROP COLUMN`.

### A union/`-X union` merge of two `.claude` trees silently DUPLICATES idempotent constructs

Resolving a merge of two divergent `.claude` trees with `git merge -X union` (or a union driver) concatenates both sides instead of conflicting where the content is *idempotent*: identical top-level function definitions, and repeated hook entries inside one `settings.json` matcher block. The code still **runs correctly** (JS last-definition-wins; duplicate hook entries are idempotent) and the **gate still passes**, so neither tests nor build flag the duplication — it accretes silently across syncs.

Do not trust a clean union merge of `.claude` files. After any union-merged sync, scan for duplicated function definitions and repeated hook entries and de-dupe by hand; prefer an explicit three-way resolution over a union driver for `settings.json` and core scripts.

*Why:* surfaced consolidating divergent template trees; the gate's green is a false-negative here because duplication is behavior-preserving (memory `union-merge-duplicates-idempotent-code`).

## Testing conventions

### A stub must assert the real subsystem's contract, not just the call

When a test stubs a subsystem call, assert the **invariant the real dependency would enforce** — not merely that the call was made.

*Why:* `install.js` stubbed `scaffold` and 42 tests passed while a CRITICAL bug sailed through — `--force` forwarded into `scaffold` would clobber the adopter's root `.gitignore` — because no test asserted what `scaffold` does to the filesystem under `force`. Stub the call **and** assert the filesystem/state invariant.

### Testing an env override of a module-load-time const: reload the require cache

A top-level `const` that reads `process.env` once at require time is frozen at first load — setting `process.env` mid-test does nothing. To test the override:

1. Delete the module from `require.cache`.
2. Set the env var.
3. Re-`require` to get a fresh module with the new value.
4. **Always** restore env + cache in a `finally` block so the reload can't leak the overridden value into sibling tests.

Notes:
- With `createRequire()` bridges (ESM test files loading CJS), `vi.resetModules()` does **not** help — it resets the Vite registry, not the CJS require cache.
- Close any DB handle the reloaded instance opened before tmp cleanup.

*Why:* the full suite stayed green afterward, proving the reload didn't leak `cap=2` into other describe blocks (MP-2.1, 2026-06-03).

## Publishing & fleet-sync conventions

### `publish.js` ships `__tests__/`; `template-updater.js` skips them — a one-way trapdoor

The two propagation paths have **asymmetric coverage of test sources**:
- **First publish** (`publish:public` / `tools/publish.js`) is a full copy and **ships test files** (so adopters can run `npm test`).
- **Incremental sync** (`template-updater.js update --merge`) **excludes `__tests__/` and `_helpers/`** (`ALWAYS_SKIP_DIRS`) to protect adopter customizations.

Consequence: anything hardcoded in a `__tests__/` file — an absolute path, a username, a secret, a machine-specific value — **leaks into every first-published adopter and is never overwritten by later syncs.** It persists until hand-fixed in each adopter.

*Rules:* never put a personal/absolute path, real secret, or machine-specific value in a test fixture — use `/home/user/...`, `~/...`, tmp dirs, or env. When you fix such a leak in the workshop, remember a plain `template-updater` sync will **not** carry the fix to adopters that already have the stale test; fix those by hand. (Field-proven 2026-06-07: `guardrail.test.js` carried `/home/<user>/...` into two adopters.)

*Why:* surfaced during the v4.71/v4.72 fleet work — the strip-personal-paths fix reached the storefront via publish but not the already-synced adopters via `template-updater`.

### `version.json` changelog is capped; older entries live in workshop-only `CHANGELOG.md`

`version.json` ships to every adopter on every `fleet:sync`, so an ever-growing inline changelog bloats the propagated file. `fleet:release` keeps only the newest `CHANGELOG_INLINE_CAP` (3) releases inline and demotes older entries to root `CHANGELOG.md`.

*Rules:* `CHANGELOG.md` is **workshop-only** — it is not in the publish allowlist (`tools/publish-manifest.json`) and not a `.claude/` subtree, so neither `publish.js` nor `template-updater.js` carries it. Adopters see only the newest 3 releases in the `version.json` they sync; the full history lives in the workshop's `CHANGELOG.md`. The cap is enforced in `tools/fleet.js` (`capChangelog` / `mergeChangelogArchive`) — don't hand-edit `version.json` to re-stack old entries.

*Why:* the inline changelog had grown to span v4.59→v4.80 in one string (2026-06-14), bloating every adopter's `version.json`.
