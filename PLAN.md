# Implementation & Handoff Plan — `sleep-tracker-27`

## 1. Project Overview & Family Profile

- **App Name / Firebase Project:** `sleep-tracker-27` (`/Users/rutledgeb/Projects/Personal/Sleep/sleep-tracker-27`)
- **Family Profile:**
    - Baby due **`2027-01-01`** (Jan 1, 2027).
    - Sleep space plan: bedside bassinet in parents' bedroom for **Months 0–6**, then dedicated nursery with crib.
    - Sleep learning track: **Fuss It Out (FIO)** (`> 2 months`) → **Full Extinction SLIP** (`~4+ months`), skipping multi-week SWAP ladders.
- **Core Product Requirements (User Spec):**
    - **Sleep & wake transitions only (NO feed tracking):** Ultra-simple raw data event (`type: 'asleep' | 'awake'`, `timestamp`, optional `comment`).
    - **Instant 3:00 AM entry screen:** Default screen opens directly to two giant easy-tap buttons (`🌙 Went to Sleep` / `☀️ Woke Up`), quick retroactive time offsets (`Now`, `-5m`, `-10m`, `-15m`, `-30m`, `-1h`, custom datetime), optional comment field, and recent-event edit strip. Both buttons stay clickable at all times so a missed tap never blocks logging.
    - **Forgiving Gap Interpolation Engine:** Intelligently bridges missed taps (`asleep -> asleep`, `awake -> awake`, or multi-hour/multi-day gaps) as visually distinct hatched segments in graphs without corrupting real statistical averages. Tapping any interpolated segment lets the user confirm/adjust it into a real event.
    - **Graphs & Stats (`1D`, `3D`, `7D`, `30D`):** 24-hour SVG barcode/raster timeline + stacked daily totals chart + stats cards (`Nap Count`, `Nap 1`, `Nap 2`, `Nap 3`, `Nap 4`, `Night Wakes`, `Longest Night Stretch`, `Night Sleep`, `Day Nap Total`, `Pre-Bed Wake Window`, `Data Completeness %`).
    - **100% Deterministic Precious Little Sleep (PLS) Coach, Playbook & Timers ($0/forever, zero LLM calls):** Built directly from the verbatim chapter markdown library at:
        - `/Users/rutledgeb/Projects/Personal/Sleep/00-MASTER-CHRONOLOGICAL-CHEAT-SHEET.md`
        - `/Users/rutledgeb/Projects/Personal/Sleep/chapters/` (`00`–`14` + `99-all-book-tables-verbatim.md`)
    - **Private 2-Parent Cloud Sync:** Firebase Auth (Google Sign-In) + offline-first Firestore strictly allowlisted to the parents' two accounts, plus Local/Demo mode for instant preview before sign-in or before `2027-01-01`.

---

## 2. Critical Environment & Runtime Rules (Read First!)

1. **ALWAYS use Bun (`bun`, `bun --bun`, `bunx --bun`) — NEVER bare `node`, `npm`, `npx`, or bare `bunx`:**
    - Bare `node` / `npm` / `npx` / `bunx <pkg>` fails on this machine with `mise ERROR No version is set for shim: node`.
    - Always invoke Vite, TypeScript, tests, and Firebase CLI via `bun`:
        - `bun run dev` (`bun --bun vite`)
        - `bun run build` (`bun --bun vite build`)
        - `bun test`
        - `bun run typecheck` (`bunx --bun tsc --noEmit`)
        - `bunx --bun firebase-tools ...`
2. **Strict TypeScript (`typescript@^7`):**
    - `tsconfig.json` has `"strict": true`, `"noUncheckedIndexedAccess": true`, and `"verbatimModuleSyntax": true`.
    - Always use `import type { ... }` for type-only imports and safely guard indexed array lookups (`arr[i]`).
3. **Verified Polyfill Entry Points (already inspected in `node_modules`):**
    - **`@microsoft/focusgroup-polyfill` (`1.6.0`):** `polyfill()` requires an `HTMLElement` argument, whereas `polyfillBodyAndObserve()` runs on `document.body` AND sets up a `MutationObserver` so dynamically mounted React tablists get polyfilled! Gate with:

        ```ts
        if (!Object.hasOwn(HTMLElement.prototype, 'focusGroup')) {
          const { polyfillBodyAndObserve } = await import('@microsoft/focusgroup-polyfill');
          polyfillBodyAndObserve();
        }
        ```
    - **`temporal-polyfill` (`1.0.8`):** Gate with:

        ```ts
        if (typeof (globalThis as { Temporal?: unknown }).Temporal === 'undefined') {
          const mod = await import('temporal-polyfill');
          (globalThis as { Temporal?: unknown }).Temporal = mod.Temporal;
        }
        ```

        _(Also check/reuse the same lazy guard helper inside unit tests if Bun lacks native global `Temporal`.)_
