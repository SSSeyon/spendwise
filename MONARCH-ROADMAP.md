# SpendWise → Monarch Redesign Roadmap

> **STATUS (2026-07-12): IMPLEMENTED in v4.4.0** (local, not yet committed/pushed).
> Phases 0–7 are built and verified in preview, in both modes and both
> light/dark themes. Notes on what shipped:
> - **Phase 0**: `sw3_design_mode` flag, `body.monarch` class, `isMonarch()`,
>   Design Mode switch in Settings → Data. Classic remains the default.
> - **Phase 1**: `body.monarch{}` + `body.monarch.light{}` token blocks appended
>   to styles.css (Classic `:root{}`/`body.light{}` untouched). Inter loaded in
>   index.html + sw.js STATIC; CACHE bumped to `spendwise-v18`.
> - **Phase 2**: circular tinted category badges (`catBadge()`) on dashboard
>   recent txns, budget rows, and expense group headers — render-branched on
>   `isMonarch()`, so Classic markup is unchanged.
> - **Phase 3**: 12-month net-worth area chart inside the Net Worth hero card,
>   Monarch mode only (`renderNWHeroChart`).
> - **Phase 4**: the Sankey already existed (chartjs-chart-sankey, Cash Flow
>   dash tab); it now uses a muted green/coral palette in Monarch.
> - **Phase 5**: the recurring engine already existed, but its dashboard due
>   card (`dash-recurring-card`) had no container in index.html — added
>   (Upcoming Bills card) plus a Manage Recurring entry in Settings → Data.
> - **Phase 6 (GLOBAL)**: goals in `appConfig/goals` (list pattern), goal modal,
>   dashboard Goals card, Settings management, realtime listener.
> - **Phase 7 (GLOBAL)**: rules in `appConfig/rules`; `applyRules()` wins over
>   `smartCat()` in the expense form's auto-suggest; management UI in
>   Settings → Budget. Budget group rollups (fixed `DEF_CAT_GROUPS` map) shown
>   in the Monarch dashboard budget card; Classic keeps its flat list.

Goal: make SpendWise look and feel like **Monarch Money** without abandoning its
mobile-first PWA nature or its no-build-step architecture (`index.html` + `app.js`
+ `styles.css` + `sw.js`, vanilla JS, Firebase/Firestore).

This is a planning document only. No code has been changed. Effort is rough
(solo-dev days). Risk is rated against the app's key hazard: **there is no
staging — every preview hits live production Firestore** (see `HANDOVER.md`).

---

## Decisions locked (2026-07-12)

1. **Dual-mode, not a replacement.** Today's design ("Classic") stays exactly
   as-is and remains the default. Monarch becomes a second, switchable **design
   mode** — a cosmetic toggle only. Mechanism: a `designMode` flag
   (localStorage `sw3_design_mode`, values `classic` | `monarch`) plus a
   `body.monarch` class. All Monarch styling lives in **new** scoped token blocks
   (`body.monarch{}`, `body.monarch.light{}`); the existing `:root{}` and
   `body.light{}` blocks are **never touched**, which guarantees Classic is
   byte-for-byte unchanged. (Same pattern as the removed Dark theme, extended.)
2. **Scope: all phases except Phase 5** (recurring/bills is out).
3. **Goals (6) and Rules (7) are GLOBAL features, not mode-gated.** Their data
   (`goals`, `rules` collections) and their logic — including auto-categorization
   **on the save path** — run app-wide regardless of mode. The mode only affects
   how prominently their UI is surfaced (featured in Monarch, reachable-but-tucked
   in Classic). Toggling modes never changes app behavior, only appearance.
4. **Keep the bottom pill nav** in both modes (no desktop sidebar).

Combinatorial cost to keep in mind: mode (Classic/Monarch) × brightness
(light/dark) = **4 palette states** to maintain, and every future change must be
checked in both modes.

---

## Guiding principles (what actually makes it read as "Monarch")

1. **Calm & editorial** — soft neutral canvas, generous whitespace, one confident accent.
2. **Sans, not serif** — clean humanist/geometric sans throughout; numbers tabular.
3. **Charts as the hero** — net-worth trend and cash-flow up top, not buried in tabs.
4. **Fewer accent colors** — green = positive, coral = negative, neutral grays elsewhere.
5. **Soft cards** — bigger radius, shadow over borders, more padding.
6. **Category identity** — every category gets a colored icon badge.

Keep the **bottom pill nav** — Monarch's desktop sidebar does not translate to a
mobile PWA, and the pill nav is already a strong pattern.

---

## Design-system delta (current → target)

All of this lives in `styles.css` `:root{}` / `body.light{}` token blocks plus a
font swap in `index.html` + `sw.js`. This is the cheapest, highest-impact layer.

| Token / area | Current | Monarch-like target |
|---|---|---|
| Body font (`--font`) | `Book Antiqua` serif | `Inter` (or similar humanist sans) |
| Numbers (`--mono`) | `DM Mono` | Inter tabular-nums, or keep a subtle mono |
| Light canvas (`--bg`) | cool `#f0f4f8` | warm off-white `#faf9f6` |
| Dark canvas (`--bg`) | `#0f1117` near-black | desaturated charcoal-navy, slightly warmer |
| Accent (`--accent`) | bright teal `#14b8a6` | deeper muted spruce green |
| Secondary accents | teal/red/blue/gold/green all loud | green + coral + neutral grays only |
| Card radius (`--r`) | `12px` | `16px` |
| Card borders | 1px visible border + shadow | shadow-dominant, border faint or none |
| Card padding | `16px` | `18–20px`, more section spacing |
| Shadows | present | softer, larger-spread, lower opacity |

---

