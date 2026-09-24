# SpendWise — Handover Note (v4.4.22)

Personal-finance PWA. No auth (single-user, trusted device model).
Live: https://ssseyon.github.io/spendwise/
Repo: github.com/SSSeyon/spendwise, deployed via GitHub Pages from `main`. No CLI/build step — pushing to `main` *is* the deploy.
Source root: `G:\My Drive\Personal things\App\Spendwise\spendwise\`

---

## Current state (as of this note, 2026-09-24)

- Version **v4.4.22**, committed and pushed. Standing pattern: the user often pushes independently without announcing it, so **always re-verify `git status` / `git fetch`** rather than trusting an earlier read.
- Files: `index.html` (shell, ~782 lines) + `app.js` (**~10,400 lines, all logic**) + `styles.css` + `sw.js` + `bump-version.ps1`.
- Firebase project `spendwise-d6393` — Firestore, **no authentication**, public client config, **no staging environment**. Every preview/dev session talks directly to the user's real, only copy of their financial data. Both the repo and the Firestore project are effectively publicly readable at the client-key level — a known, accepted tradeoff for this single-user app, not an oversight. Do not "fix" it unasked.
- **Gemini API keys are multi-key and Firestore-synced** (`appConfig/aiKeys`). This supersedes any older "localStorage only, never Firestore" claim. The in-code comments that wrongly repeated that claim were corrected in v4.4.19.
- The user sometimes edits files directly via the GitHub web UI in parallel with agent sessions, which has twice caused local/origin divergence (see incidents below).

## Recent history (v4.4.5 → v4.4.22)

Per-release detail is in the git log — commit messages are deliberately thorough. Summary:

- **v4.4.5–v4.4.8** — AI model chain + per-reply model tagging, auto-growing chat box, WhatsApp share; **Special Budget** tab (standalone trip/event budgets, currency switching, per-item cost options, duplicate-and-compare); app-wide **caret-position fix** (formatted-overlay inputs mapped the caret to the hidden raw text); `notificationclick` handler in `sw.js` (tapping a phone notification did nothing before, because the SW owns the notification and had no handler).
- **v4.4.9–v4.4.12** — expense lines ("actual expenses") now sync to Firestore; emoji picker accepts any emoji from the keyboard; interest posting for Renmoney/Piggy; History sorted newest-first; renaming a payee **rewrites historical transactions** (local caches + Firestore), plus a "Merge Expense Lines" tool.
- **v4.4.13–v4.4.18** — Loans and Debtors group by lender/obligor with per-item repayments; optional funding account on investment inflows; Net Worth can subtract outstanding **loans** (opt-in); month-aware investment reads on the dashboard; account drill-down shows every movement (incl. loan/debt/interest) with delete-and-reverse; cross-currency transfers display the receiving side correctly; App Info shows only the current release note; Debtors summed per person in the NW breakdown.
- **v4.4.19** — ~43 swallowed exceptions now log to console (see "Error visibility policy"). Corrected the false API-key security claim. Added `bump-version.ps1`.
- **v4.4.20** — **one transfer implementation** replacing three (see "Transfers" below). Added realtime listeners for `appConfig/customLines`, `appConfig/interestPosts`, `budgets` and `transfers`.
- **v4.4.21** — Investments page is month-aware and **read-only for past months**; retired platforms (e.g. `USDHoldings`) no longer vanish from historical totals.
- **v4.4.22** — model cascade headed by the `gemini-flash-latest` alias; AI can render charts in replies.

---

## Transfers — one code path (v4.4.20; read before touching money movement)

There used to be **three** transfer implementations (expense modal, Move modal, Cash-page quick transfer). All three wrote the whole `cashBalances` doc directly and derived the month from **whichever month the UI was showing**, not the transaction's date — so a transfer dated in July while September was on screen moved *September's* balance. They also bypassed the cash ledger (hence transfers never appeared in account history), and a full-doc write could clobber a concurrent change from another device.

All three now call **`_doTransfer({kind,from,to,amt,date,notes})`**:
- month/year from the transaction **date** (`_ymOf`), never the viewed month;
- cash legs via **`_adjustCash(bank,delta,m,y,source,ref,dateStr)`** — atomic `FieldValue.increment`, ledger entry carrying the real date and a readable reason, ripple-forward into later months, offline queue;
- investment legs via `_invDeposit`/`_invWithdraw`, plus `addInvMovement`/`addInvWithdrawal`;
- `_cashBalFor` resolves the guard balance the *same way* `_adjustCash` resolves the write target, so the guard and the write can't disagree about which month they mean.

**Investment legs dated outside the live calendar month are refused.** Sub principals are a single current-month snapshot, so a back-dated investment leg would write today's principals into a past month *and* corrupt today's figures. Cash-to-cash back-dating is fully supported.

**If you add a fourth transfer surface, call `_doTransfer` — do not write `cashBalances` directly.**

---

## Investment balances are NOT month-bucketed (read before touching the Investments page)

`sw3_inv_subs` is a **single live snapshot**, not per-month. `invBalanceFor(pKey,m,y,monthData)` is the accessor: live subs for the real current month, that month's saved doc otherwise.

The Investments page is also the **editing** surface for those subs, so past months render **read-only** (no edit panels, no row click handlers, save button hidden, explanatory banner with a jump back to the current month). Five global entry points — `toggleInvEdit`, `addInvSub`, `removeInvSub`, `openInvAdjModal`, `openLiqModal` — carry a `_invIsLiveMonth` guard because they stay reachable from a stale DOM.

`platformsFor(monthData)` returns the configured platforms **plus** any positive non-meta key found in that month's doc, labelled e.g. "USD Holdings (closed)". Use it on read-only month-scoped surfaces only; editing surfaces and pickers keep plain `PLATFORMS`, so a closed platform never becomes editable or selectable again.

---

## Error visibility policy (v4.4.19)

Failures that lose data or skip a render **must** log. Firestore reads with a cache fallback use the existing `_warnLoad(what, e)` helper; writes use `console.warn('<what> write failed', e)`.

Deliberately still silent (~18 sites — do **not** "fix" these; the noise would bury real warnings): `localStorage.setItem` wrappers (private mode / quota), `haptic()` (`navigator.vibrate` throws on desktop every call), Chart `destroy()` guards, `_evalExpr` (throws are *expected* on invalid input), `_firstEmoji` (`Intl.Segmenter` feature detection), `enablePersistence` and `serviceWorker.register`. The one exception is **`cSet`** — the chokepoint for every cache write — which gets a *one-shot* warn behind `_lsWarned`.

---

## Realtime listener coverage

Live: `transactions`, `income`, `cashBalances`, `debtors`, `loans`, `aiChats`, `specialBudgets`, `transfers`, `budgets`, and the `appConfig` docs `aiKeys`, `cashAccounts`, `cashLogos`, `customCats`, `customLines`, `fxOverrides`, `goals`, `investments`, `interestPosts`, `nwConfig`, `recurring`, `rules`.

**`cashLedger` has no listener, by decision** — it is append-only via `arrayUnion` and capped at 500 entries/month, so a listener would re-download the whole array on every transaction from any device. Its only consumer (the balance audit) does a fresh `.get()` when opened. The reasoning is recorded in a comment in `startRealtimeListeners()` so it doesn't read as an oversight.

House pattern for any new listener: guard `snap.metadata.hasPendingWrites` → update cache + `S` → stale-month guard → re-render only if the pane is visible and doesn't contain `document.activeElement` → `err => console.warn(...)`. Month-scoped listeners are safe because `startRealtimeListeners()` is re-invoked on month change and calls `stopRealtimeListeners()` first.

---

## AI charts (v4.4.22)

The model may emit **one** fenced `spendwise-chart` block per reply holding a small strict JSON spec, rendered with the Chart.js already loaded for the dashboard.

- The schema is deliberately **not** Chart.js-shaped — `series`/`name`/`data`, never `datasets`. Given "datasets" the model helpfully emits a full Chart.js config with colours and nested `options`, which defeats theming and widens the parse surface.
- `_aiMd(src, key)` consumes fenced blocks **whole and first**, so chart JSON never reaches the HTML escaper. Side benefit: any other fenced block now renders as `<pre>` instead of stray backtick-laden paragraphs.
- **Lifecycle is the fragile part.** Canvas ids are deterministic per (chat, message), and `renderProjAI()` calls `_aiDestroyCharts()` before **every** `innerHTML` rebuild. This is mandatory, not hygiene: Chart.js throws *"Canvas is already in use"* when an id is reused against a detached canvas, and both `renderProjAI` and the `aiChats` snapshot listener rebuild the pane.
- `_aiChartValidate` returns `null` rather than throwing, and each mount is individually try/caught, so a hallucinated spec degrades to a "Chart unavailable" note and never breaks the reply around it.

---
## Git divergence incidents (read before assuming `git log` tells the whole story)

Twice now, local `HEAD` and `origin/main` have diverged because the user uploads files manually via the GitHub web UI in between (or during) agent sessions, while the agent also has local unpushed commits. Both times resolved via `git merge -s ours origin/main` after diffing to confirm the incoming remote commits were content-identical/subsumed by local work (CRLF noise only — use `git diff --ignore-space-at-eol` placed **before** the pathspec, not after, or the flag silently no-ops). **Never** assume `origin/main` is stale without fetching and diffing first — the reverse has also been true.

---

## Version bump convention (must-follow, easy to get wrong)

**Use the script — don't hand-edit the six spots:**

```powershell
.\bump-version.ps1 -Version 4.4.23 -Note "One user-facing sentence about what changed."
.\bump-version.ps1 -Version 4.4.23 -Note "..." -WhatIf   # preview
```

It updates all six places, **fails loudly** if any one of them doesn't match, and carries an encoding tripwire (below). Format is lowercase `vx.x.x` — NOT capital V (a past capital-V experiment broke the field auto-update regex on already-installed clients). **The user wants every update, including minor ones, to bump the version.**

The six spots, for reference:
1. `app.js` → `const APP_VERSION='vx.x.x';`
2. `app.js` → the App Info `<div>Version: vx.x.x</div>`
3. `app.js` → the single release note below it. App Info shows **only the current release** — the script *replaces*, never prepends.
4. `index.html` → `styles.css?v=x.x.x`
5. `index.html` → `<span class="ver-lbl">vx.x.x</span>`
6. `index.html` → `app.js?v=x.x.x`

`sw.js` → bump `const CACHE='spendwise-vN'` **only** when the precached STATIC assets change. `index.html`, `app.js` and `styles.css` are deliberately excluded from the precache list, so `?v=` busting is sufficient for ordinary releases and the script leaves `sw.js` alone.

> ⚠️ **Encoding landmine (cost a full rebuild once).** PowerShell 5.1's `Get-Content -Raw` decodes a BOM-less file using the system **ANSI** codepage, so reading `app.js` and writing it back turns every naira sign, arrow and em-dash into mojibake. The script now reads with `-Encoding UTF8`, writes via `UTF8Encoding($false)` (no BOM — these files have none and must keep none), and refuses to write if the non-ASCII character count changes. **Any other tooling that rewrites these files must do the same.** Quick check: `grep -ao "'₦'" app.js | od -An -tx1` should show `e2 82 a6`.

Tap the version label in the header (`forceHardRefresh()`) to force a client past the service worker cache — a normal hard-reload does not bypass it.

---
## AI API Keys architecture (multi-key, Firestore-synced as of v4.4.4)

- Multiple Gemini keys can be saved (`{id,label,key}`), one marked active at a time. Managed under More → Data → "AI API Keys" card (`renderApiKeysCard()`/`addAiKey()`/`editAiKey()`/`deleteAiKey()`/`setActiveAiKey()`), with a "no key" deep-link from the AI Analyst tab via `goToApiKeys()`.
- **Storage**: `localStorage` (`sw3_gemini_keys`, `sw3_gemini_active_key`) as the write-through cache, synced to a single Firestore doc `appConfig/aiKeys` (`{list, activeId}`) — same singleton pattern as `appConfig/recurring`, `/goals`, `/rules`, `/customCats`. `_aiSyncKeys()` is the write path (called after every mutation); `loadAiKeys()` is the boot-time read path (called from `syncAll()`); a realtime listener (`_aiKeysListener` in `startRealtimeListeners()`) keeps devices live-synced, guarded by the standard `hasPendingWrites` + local-cache-diff check so it can't blow away an in-progress edit.
- **Migration**: `_aiKeys()` does a one-time migration from the old single-key slot (`sw3_gemini_key`/`AI_KEY_LS`) into the array format the first time it's called on a device that still has the legacy key.
- **Empty-cloud-doc seeding**: if `appConfig/aiKeys` doesn't exist yet but a device has local keys, `loadAiKeys()` seeds the cloud from local (one-time push) instead of leaving them stranded — but never writes an empty list, so a brand-new device with nothing to sync can't blank out other devices' keys.
- If adding another cross-device-synced setting in the future, copy this pattern (or the recurring/goals one) rather than inventing a new one — it's already handled the "don't overwrite mid-edit," "don't blank on empty," and "seed-once" edge cases.

## AI Analyst architecture (for any future AI-related work)

- Gemini REST API (`generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, key as a `?key=` query param), model cascade tried in order in `_aiFetch()`: **`gemini-flash-latest` → `gemini-3.8-flash` → `gemini-3.7-flash` → `gemini-3.6-flash` → `gemini-3.5-flash`** (as of v4.4.22).
- **`gemini-flash-latest` is Google's hot-swapped alias** — it tracks the newest GA Flash without a code change, so this list should **not** need editing when the next model ships. The pinned ids below it are the fallback chain for keys/regions where the alias isn't served, and for when the alias itself is mid-swap. Before changing the cascade, verify what the active key actually serves: `GET https://generativelanguage.googleapis.com/v1beta/models?key=…` (read-only, touches no Firestore).
- **Fallback covers 404/5xx AND 429** (since v4.3.3) — a bad-key error (400/401/403) is the only thing that aborts immediately; everything else (network error, non-2xx, empty response, rate limit) falls through to the next model. The chain is retried best-first on **every** request; there is deliberately no sticky "last winning model", because that previously pinned devices to an older model after a newer one was prepended.
- **Badges show the model that actually answered**, not `AI_MODELS[0]`. `_aiModelLabel()` formats ids (`gemini-flash-latest` → "Gemini Flash (latest)", since a naive `.replace('gemini-','Gemini ')` reads as "Gemini flash-latest"). The header badge derives from the last model message, so it survives reload and chat switching with no new state.
- `_aiFetch()` auto-continues on a `MAX_TOKENS` finish reason (up to 5 continuations) since internal "thinking" tokens can eat the output budget and truncate answers mid-sentence — segments are string-concatenated, so a fenced chart block split across a continuation stitches back together correctly.
- **Multi-conversation model**: one Firestore doc per chat in top-level `aiChats` collection (`{title, msgs:[{r,t}], createdAt, updatedAt}`), giving each chat its own 1MB budget. Active-chat pointer is device-local (`localStorage`), not synced — by design, each device can be looking at a different chat.
- **Critical invariant**: message arrays are always mutated **in place** (never reassigned), and all async operations re-resolve the chat by id (`_chatById(cid)`) after every `await`. This exists because an earlier bug silently dropped AI replies when a realtime listener rebuilt the chat array while a request was in flight, orphaning the old array reference. Do not "clean up" this pattern into reassignment without re-verifying that failure mode is still handled. `aiRetry()` (v4.3.0) follows the same invariant when splicing out trailing error bubbles.
- Realtime sync via `onSnapshot` on the `aiChats` collection, guarded by `if(snap.metadata.hasPendingWrites)return;` (standard pattern used by all other Firestore listeners in this app too).