4. **Modern Web Guidance Compliance:**
    - Ensure `modern-web-guidance` skill rules are followed for `dark-mode`, `browser-ui-theming`, `dialog`, `light-dismiss-a-dialog`, `tabs`, `calculate-event-differentials`, and `capture-location-agnostic-data` (exact requirements detailed in Step E below). If your session loads the `modern-web-guidance` skill, run `bunx --bun modern-web-guidance@latest retrieve "..."` as needed and include the required `### Modern Web Guidance` disclosure block at the end of your response.

---

## 3. Current State — Already Completed (Do Not Redo)

- Directory renamed to `/Users/rutledgeb/Projects/Personal/Sleep/sleep-tracker-27` (`.git` preserved).
- Placeholder `index.ts` deleted.
- Dependencies installed via `bun add` / `bun add -d`:
    - Runtime: `react@19.3.1`, `react-dom@19.3.1`, `firebase@13.3.0`, `temporal-polyfill@1.0.8`, `@microsoft/focusgroup-polyfill@1.6.0`.
    - Dev: `vite@8.3.8`, `@vitejs/plugin-react@6.3.0`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`.
- `package.json`: Configured with `"name": "sleep-tracker-27"` and scripts (`dev`, `build`, `preview`, `test`, `typecheck`, `deploy`, `deploy:hosting`, `deploy:rules`) all using `bun --bun` / `bunx --bun`.
- `tsconfig.json`: Configured with `"lib": ["ESNext", "DOM", "DOM.Iterable"]`, `"types": ["bun", "vite/client", "temporal-polyfill/types/global"]`, `"include": ["src", "vite.config.ts"]`.
- `vite.config.ts`: Created with `@vitejs/plugin-react` and `build: { target: 'esnext' }`.
- `.firebaserc`: Created with `{ "projects": { "default": "sleep-tracker-27" } }`.
- `firebase.json`: Configured for Firestore (`firestore.rules`, `firestore.indexes.json`) and Hosting (`public: "dist"`, SPA rewrite).
- `firestore.indexes.json`: Created (`{ "indexes": [], "fieldOverrides": [] }`).
- `firestore.rules`: Created and locked strictly to the two verified parent accounts under `/households/family/{document=**}`.
- **Not yet created:** Everything under `src/`, `public/`, `index.html`, and updating `README.md`.

---

## 4. Exact Firebase Configuration & Auth Allowlist

Use these exact values in `src/lib/firebase.ts` (allowing optional `import.meta.env.VITE_FIREBASE_*` overrides):

```ts
export const firebaseConfig = {
    apiKey: 'AIzaSyBSASmvoqB4c7GlVAud8_TlloNcTVTvZnk',
    authDomain: 'sleep-tracker-27.firebaseapp.com',
    projectId: 'sleep-tracker-27',
    storageBucket: 'sleep-tracker-27.firebasestorage.app',
    messagingSenderId: '463351681825',
    appId: '1:463351681825:web:b304d1551169cc9f9c6460',
}