## Phased plan

Each phase is independently shippable and version-bumped (per the 5-touchpoint
convention in `HANDOVER.md`). Ordered cheapest/safest → most involved.

### Phase 1 — Visual foundation  ·  ~1 day  ·  Risk: LOW
Pure presentation. No data model, no logic.
- Swap `--font` to Inter; load the font (add `<link>` in `index.html`, add URL to
  `sw.js` STATIC array **and bump `CACHE` to `spendwise-v18`** since precached
  assets change). Decide: keep `--mono` or move to tabular-nums.
- Retune `:root{}` and `body.light{}` palettes toward the warm/muted target above.
- Raise `--r` to 16px; soften card borders/shadows; increase padding.
- **Files:** `styles.css`, `index.html`, `sw.js`. **Data model:** none.
- **Payoff:** ~80% of "looks like Monarch." Fully reversible.

### Phase 2 — Component polish  ·  ~1–2 days  ·  Risk: LOW
- **Category icon badges:** circular tinted glyph/emoji per category on
  transaction rows (`.txi`), budget rows, and lists. Needs a category→icon+color
  map (a JS const, no Firestore). Highest visual payoff after fonts/color.
- Restyle buttons/pills, section headers, and the net-worth hero to the softer look.
- Tighten the light/dark toggle and header to match.
- **Files:** `styles.css` + a small `app.js` category-map + render tweaks in the
  row builders. **Data model:** none (icons derived from existing category strings).

### Phase 3 — Chart-forward dashboard  ·  ~1–2 days  ·  Risk: LOW–MED
- Promote a large **net-worth-over-time area chart** to the top of Home (you
  already have Chart.js and net-worth history data).
- Present the existing Dashboard chart tabs (6-Month / Net Worth / Cash Flow /
  Trends) in the softer Monarch card style.
- **Files:** `index.html` (Home layout), `app.js` (chart config/order), `styles.css`.
- **Risk note:** read-only over existing data; the MED is only because it touches
  render paths — keep it read-only, don't introduce any write-on-render.

### Phase 4 — Cash-flow Sankey  ·  ~2–3 days  ·  Risk: MED
Monarch's signature "where the money went" diagram (income sources → spending
categories for a period).
- No Sankey in Chart.js by default — either add a plugin/CDN lib (update `sw.js`
  STATIC + bump `CACHE`) or hand-render with SVG (no new dependency; more code).
- Pure aggregation over existing transactions/income; **read-only, no new data.**
- **Files:** `index.html`, `app.js`, `styles.css`, possibly `sw.js`.
- **Decision needed:** SVG hand-roll (no dep, offline-safe) vs. a Sankey lib.

### Phase 5 — Recurring transactions / bills  ·  ~3–5 days  ·  Risk: HIGH
First feature that **adds a Firestore collection** (e.g. `recurring`) and a
detection/prediction layer.
- New data model: recurring rule `{label, amount, category, cadence, nextDate, …}`.
- Optional auto-detection from transaction history; upcoming-bills list + calendar.
- **Risk drivers:** new collection + writes on a live DB with no staging; must
  follow the boot-race discipline (never write-on-render before sync completes —
  copy the `_invMigrateGate` pattern). Test writes via the mocked-`db` technique.
- **Files:** all four, plus new render section + nav entry consideration.

### Phase 6 — Goals (GLOBAL feature)  ·  ~2–4 days  ·  Risk: MED–HIGH
- New `goals` collection `{name, target, current, deadline, linkedAccount}`, progress
  UI (rings/bars). Similar write-path caution to Phase 5, smaller surface.
- **Global, not mode-gated:** data + logic exist app-wide. Monarch mode features
  the goals UI prominently; Classic keeps it reachable (Settings/Accounts).

### Phase 7 — Budgets rollup + rules/auto-categorization (GLOBAL feature)  ·  ~3–5 days  ·  Risk: MED–HIGH
- Extend the existing budget rows into Monarch-style category **groups with
  rollups** (parent/child categories, remaining/over).
- **Transaction rules:** auto-assign category/notes on matching payees. New
  `rules` collection + apply-on-add logic. Highest logic complexity; test carefully.
- **Global, not mode-gated:** the rule-apply-on-save logic runs in BOTH modes —
  it's data behavior, not presentation. Only the rules-management UI prominence
  differs by mode. This is the deliberate call so toggling modes never changes
  what the app does.

---

## Cross-cutting constraints (apply to every phase)

- **No staging.** Prefer read-only inspection; test any write path via the mocked
  `db` global (temporarily reassign `let db` to a no-op mock, run, restore) rather
  than writing to production. Get explicit confirmation before any real write.
- **Boot-race hazard.** Never add a function that reads-and-writes based on "is this
  empty" on a render path — gate the write behind a post-sync flag (`_invMigrateGate`
  is the reference pattern).
- **Version bump every release** — all 5 touchpoints. Bump `sw.js` `CACHE` **only**
  when precached STATIC assets change (Phases 1 and possibly 4).
- **Push to `main` = production deploy** (GitHub Pages). Nothing deploys until pushed.

---

## Recommended sequence

Phases **1 → 2 → 3** deliver almost the entire visual identity for low risk and no
data-model changes — do these first and ship as one or a few releases. Then treat
**4** (Sankey) as the signature flourish. Features **6 → 7** are a separate track:
global (not mode-gated), higher effort, and carry live-data risk. **Phase 5
(recurring/bills) is out of scope** per the 2026-07-12 decision.

Foundational prerequisite for everything: **Phase 0 — the mode toggle itself**
(`designMode` flag, `body.monarch` class, a switch in Settings, and the render
branching harness). Build this first; every other phase hangs off it.
