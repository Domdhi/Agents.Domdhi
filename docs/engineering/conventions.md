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

## Working discipline

### Resolve it or don't report it

A problem found is a problem fixed. When investigation or verification surfaces something clearly worth fixing — a failing test, a broken parser, a typo, dead code, a flaky path — **fix it in the same pass**, then re-verify. Diagnose → fix → re-run the real command → report what you did.

- A report that ends in "want me to fix it?" for an obviously-worthwhile fix is an **incomplete job**, not a courtesy.
- "Pre-existing" / "unrelated" describe a bug's *origin*, not a license to leave it broken.
- If a fix exposes a new failure, follow the thread to green.
- **Only** stop to ask on a genuine fork: mutually-exclusive approaches, an irreversible/outward action, or scope that materially expands the task. A clear bug is never a fork.

*Why:* established 2026-06-20 after a "4 tests fail, here's why, want me to fix them?" report — the diagnosis was right but stopping there wasted a round-trip on work that was plainly worth doing. (Mirrors the global Rule 5 and the `verification-before-completion` skill's "Resolve, Don't Defer.")

## Cross-platform / Windows portability

The test suite runs on Windows (Node 24) as well as Linux/macOS CI. Several classes of bug pass on POSIX and break only on Windows — guard against all of them. (All five field-proven 2026-06-20 when a Windows + Node 24 run surfaced them at once.)

### Split on `/\r?\n/`, never bare `\n`; normalize to LF via `.gitattributes`

A Windows checkout with `core.autocrlf=true` and no override leaves `\r` on every line. A parser that does `content.split('\n')` then exact-matches a fence (`lines[0] === '---'`) silently fails because `lines[0]` is `"---\r"`. **Rule:** split text on `/\r?\n/` in any parser that exact-matches whole lines. The repo's root `.gitattributes` (`* text=auto eol=lf`) is the systemic guard — keep it. *Field case:* `skill-conformance.js` reported all 23 skills' `name` as `null`.

### `fileURLToPath(import.meta.url)`, never `new URL(import.meta.url).pathname`

On Windows the latter returns `/C:/Users/...` (leading slash), which `path.resolve` turns into the bogus `C:\C:\...`. **Rule:** always `import { fileURLToPath } from 'node:url'` and use `fileURLToPath(import.meta.url)`. *Field case:* `guardrail.test.js` failed to load its rules file with `ENOENT C:\C:\...`. (Also documented in `qa-engineer/SKILL.md`.)

### Prefer built-in `node:sqlite` on Node 24+; PROBE a native backend, don't trust `require()`

`require('better-sqlite3')` loads only the JS wrapper — the native `.node` binary loads lazily at `new DatabaseSync()` and throws on an ABI mismatch (a build for a different Node major). **Rule:** on Node 24+ prefer the zero-dependency built-in `node:sqlite`; when adopting any SQLite backend, validate it by actually constructing an in-memory FTS5 table (`probeFts5`) before committing to it, so a broken candidate falls through instead of silently degrading every later call to JSON-only. *Field case:* memory search silently fell back to JSON (0 hits, 167 errors) on a box with a stale `better-sqlite3` build.

### Canonicalize paths with `fs.realpathSync.native` before string-comparing

`os.tmpdir()` can return an 8.3 short path (`C:\Users\DBACA~1.NMM\...`) while `git --git-common-dir` returns the long form (`dbaca.NMMFA`). Same directory, different strings → a `toBe` comparison fails. **Rule:** run both sides through `fs.realpathSync.native()` before comparing paths. *Field case:* the `resolveProjectRoot` worktree test.

### Close SQLite handles before `rmSync` of a temp dir

Windows refuses to delete a directory containing a file with an open handle (`EPERM`); POSIX allows it. A test that opens a DB and `rmSync`s its dir in `finally` must close **every** handle first. **Rule:** track and close all managers/handles a fixture opens before removing its directory — not just the ones the assertion used. *Field case:* a `seedTempStores` helper opened two managers; the test closed one, and the leaked second handle locked the `.db` against cleanup.
