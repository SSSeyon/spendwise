# SpendWise — Handover Note (Session 10)

## Purpose & context

Seyon is building and maintaining **SpendWise**, a personal finance PWA for household use. The app tracks expenses, income, cash balances across multiple bank accounts (NGN and USD), investments across multiple platforms with sub-investment tracking, debtors, loans, budgets, recurring transactions, FX rates, and historical summaries. It is deployed as a single `index.html` file to GitHub Pages (`ssseyon.github.io/spendwise/`) with Firebase Firestore as the backend and no build toolchain.

The explicit constraint driving the single-file architecture: Seyon works on a laptop with no install rights — no npm, no Node.js locally (only used for syntax checks via Claude's tools), no build step.

Seyon has an Excel background (not software development) and a goal of eventually writing features independently. Concepts are best explained by mapping web ideas to Excel equivalents.

**GitHub repo:** `https://github.com/SSSeyon/spendwise` (note the capitalisation: `SSSeyon`). Logos live in a `Logos/` folder in that repo.

---

## Current state

SpendWise is at **v3.14.89**. The file is ~8,234 lines.

### Session 10 work (v3.14.84 → v3.14.89)

This session covered a bug-check pass, a new Loans tab, an FX-rate editing/sync fix, and a two-stage cash carry-forward fix.

- **v3.14.85** — Bug-check bundle. Three issues fixed together: (1) a broken `onclick` on the cash drill-down rows that used `JSON.stringify(b)` inside a double-quoted attribute, emitting double quotes that terminated the attribute early; (2) the dashboard "Cash" card total was derived from the net-worth-filtered account list (`_nwAccts`), so a new account or an account deselected in Net Worth settings dropped from the "All accounts" figure — now `cashTotal` always sums `getCashAccounts()` while a separate `nwCashTotal` drives the net worth calc; (3) new cash accounts did not appear pre-checked in the Net Worth config checkbox and were excluded from totals — `renderNWConfigCard` now unions any saved selection with the current account roster so new accounts default to included, and `saveNWConfig` now mirrors to `appConfig/nwConfig` with a loader and `_nwCfgListener`. Also in this bump: intended FX-override and investment-config sync legs were described but **not actually written to the file** (see v3.14.87 note below).

  > **Important correction:** the v3.14.85 changelog and my narration claimed FX-override sync and an investment-config `onSnapshot` were added. On later inspection they were **not present in the file** — only the localStorage writes existed. This is a good reminder to always re-verify against the live file rather than trusting a prior session's summary. The FX sync was genuinely added later in v3.14.87. (An investment-config `onSnapshot` listener is still **not** present — see "On the horizon".)

- **v3.14.85 (Loans tab)** — New **Loans tab** under Accounts (fourth pill after Cash / Investments / Debtors). Records loans taken: lender, currency (NGN/USD/GBP), loan type, principal, interest rate (% p.a., stored for reference only, not auto-computed), proceeds-to-account selector, start/due dates, FX override, notes. On add, the selected cash account is credited via atomic `_adjustCash` at the loan's start month/year. **Record Repayment** modal debits a selected cash account (also via `_adjustCash`) and appends to a `repayLog`; loans auto-mark `settled` when the outstanding balance hits zero. Per-loan progress bar, collapsible repayment history, summary cards for total borrowed and outstanding. Stored in Firestore `loans` collection, cached as `sw3_loans`, `S.loans[]`, rendered by `renderLoans` (added to `renderAll`). **Note:** editing or removing a loan does **not** reverse the original cash movement (same design choice as debtor edits — the money already moved).

  > Both the bug-check bundle and the Loans tab were shipped under the same version label (v3.14.85) across two separate deliveries in the session.

- **v3.14.86** — **FX rate editor month coverage.** The Exchange Rates list in Settings was built from `Object.keys(FX_RATES)` (a hardcoded table that stopped at `2026-05`) unioned with override-only months. The current month (June 2026) and any future month therefore had no editable row — a chicken-and-egg gap that would recur every new month. `renderFxCard` and `saveAllFxOverrides` now always include the real-world current month plus the next 11 months ahead, with the current month row highlighted (filled background, bold label, `●` marker). This is a permanent structural fix; `FX_RATES` no longer needs manual extension for the list to work.

- **v3.14.87** — **FX override cross-device sync.** The actual write/load/listen trio that had been described but not applied earlier. `_syncFxOverrides()` mirrors overrides to `appConfig/fxOverrides` (called from `saveAllFxOverrides`, `clearFxOverride`, `clearAllFxOverrides`); `loadFxOverrides()` added to the init `Promise.all`; `_fxOvrListener` `onSnapshot` with the `hasPendingWrites` guard, declared and torn down alongside the other listeners.

- **v3.14.88** — **Cash carry-forward, first attempt.** Root cause identified: `cashBalances/{sid}` docs hold a running per-month balance; when a new month had no doc, the old fallback (`orderBy desc limit 1`) displayed the prior month's figure but wrote nothing, so the first `_adjustCash` in the new month ran `FieldValue.increment()` on a non-existent doc — Firestore creates it treating the increment as starting from zero, losing the opening balance. Fix: when no doc exists, fetch the immediately previous month's doc, strip `month`/`year`, and write it as a full `set()` seed (guarded to not seed future months). `changeCashMonth` pre-seeds the display from the previous month's local cache.

- **v3.14.89** — **Cash carry-forward, repair path.** Seyon reported July still showing zeros after v3.14.88. The v3.14.88 fix only handled the "no doc yet" case, but Seyon's July doc **already existed with zeros**, created by the old code before the fix was deployed — so `doc.exists` was true and the seed path was never reached. `loadCashData` now also detects an **uninitialised existing doc** (all accounts sum to zero while the previous month had non-zero balances) and repairs it in place by merging the previous month's closing balances in for any zero/missing account, writing the repair back to Firestore. Both paths (repair + seed) are guarded to run only for months up to and including the current real month. `changeCashMonth` now checks that cached balances are genuinely non-zero before showing them, otherwise displays the previous month as a placeholder while the async repair runs.

  > **Known edge case in the v3.14.89 repair heuristic:** the "all accounts total zero = uninitialised" test would misfire if the household genuinely spent every account down to zero simultaneously and then crossed a month boundary — the repair would incorrectly carry the prior month forward. Extremely unlikely in practice but worth noting before relying on it in an unusual month.

---

## On the horizon

- **Investment config still lacks a real-time listener.** `appConfig/investments` has a write leg (`_syncInvConfig`) and an init load (`loadInvConfig`), but **no `onSnapshot`** — so platform/meta/sub changes do not sync live to other devices until a reload. This was flagged in the bug-check but not implemented. The established trio (write + load + listen) should be completed here with an `_invCfgListener`, mirroring the cash-accounts / cash-logos / FX-overrides / nw-config pattern.
- **Outstanding non-code item repeatedly flagged:** verify Firestore security rules in the Firebase console. If they are still in test mode (`allow read, write: if true`), the household's financial data is publicly readable by anyone with the project ID. This remains the only item on any review list that risks data exposure rather than mere inconvenience.
- Items raised but not yet built: receipt-photo attachments (Firebase Storage), quick-add expense from the dashboard, concurrent-device hardening for income/investments (which still use document writes in places rather than atomic increments).
- Possible resumption of the JS/architecture learning curriculum (Modules 3–6 remaining; Modules 1–2, HTML and CSS mapped to Excel, are done).

---

## The cross-device sync pattern (important — reuse this)

The recurring root cause of "it didn't sync" is a write that only hit `localStorage`. The proven fix is a trio, now applied to cash accounts, cash logos, FX overrides, and net-worth config:

1. **Write** — on save, mirror to a doc under the `appConfig` collection (e.g. `appConfig/fxOverrides`, `appConfig/nwConfig`, `appConfig/cashAccounts`, `appConfig/cashLogos`). Use `{merge:true}` with per-key payloads where concurrent partial edits are possible; a full replace where the value is a single coherent object.
2. **Load** — an `async loadX()` added to the main init `Promise.all` (inside `syncAll`) so the remote value is pulled on startup.
3. **Listen** — an `onSnapshot` in `startRealtimeListeners()`, declared as a module-level `let _xListener=null`, cleared and reassigned at the top of the handler, and torn down in `stopRealtimeListeners()`. Always guard with `if(!snap.exists||snap.metadata.hasPendingWrites) return;` to skip the device's own writes.

If any other per-device config is found that doesn't sync (recurring definitions, savings targets, nav prefs, and the outstanding investment config), apply this same trio.

---

## Key learnings & principles

- **`FieldValue.increment` on a non-existent doc starts from zero.** This is the crux of the cash carry-forward bug: an increment `{merge:true}` on a missing month doc creates it with only that one field set to the delta, silently losing every other balance. Any new per-month doc that will later be mutated by increments must be **seeded with a full `set()` first**. When repairing after the fact, detect the zero-total doc and merge the prior month back in.
- **Re-verify against the live file, never trust a prior summary.** The v3.14.85 FX/investment sync was described as done but was absent from the file; only later inspection caught it. Read the current code before assuming a fix from a previous session is present. (Firestore increment behaviour: Google Firestore documentation, `FieldValue.increment`.)
- **`await` race condition pattern:** cash adjustment operations split around an `await` let `onSnapshot` fire in between and corrupt intermediate state. Move paired restore+apply adjustments to the same side of the `await`; for same-account edits, collapse to a single net delta so there is no intermediate state at all.
- **Atomic increments:** cash mutations use `FieldValue.increment` on the single changed field, never a whole-document `set`. Increments commute, so concurrent writes to different fields/devices can't clobber. A per-field dirty set (`_cashDirty`) makes the load-merge and the listener let only in-flight local fields win.
- **The dashboard Cash card must sum ALL accounts, not the net-worth-filtered list.** Keep `cashTotal` (all accounts, for the Cash card) separate from `nwCashTotal` (filtered, for the net worth figure). A new account is invisible in a total the moment that total is derived from a stale saved selection.
- **New accounts must default to included in NW config.** `renderNWConfigCard` unions the saved `cashAccounts` selection with the current roster so freshly-added accounts appear pre-checked rather than silently excluded.
- **`onclick` HTML attribute quoting:** single-quoted JS strings, never `JSON.stringify` and never double quotes inside a double-quoted attribute — this breaks HTML parsing silently. When interpolating a value that could contain an apostrophe, escape it (`b.replace(/'/g,"\\'")`).
- **Loan proceeds and repayments route through `_adjustCash`** so they hit the atomic increment path and the per-account ledger trail. Loan edit/remove intentionally does not reverse cash (matching debtor behaviour).
- **FX editor month list must be generated, not hardcoded.** Always include the current real month plus a forward window; do not rely on the static `FX_RATES` table for which months are editable.
- **Re-render kills focus:** an `oninput` that triggers a full tab re-render destroys the input mid-type. Patch the specific element by stable ID; defer full re-render to `onblur`.
- **GitHub raw URLs are case-sensitive:** `GTB.png` ≠ `gtb.png`; owner segment is `SSSeyon` (triple-S). A wrong filename and a missing file look identical because `onerror` silently falls back to initials/colour dot.
- **Sub-investment trust rule:** `migrateToSubs` returns zero-principal subs if they already exist — always check `subTotal > 0` before trusting sub data; use `subTotal > 0 ? subTotal : inv[p.key]` fallback everywhere.
- **Cache invalidation after Firestore batch:** after batch writes, bust the relevant `sw3_*` monthly caches or `onSnapshot` restores stale data.
- **TDZ trap:** module-scope `const`/`let` declared after `initFirebase()` halt the whole script. Declare all module-level constants before `initFirebase()`.
- **Python patch miss-detection:** every string replacement prints `OK`/`MISS`. A `MISS` usually means a prior patch (often the blanket version-bump regex) already altered the target text — re-read the live file and retry. The changelog string in particular gets its version number rewritten by the version-bump regex, so patch the changelog with the already-bumped version number.
- **Version bump locations:** exactly three — the `ver-lbl` span, the App Info `<div>Version:</div>` line, and `const APP_VERSION`. Verify with `grep`. (A `v3.14.79` string also appears inside a code comment and is not a version marker; ignore it.)

---

## Approach & patterns

- **Session workflow:** Seyon uploads the current `index.html` (or Claude works from the last output), describes bugs/features; Claude reads the relevant code before acting, roots the cause before touching code, implements targeted inline changes, extracts the JS and runs `node --check`, bumps the version in all three locations, copies to `/mnt/user-data/outputs/`, and presents the file.
- **Patching method:** Python `content.replace(old, new, 1)` with per-change miss detection (never `sed` — JS breaks shell escaping). The changelog should reflect only the current version's changes, not accumulated history.
- **Pre-implementation review:** on significant changes, present root-cause findings before/with implementing.
- **All code paths together:** fixes go across every entry point (save/edit/delete, online/offline branches), not just the primary path.
- **Inline edits over wrapping:** edit original functions directly; wrapping causes hoisting bugs.
- **Response preferences:** confidence levels on every answer, British English, no em dashes, sources when stating facts.
- **Handover notes:** only when explicitly asked (this is one).

---

## Key naming conventions

- `CK` — cache-key helpers (`CK.cash(m,y)`, `CK.txns`, `CK.loans`, etc.); `S` — global state object (`S.cash`, `S.loans`, `S.cashMonth`/`S.cashYear`, `S.expMonth`/`S.expYear`, `S.dashMonth`/`S.dashYear`); `sid(m,y)` — Firestore doc IDs; `fxKey(m,y)` — FX month key (same format as `sid`); `fN`/`fmtCur`/`fNum` — currency formatting; `_adjustCash(bank,delta,m,y,source,ref)` — central atomic + ledgered cash mutation; `getCashAccounts()`/`setCashAccounts()` — account roster; `getPlatforms()`/`savePlatforms()` — investment platforms; `_invDeposit`/`_invWithdraw` — sub-aware investment mutators; `getFxRates`/`getFxOverrides`/`_syncFxOverrides` — FX rate access and sync; `renderLoans`/`saveLoan`/`saveLoanRepayment` — loans.
- **Firestore config docs** live under `appConfig`: `appConfig/investments`, `appConfig/cashLogos`, `appConfig/cashAccounts`, `appConfig/fxOverrides`, `appConfig/nwConfig`.
- **Firestore data collections:** `transactions`, `income`, `cashBalances` (one doc per month keyed by `sid`), `debtors`, `loans`, `transfers`.
- **Listeners** (module-level, in `startRealtimeListeners`/`stopRealtimeListeners`): `_txnListener`, `_incListener`, `_cashListener`, `_logosListener`, `_acctsListener`, `_fxOvrListener`, `_nwCfgListener`. (No `_invCfgListener` yet — outstanding.)

---

## Tools & resources

- **Frontend:** Vanilla HTML/CSS/JS, Chart.js (incl. Sankey plugin), SheetJS (Excel export). Logos hosted on GitHub raw.
- **Backend:** Firebase Firestore (project `spendwise-d6393`).
- **Deployment:** GitHub Pages (`SSSeyon/spendwise`, `main` branch).
- **Syntax checking:** `node --check` on extracted JS.
- **Data formats:** Multi-currency (NGN, USD, GBP, Effective/native mode); FX rates stored per-month, overrides synced via `appConfig/fxOverrides`.

---

## Other instructions

- SpendWise is now at **v3.14.89**, ~8,234 lines.
- Do not produce a handover note unless explicitly asked.
- The Firestore security-rules check remains open and is worth confirming before adding any more multi-device features.
- Completing the investment-config `onSnapshot` listener is the most obvious next sync-consistency task.