---

## Boot sequence / data-integrity hazard (read before touching anything that writes on render)

`initFirebase()` calls `renderAll()` **synchronously from local cache before `syncAll()` (async, 15 parallel Firestore reads) completes**, then renders again after sync. Any function that is called from a render path and both reads-and-writes based on "is this empty" is unsafe — it can't distinguish "genuinely empty" from "not loaded yet," and on a fresh/empty local cache (any new preview browser profile) it will fire during the pre-sync window and persist wrong data. `migrateToSubs`'s `_invMigrateGate` (v4.3.2, see above) is the pattern to copy if another auto-migrate-on-empty function is ever added: gate the **write**, not the **read**, on a flag that only flips true after a real sync.

---

## Testing / preview

Preview dev-server config lives in this repo's own `.claude/launch.json`, config name `"spendwise"`, port **8972**, serving this repo via a PowerShell static-file script (`serve-spendwise.ps1`). (Earlier note about it living in a sibling project's launch.json is outdated — it's in-repo now.)

**Reminder**: this preview connects to live production Firestore (no staging exists). Prefer read-only inspection (`.get({source:'server'})`) when diagnosing data issues, and get explicit user confirmation before writing agent-inferred values to production docs — Claude Code's own permission system will generally block such writes until confirmed anyway.