export const ALLOWED_EMAILS = ['blake@blakerutledge.com', 'aliyana.gewirtzman@gmail.com'] as const
```

- **Auth Rule:** `blake@blakerutledge.com` is a **Google Workspace custom domain** Gmail, and `aliyana.gewirtzman@gmail.com` is standard `@gmail.com`. Configure `new GoogleAuthProvider()` with **NO `hd` domain parameter** so both accounts sign in smoothly via `signInWithPopup(auth, googleProvider)`. On `onAuthStateChanged`, if `user?.email` (lowercased) is not in `ALLOWED_EMAILS`, immediately `signOut(auth)` and show an unauthorized-account notice.
- **Offline Persistence:** Initialize Firestore with `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })`, falling back gracefully to `getFirestore(app)` in headless/test environments lacking IndexedDB.

---

## 5. Remaining Implementation Steps (Steps A–F)

### Step A: `src/lib/firebase.ts` & `src/lib/storage.ts`

1. Create `src/lib/firebase.ts` exporting `app`, `auth`, `db`, `googleProvider`, `ALLOWED_EMAILS`, `signInWithGoogle()`, `signOutUser()`.
2. Create `src/lib/storage.ts` implementing `useSleepStore()`:
    - **Cloud Sync Mode (when authorized parent is signed in):** Real-time `onSnapshot` subscriptions to `collection(db, 'households/family/events')` (ordered by `timestamp`) and `doc(db, 'households/family/config/settings')`. Offer a 1-click migration banner if local-only events exist in `localStorage` when signing in for the first time.
    - **Local / Demo Mode (before sign-in):** Persists `events` and `settings` in `localStorage` (`sleep-tracker-27:events`, `sleep-tracker-27:settings`).
    - **Actions:** `addEvent`, `updateEvent`, `deleteEvent`, `updateSettings`, `loadDemoData()`, `exportJson()`, `clearAllLocalData()`.
    - **`loadDemoData()` specification:** Generates ~14 days of realistic ~4.5-month-old infant sleep events ending today _while deliberately injecting 3 realistic missed taps_ so the user can immediately preview interpolation:
        1. A missed morning wake (`asleep` at bedtime → `asleep` at Nap 1, triggering morning wake interpolation).
        2. A missed 2:00 AM return-to-sleep (`awake` at 2:15 AM → `awake` at 6:45 AM, triggering night-wake return interpolation).
        3. An unlogged Saturday afternoon/evening block (triggering untracked gap bridging without corrupting real averages).
           Also temporarily adjust a demo `birthDate` (~4.5 months ago, storing an easy 1-click restore to `'2027-01-01'` via _Reset to Clean Jan 1, 2027 Slate_) so demo mode exercises the 4–5 month schedule & PLS Coach alerts meaningfully!

### Step B: `src/types.ts`, `src/lib/temporal.ts` & `src/data/plsPlaybook.ts`

1. **`src/types.ts`:**
    - `SleepEvent`: `{ id: string; type: 'asleep' | 'awake'; timestamp: number; comment?: string; createdBy?: string; updatedAt: number }`
    - `SegmentSource`: `'real' | 'interpolated'`
    - `SleepSegment`: `{ id: string; state: 'asleep' | 'awake'; startMs: number; endMs: number; durationMin: number; source: SegmentSource; interpolationReason?: string; kind?: 'nap' | 'night-sleep' | 'wake-window' | 'night-wake' | 'active'; napIndex?: number; startEventId?: string; endEventId?: string; comment?: string; isOngoing?: boolean }`
    - `BabySettings`: `{ babyName: string; birthDate: string; adjustedBirthDate?: string; dayStartHour: number; nightStartHour: number; includeInterpolatedInStats: boolean; theme: 'dark' | 'system' | 'light' }` (defaults: `'Baby'`, `'2027-01-01'`, `dayStartHour: 7`, `nightStartHour: 19`, `includeInterpolatedInStats: false`, `theme: 'dark'`).
2. **`src/lib/temporal.ts`:**
    - Parse `birthDate` / `adjustedBirthDate` with `Temporal.PlainDate.from(isoDateStr)` (never `new Date('2027-01-01')`) so calendar dates never shift west of UTC.
    - Compute exact age (`days`, `weeks`, `months`, `isPreArrival`, `daysUntilDue`) using `Temporal.PlainDate` `.until()`.
    - Compute elapsed live spans with `Temporal.ZonedDateTime` `.since(start, { smallestUnit: 'minute' })` and format human-readable durations via `.round({ largestUnit: 'hour' }).toLocaleString('en-US', { style: 'narrow' })` (`Intl.DurationFormat`), handling `< 1m` cleanly.
    - Convert `<input type="datetime-local">` ↔ epoch milliseconds through `Temporal.PlainDateTime.from(...)` + `Temporal.Now.timeZoneId()` (`toZonedDateTime` / `toPlainDateTime().toString({ smallestUnit: 'minute' })`).
3. **`src/data/plsPlaybook.ts`:**
    - Read `/Users/rutledgeb/Projects/Personal/Sleep/chapters/99-all-book-tables-verbatim.md` and `/Users/rutledgeb/Projects/Personal/Sleep/00-MASTER-CHRONOLOGICAL-CHEAT-SHEET.md` to ensure 100% exact encoding of:
        - **Table 1:** Wake Time before Bedtime (`Ch. 3`)
        - **Table 2:** Wake Times, Naptimes, and Bedtime (`Ch. 5`)
        - **Table 5:** The 5-Minute Plan check-in intervals (`5*(N+K-1)` mins, `Ch. 7`)
        - **Table 6:** Night Feedings by Age (`Ch. 9` — informational reference)
        - **Table 7:** Granular Wake-Time Duration (`Birth–6w`, `6w–3m`, `4m`, `5m`, `6m`, `7m`, `8m`, `9–12m`, `12–18m`, `18m+`, `Ch. 10`)
        - **All 8 Chronological Phases** (`Pre-Arrival`, `0–6w`, `6–12w`, `2–4m` FIO, `4–6m` Nursery + SLIP + Midnight/3–4h Rule, `5–9m` Nap Ninja + 3→2 Drop, `9–18m` Regressions + 2→1 Drop, `18m–3y+` Crib Defense + Boundaries & Bait / Fade)
        - **Rapid Setback Cards:** Spring Forward (`-15m/day` x 4d), Fall Back (`1h evening bright light + dark silent morning`), Time-Zone Travel (`1h/day`), Illness/Sleep Debt (`stroller/carrier naps + -30m early bed for 3–7d`), Teething (`chilled not frozen; no benzocaine/amber beads`), Reflux Red Flags.

### Step C: Core Engines (`interpolation.ts`, `stats.ts`, `plsCoach.ts`)

1. **`src/engine/interpolation.ts`:**
    - Sort raw events ascending by `timestamp`.
    - Compute rolling 7-day baselines from clean opposite-state pairs (falling back to PLS `Table 2` / `Table 7` age norms): `typicalMorningWakeMinOfDay`, `typicalBedtimeMinOfDay`, `typicalNapMin`, `typicalWakeWindowMin`, `typicalNightWakeMin` (`~25m`).
    - Reconstruct every adjacent pair `(A, B)`:
        - Valid opposite pair (`asleep <= 14.5h` night / `<= 4.5h` day; `awake <= ageMaxWakeSpan`) → `'real'` segment.
        - **`asleep -> asleep`** (missed `awake`):
            - Overnight→morning (`3h <= gap <= 18h`): infer wake near `clamp(morningWakeMs, A.ts + 90m, B.ts - min(typicalWakeWindowMs, gap * 0.35))`; emit `'interpolated'` night-sleep + `'interpolated'` wake-window with human-readable `interpolationReason`.
            - Daytime (`1h <= gap <= 12h`): infer nap end at `A.ts + clamp(typicalNapMin, 30m, gap * 0.55)`; emit `'interpolated'` nap + `'interpolated'` wake-window.
        - **`awake -> awake`** (missed `asleep`):
            - Mid-night wake (`nightStartHour + 1h .. dayStartHour - 1h`, `1h <= gap <= 10h`): infer return to sleep at `A.ts + clamp(typicalNightWakeMin, 15m, min(45m, gap * 0.3))`; emit `'interpolated'` night-wake + `'interpolated'` night-sleep.
            - Daytime/other (`2h <= gap <= 14h`): infer missed nap/sleep starting at `A.ts + min(typicalWakeWindowMs, gap * 0.55)`.
        - **Long untracked gaps (`gap > 16h` or implausible span):** cap outgoing state to typical length (`'interpolated'`), bridge intermediate days/nights with clean schedule-estimated blocks (`'interpolated'`, `interpolationReason: 'Untracked gap bridged from typical schedule'`), and land cleanly into `B`.
        - **Trailing open event (`last -> nowMs`):** `'real'` ongoing segment (`isOngoing: true`) if within plausible bounds; if `> 15h` stale, cap as `'interpolated'` so forgotten timers never claim 48-hour sleeps.
    - Classify each segment across configurable `dayStartHour` (default `7`) / `nightStartHour` (default `19`) into `'nap'` (`napIndex = 1, 2, 3, 4...` per sleep-day), `'night-sleep'`, `'night-wake'`, and `'wake-window'`.
2. **`src/engine/stats.ts`:**
    - Slice segments across any `[rangeStartMs, rangeEndMs]` and group by flexible `sleepDay` (`dayStartHour -> dayStartHour`).
    - Calculate per-day and `1D / 3D / 7D / 30D` aggregate stats: `napCount`, `napDurationsByIndex` (`Nap 1`, `Nap 2`, `Nap 3`, `Nap 4`), `totalDaySleepMin`, `totalNightSleepMin`, `total24hSleepMin`, `totalAwakeMin`, `nightWakeCount`, `longestNightStretchMin`, `wakeWindowsMin`, `preBedWakeWindowMin`, `realCoveragePct`.
    - Respect `settings.includeInterpolatedInStats` (default `false`: multi-day averages exclude `'interpolated'` segments so forgotten weekends never skew averages, with graceful UI note if 100% interpolated).
3. **`src/engine/plsCoach.ts`:**
    - Pure deterministic evaluator `evaluatePlsCoach(segments, events, settings, nowMs)` inspecting `'real'` segments only:
        1. **Live Wake-Window Pacing** vs. `Table 7` age range.
        2. **Post-4:00 PM Micro-Nap Deflation Warning** (`Ch. 3 & 10`: `3–20 min` sleep after `16:00`).
        3. **Bedtime False Starts** (`Ch. 3, 4 & 7`: wake `30–65m` post-bedtime on `>= 2` recent real nights; verifies `1.3x–1.5x` pre-bed wake multiplier + 20–30m feed buffer reminder).
        4. **Night Gaps / Split Nights** (`Ch. 12`: `>= 6m` old + mid-night wake `>= 60m` → prescribes cutting total daily scheduled sleep by exact gap length).
        5. **Bedtime Consistency Check** (`Ch. 3`: `>= 3m` old + bedtime clock spread `> 35m` across last 5+ real nights).
        6. **Habitual `<= 35m` Short-Nap Consolidation** (`Ch. 10`: `>= 6m` old + Nap 1/2 averaging `<= 35m` → Bore-to-Sleep & Wake-to-Sleep guidance).
        7. **3→2 Nap Transition & 12-Month 1-Nap Fake-Out Guardrail** (`Ch. 10 & 12`: at `9.5–13m`, if Nap 2 skipped while Nap 1 `> 60m` → _"Cap Nap 1 at 60m before dropping to 1 nap!"_).
        8. **Optimal Night-1 SLIP Bedtime Calculator** (`Ch. 7`: median real bedtime sleep-onset clock time!).
        9. **Current Phase & Next Milestone Card** (e.g., Pre-Arrival countdown before `2027-01-01`, Week 6 peak + sleep-only paci, Month 2 FIO readiness, Month 4–5 cold-turkey paci exit).

### Step D: Unit Tests (`src/engine/__tests__/engine.test.ts`)

Write and pass `bun test` cases covering:

- Normal `asleep -> awake -> asleep` classification (`Nap 1`, `Nap 2`, `Night Sleep`, `Night Wake`).
- `asleep -> asleep` overnight missed morning wake interpolation.
- `awake -> awake` 2:15 AM night-wake missed return-to-sleep interpolation.
- Multi-day untracked gap bridging while keeping `includeInterpolatedInStats: false` averages accurate.
- `Temporal.PlainDate.from('2027-01-01')` age math with zero UTC timezone shift.
- PLS Coach alerts: False Starts, Split Night Gap exact trim recommendation, Post-4 PM micro-nap warning, and 12-Month Fake-Out guardrail.

### Step E: Modern, Accessible 3:00 AM UI & PWA Assets

1. **`index.html`, `public/manifest.webmanifest`, `public/icon.svg`:**
    - Include `<meta name="color-scheme" content="dark light">`, `<meta name="theme-color" content="#0b1020">`, and Apple PWA standalone tags.
2. **`src/styles/app.css`:**
    - `:root`: define raw light/dark color tokens, `@media (prefers-color-scheme: dark)` fallbacks, `@supports (color: light-dark(white, black))` `light-dark(...)` tokens, `color-scheme: light dark`, `accent-color`, and `scrollbar-color` (NO `scrollbar-width: thin`).
    - Support `[data-theme="dark"]` (default nursery-safe dark theme), `[data-theme="light"]`, and `[data-theme="system"]`, always re-declaring `accent-color` whenever `color-scheme` is overridden on a subtree/root.
    - Never apply `user-select: none` to content text; use `field-sizing: content` and `resize: vertical` on `<textarea>`; use `:user-invalid` (not `:invalid`).
    - `<dialog>` CSS: `dialog:modal { overscroll-behavior: contain; }` and `dialog::backdrop { overflow: hidden; overscroll-behavior: contain; ... }`, never locking scroll via `body { overflow: hidden }`, and scoping dialog layout (`display: grid` / `flex`) strictly inside `dialog[open]`.
    - Tabs CSS: style `[aria-selected="true"]` without dimension-changing properties (`font-weight`, `padding`, etc.) and draw a `3px solid` `border-block-end` on `&::after`; put padding/backgrounds on an inner wrapper `<div>` inside `[role="tabpanel"]` (not on the panel element itself, because of `hidden="until-found"`).
3. **`src/main.tsx`:**
    - Conditionally load `temporal-polyfill` and `@microsoft/focusgroup-polyfill` (`polyfillBodyAndObserve()`) before mounting React `<App />`.
4. **Components (`src/components/`):**
    - `ModalDialog.tsx`: Native `<dialog {...({ closedby: 'any' } as any)} aria-labelledby={titleId}>`, opened via `showModal()`, `dialog.returnValue = ''` reset on `close`, NO `role="dialog"` or `aria-modal`, visible close `<button>`, plus `!('closedBy' in HTMLDialogElement.prototype)` bounding-rect `pointerdown`/`pointerup` light-dismiss fallback for Safari.
    - `EntryView.tsx` (**Screen 1 — Default Home**): Live state hero (`🌙 Asleep` / `☀️ Awake` + elapsed duration via `Temporal` + `Table 7` target range), quick time selector (`Now`, `-5m`, `-10m`, `-15m`, `-30m`, `-1h`, `Custom`), optional comment `<textarea>`, two giant always-tappable buttons (`🌙 Went to Sleep` & `☀️ Woke Up`), 1-tap `Undo` toast, and Recent Events strip.
    - `EventEditDialog.tsx`: Edit event timestamp (`-15m/-5m/+5m/+15m` nudges or exact `datetime-local`), toggle `'asleep'/'awake'`, edit comment, or delete (plus 1-click "Save Interpolated Boundary as Real Event").
    - `GraphsView.tsx`, `RasterChart.tsx`, `TotalsChart.tsx` (**Screen 2 — Graphs & Stats**): `1D / 3D / 7D / 30D` range selector, date window pager, 24h SVG barcode raster (`N1`/`N2`/`N3` labels, solid teal naps, solid indigo night sleep, diagonal-hatched dashed interpolated blocks, coral night-wake ticks, `💬` badges), stacked daily totals vs `Table 2` target band, and full Nap 1/2/3/4 + Night Wake + Completeness stats cards.
    - `PlaybookView.tsx` (**Screen 3 — PLS Coach, Playbook & Timers**): Accessible `focusgroup="tablist nomemory"` + `hidden="until-found"` (`onBeforeMatch`) tabs for **Coach & Alerts**, **Age Playbook & Tables**, and **Book Timers** (live countdown + gentle Web Audio chime for `FIO 15m/20m`, `SLIP 5-Min Plan` Night 1–5 intervals, `10m Night Pause`, `20m Night Party`, `60m Nap Hour`).
    - `SettingsDialog.tsx`: Google Sign-In/Out (showing Blake & Aliyana allowlist + sync status), Baby Name, Birth Date (`2027-01-01`), Preterm Adjusted Date, `dayStartHour` / `nightStartHour`, Theme (`dark` / `system` / `light`), `includeInterpolatedInStats` toggle, _Load 14-Day Sample Data_, _Export JSON_, and _Reset to Clean Jan 1, 2027 Slate_.
    - `App.tsx`: Header with live sync badge + Settings gear button, main active screen, and persistent `<nav aria-label="App sections">` bottom bar (`Log`, `Graphs`, `PLS Coach` with badge count).

### Step F: Verification, README & Deploy Check

1. `bun test` — all unit tests pass (`0 fail`).
2. `bun run typecheck` (`bunx --bun tsc --noEmit`) — zero TypeScript errors.
3. `bun run build` (`bun --bun vite build`) — builds cleanly into `dist/`.
4. Check `bunx --bun firebase-tools login:list` — if authenticated, offer/run `bun run deploy`; otherwise confirm `README.md` clearly documents `bun run dev`, `bun test`, `bunx --bun firebase-tools login`, and `bun run deploy`.