**Safe-testing harness** (the established pattern — use it, the preview talks to production):

```js
const _snap = JSON.stringify(localStorage);   // restore with a replay loop afterwards
db = null;                                    // `let db` — assignable; every Firestore path is behind `if(db)`
window.confirm = () => false;                 // nothing destructive gets past a prompt
```

Do this **before any interaction** — one stray tap before `db=null` writes to live Firestore. Restore `db`, `S.*` and `localStorage` in a `finally`. There is no Node or Python on this machine, so the only syntax gate is in the browser: `fetch('app.js?x='+Date.now()).then(r=>r.text()).then(t=>{new Function(t);console.log('parse OK')})` — it parses without executing. Run it after **every** batch of edits.

---

## Open items / known gaps (as of v4.4.22)

No open bugs. Deliberately **not** done, with reasons:

1. **No test suite and no `package.json`** — the user explicitly deferred this. The highest-value first step would be unit tests for the pure money functions: `calcInterestAccrual`, `_sbArrival`, `invBalanceFor`, `nwDebtorRows`, `nwLoansOutstanding`, `_monthInterest`, `_ymOf`, `_aiChartValidate`.
2. **`app.js` is still one ~10,400-line file** — the user explicitly deferred splitting it. Splitting *first* would only relocate the problems; the correctness fixes landed first for that reason.
3. **`S` is still a god object** — mixes UI state (`page`, `chartType`, `catChart`) with domain data (`txns`, `cash`, `investments`) and a transient lock (`saving`). Splitting into `S.ui` / `S.data` would make the month-switching bugs structurally impossible, but it touches hundreds of references. Deferred by the user as too risky for the value.
4. **`customExpLines.__removed__`** is a sentinel key stored *inside* the data map. Firestore rejects field names that both start and end with `__`, which crashed the `customLines` sync until `saveCustomLines`/`loadCustomLines` split it into a separate `removed` field. The sentinel itself remains — a cleaner model would hold it outside the map, but that needs a data migration.
5. **The Gemini key is readable by anyone who can read the repo** (it is synced to `appConfig/aiKeys` in a public Firestore project). v4.4.19 made the in-app copy honest about this; the actual fix would be to stop syncing keys, or to put security rules on `appConfig/aiKeys`. The user has not asked for either.
6. **The Debtors page's own "Expected Back" stat** still counts settled/zero/negative debts. The Net Worth breakdown filters them (v4.4.18) but the user scoped that change to the NW card only.
7. **817 inline `style="…"` vs 288 CSS classes** — any theming change is a shotgun edit across template literals. This is why Monarch mode needed render-branching rather than plain CSS.
