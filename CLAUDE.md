# CLAUDE.md — Carpool Pickup Board

## What this is

An internal web app for a school carpool pickup line. Someone standing outside
speaks a student's last name into a phone or tablet. The app transcribes it,
matches it against the enrolled roster, and — after a one-tap confirmation —
flips that student from **waiting** (red) to **arrived** (green) on a big
shared screen inside, with a flash animation and an audio chime so the teacher
notices without watching the screen.

Small, low-traffic, single-building, no user accounts. **Optimize for
reliability and low maintenance, not scale.**

**Status: phases 1–3 done and committed; the phase 4–6 foundation (design
system, `api.ts`, PIN session, shared UI, screenshot tooling) is committed on top
of them.** The per-phase checklists below are the source of truth for what is
built — keep them updated as you go.

## Architecture — decided, do not re-litigate

| Concern          | Decision                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Frontend         | Next.js 14 (App Router) + TypeScript + Tailwind, deployed on Vercel                                            |
| Data             | Supabase Postgres (`students`, `status_events`)                                                                |
| Realtime         | Supabase Realtime (Postgres Changes) pushes status updates to every browser                                    |
| Secrets / writes | Supabase Edge Functions (Deno). The only thing that writes to the DB.                                          |
| Speech-to-text   | Deepgram Nova-3 streaming with **Keyterm Prompting** seeded from roster surnames                               |
| Deepgram auth    | An Edge Function mints a short-lived token per session. The permanent key never reaches the browser.           |
| Matching         | Server-side fuzzy + phonetic resolver in the Edge Function, three-tier confidence policy                       |
| Auth             | None. `/display` is public read-only; `/announce` and `/admin` require a shared staff PIN checked server-side. |

**Non-negotiables:**

- A transcription **never** auto-writes a status change. A human always taps to
  confirm. A wrong name on a teacher-facing board is worse than a second of
  friction.
- The Deepgram key and the Supabase service-role key exist only in server-side
  env vars. Never in the client bundle, never under a `NEXT_PUBLIC_*` name.
- The staff PIN is held in memory for the device session only. Never
  `localStorage`, never a cookie, never sent anywhere but the Edge Function.
- Raw audio is not persisted. It is discarded after transcription.

## Dev commands

| Command              | What it does                                                    |
| -------------------- | --------------------------------------------------------------- |
| `npm run dev`        | Next.js dev server on http://localhost:3000                     |
| `npm run build`      | Production build (also the real typecheck of app code)          |
| `npm run lint`       | ESLint via `next lint`                                          |
| `npm run typecheck`  | `tsc --noEmit`                                                  |
| `npm test`           | Vitest, single run                                              |
| `npm run test:watch` | Vitest in watch mode                                            |
| `npm run seed`       | Load the sample dev roster into Supabase (`scripts/seed.ts`)    |
| `npm run format`     | Prettier across the repo                                        |
| `npm run screenshot` | `<url> --size display\|phone\|desk\|WxH --out FILE` (Puppeteer) |

Supabase CLI is intentionally not a project dependency — use `npx`:

| Command                                | What it does                                  |
| -------------------------------------- | --------------------------------------------- |
| `npx supabase start`                   | Local Postgres + Realtime + Functions stack   |
| `npx supabase db reset`                | Re-apply every migration to the local DB      |
| `npx supabase functions serve`         | Run Edge Functions locally                    |
| `npx supabase db push`                 | Apply migrations to the linked hosted project |
| `npx supabase functions deploy <name>` | Deploy one Edge Function                      |

## Directory map

```
src/
  app/
    page.tsx            landing page linking to the three screens
    layout.tsx          root layout, light-only color scheme
    globals.css         Tailwind entry + reduced-motion guard
    announce/           phase 4 — mic capture, candidate confirm, search fallback
    display/            phase 5 — realtime status grid, flash + chime
    admin/              phase 6 — roster CRUD, CSV import, reset
  components/
    ui/                 the shared kit: Button, PageHeader, HazardRule, PinGate,
                        ErrorBanner, EmptyState, LoadingState
    announce/ display/ admin/   route-specific presentational components
  lib/
    env.ts              single place env vars are read and validated
    api.ts              typed client for the three Edge Functions + ApiError
    pin-session.ts      the PIN store: memory only, no React
    use-pin-session.ts  the React hook over it
    device-id.ts        per-tab id for the rate-limit bucket
    cn.ts               class-name join
    supabase/
      browser.ts        memoised anon client for client components
      server.ts         anon client for server components (never service-role)
  types/db.ts           row types + a Database type for supabase-js generics
supabase/
  config.toml           local stack config
  migrations/           SQL schema + RLS policies
    schema.test.ts      applies the migrations to PGlite and asserts RLS + triggers
  functions/            Deno Edge Functions
    _shared/            runtime-neutral logic: runs in Deno *and* under Vitest
      normalize.ts      case-folding, diacritics, comparison keys, phrases
      phonetic.ts       surname-tuned sound coder (the C/K/Q fold lives here)
      similarity.ts     Jaro-Winkler
      resolver.ts       the matcher + MATCH_POLICY thresholds
      keyterms.ts       roster -> Deepgram keyterm list, waiting students first
      deepgram.ts       short-lived token minting (fetch injected, mockable)
      pin.ts            constant-time staff PIN check, fails closed
      rate-limit.ts     per-device fixed window, injectable clock
      http.ts           JSON/CORS/error shapes
      ports.ts          RosterStore interface — the seam the handlers depend on
      handlers/         one request handler per endpoint, no Deno APIs
      *.deno.ts         Deno-only wiring (env, supabase-js store)
    deepgram-token/     entrypoint: mint a session token + keyterms
    resolve-name/       entrypoint: transcript -> ranked candidates (read-only)
    set-status/         entrypoint: the only write path
  seed/roster.ts        sample dev roster, deliberately full of confusable surnames
scripts/seed.ts         loads the sample roster (refuses non-local without --allow-remote)
scripts/screenshot.mjs  Puppeteer: URL + viewport -> PNG (npm run screenshot)
.claude/agents/         subagent definitions (see Model delegation)
```

## Environment variables

Names only — real values live in `.env.local` (gitignored), Vercel project
settings, and Supabase project settings. `.env.example` is the checked-in
template.

| Name                                 | Where it is read                  | Purpose                                                              |
| ------------------------------------ | --------------------------------- | -------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`           | browser + server                  | Supabase project URL                                                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`      | browser + server                  | Anon key; RLS limits it to reading the roster                        |
| `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` | browser                           | Optional override for the Edge Function host (local CLI)             |
| `NEXT_PUBLIC_MOCK_SPEECH`            | browser                           | `true` fakes Deepgram in the browser so dev burns no credits         |
| `SUPABASE_SERVICE_ROLE_KEY`          | Edge Functions, `scripts/seed.ts` | The only credential allowed to write rows                            |
| `DEEPGRAM_API_KEY`                   | Edge Function only                | Permanent Deepgram key used to mint short-lived tokens               |
| `STAFF_PIN`                          | Edge Function only                | Shared staff PIN gating every write                                  |
| `MOCK_SPEECH`                        | Edge Function                     | `true` returns canned tokens/transcripts instead of calling Deepgram |

## Edge Function endpoints

Every one is `POST`, takes `pin` and `deviceId` in the JSON body, answers CORS
preflight, and returns errors as `{ "error": "one sentence a staff member can
act on" }`. Base URL is `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` or
`<supabase-url>/functions/v1`.

| Endpoint         | Body (beyond pin/deviceId)                                                       | Returns                              |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------ |
| `deepgram-token` | `grade?`, `classGroup?`                                                          | `{ token, expiresIn, keyterms[] }`   |
| `resolve-name`   | `alternatives[{transcript,confidence}]` or `transcript`, `grade?`, `classGroup?` | `{ tier, transcript, candidates[] }` |
| `set-status`     | `studentId`, `status`, `source`, `matchConfidence?`, `transcript?`               | `{ student, changed, logged }`       |

Notes phase 4 will need:

- `tier` is `clear` (pre-highlight the first candidate, still require a tap),
  `ambiguous` (show 2–3 equal-weight buttons, nothing preselected), or `none`
  (go straight to the typed search). `none` is a **200**, not an error — a 4xx
  would look like a fault to someone standing outside in the rain.
- `resolve-name` never writes. Only `set-status` does, and it re-checks the PIN
  itself rather than trusting that `resolve-name` already did.
- `set-status` is idempotent: confirming an already-arrived student returns
  `changed: false`, logs no second audit row, and fires no second flash.
- `arrived_at` is ignored if a client sends it; a database trigger derives it.
- Undo is just `set-status` with `status: "waiting"`. The ~2-minute window is a
  client-side affordance — the server does not enforce it (see judgment calls).
- `source` is **required** (`voice` | `manual` | `admin`). It is not defaulted:
  a client that omitted it used to log a voice confirmation as hand-picked,
  dropping the transcript and score that `status_events` exists to collect.
- `logged: false` means the status change stuck but its audit row did not. Worth
  surfacing quietly; it is never a reason to undo the change.
- Two rate limits, doing different jobs:
  - **Spam**, keyed on the self-reported `deviceId`: 20/min token, 40/min
    resolve, 30/min status. Per isolate, so best-effort. Not a security control.
  - **PIN guessing**, keyed on client IP and spent only on a _wrong_ PIN: 10 per
    10 minutes, answered with 429. This one is a security control — `deviceId`
    comes out of the request body, so keying the PIN budget on it meant there
    was no budget at all.
- Error statuses the UI must handle: `401` wrong PIN, `429` throttled
  (`retry-after` header), `503` database unreachable **or** `STAFF_PIN` unset on
  the server (the message distinguishes them), `502` speech service down — all
  of which fall back to the typed search.

## Coding conventions

- TypeScript strict mode. No `any` in committed code — reach for `unknown` plus
  a narrowing check.
- Server Components by default. Add `"use client"` only for a component that
  needs state, effects, or browser APIs (mic, audio, realtime socket).
- Keep components small and mostly presentational; put logic in `src/lib/` so it
  can be unit-tested without rendering.
- Tailwind for all styling. No CSS modules, no styled-components. Status colors
  come from the `waiting` / `arrived` scales in `tailwind.config.ts` — do not
  hand-roll new reds and greens.
- Comment the **why**, not the what. If the code explains itself, leave it be.
- Every env var is read through `src/lib/env.ts` (or `Deno.env` inside an Edge
  Function), never as inline `process.env` scattered through components.
- Edge Functions are Deno, not Node: they use URL / `npm:` imports and are
  excluded from the ESLint config on purpose. Only the two Deno-touching file
  patterns are excluded from `tsc` — `functions/*/index.ts` and
  `functions/**/*.deno.ts`. Everything in `_shared/` is plain TypeScript, so it
  is typechecked by `npm run typecheck` and unit-tested by Vitest. Relative
  imports inside `functions/` carry the `.ts` extension because Deno requires it
  (`allowImportingTsExtensions` is on for this reason).
- A handler never touches `Deno.env` or supabase-js. It takes what it needs
  through the `RosterStore` port and its deps object, which is what lets the
  whole request path be tested with no database and no runtime.
- Errors a school staff member could hit need a human-readable message on
  screen, not a console log.

## Design system — "Curbside"

Locked in the phase 4–6 foundation commit. **Every token below already exists in
`tailwind.config.ts` or `globals.css`.** Do not invent a colour, a font, a shadow
or a spacing step. If a screen needs something that is not here, add it to the
config and to this section in the same commit, so the next screen inherits it.

**The idea.** The visual language is the pickup lane itself: road markings,
crossing-guard hi-vis, school-bus marigold on asphalt ink. It is not decorative
— it is the only vernacular that is already legible outdoors, at speed, from a
distance, to people who are not looking directly at it.

### Colour

| Token                            | Hex                           | Used for                                              |
| -------------------------------- | ----------------------------- | ----------------------------------------------------- |
| `ink` / `curb-900`               | `#10151f`                     | Headers, the `/display` ground, all display type      |
| `curb-800` → `curb-600`          | `#232a34` `#353d4a` `#4c5666` | Body copy on light, secondary text on dark            |
| `curb-500` / `curb-400`          | `#6b7686` `#98a2b3`           | Captions, disabled, hairline emphasis                 |
| `curb-300` / `curb-200`          | `#c3cad5` `#dde1e8`           | Borders. `200` at rest, `300`+ on hover               |
| `curb-100` / `curb-50`           | `#eceef2` `#f6f7f9`           | Pressed fills; the page ground                        |
| `marigold-500`                   | `#f5a524`                     | **The brand.** Primary buttons, focus rings, eyebrows |
| `marigold-400` / `600`           | `#ffc24d` `#d9860b`           | Primary hover / active. `400` for text on ink         |
| `marigold-50`                    | `#fff7e6`                     | Warning banner ground                                 |
| `waiting`                        | `#b91c1c`                     | Waiting, on light surfaces                            |
| `waiting-screen`                 | `#f04438`                     | Waiting, **only** on the `/display` ink ground        |
| `arrived`                        | `#15803d`                     | Arrived, on light surfaces                            |
| `arrived-screen`                 | `#12b76a`                     | Arrived, **only** on the `/display` ink ground        |
| `*-soft` / `*-border` / `*-deep` | see config                    | Status banner fills, borders, pressed states          |

**The one inviolable rule: red and green mean waiting and arrived, and nothing
else, anywhere in the app.** No red delete buttons outside a genuine
back-to-waiting action, no green success toasts. That is why the brand colour is
marigold — it is unmistakable against both at twenty feet. Marigold never fills a
status tile.

`/display` is the one route on an ink ground. That is not a dark theme and does
not follow the OS: it is fixed, because a wall-mounted TV in a lit corridor
washes out a white board long before it washes out a dark one. Use only the
`-screen` status values there; `waiting`/`arrived` disappear against `ink`.

### Typography

Three faces, wired up in `layout.tsx` via `next/font`, reached through Tailwind:

| Class          | Face                      | Job                                                                                                     |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `font-display` | Archivo 600/700/800       | Every heading, every button label, every name on `/display`                                             |
| `font-sans`    | IBM Plex Sans 400/500/600 | All body copy and form fields. The default on `body`                                                    |
| `font-mono`    | IBM Plex Mono 400/500     | Only things that line up in columns: grades, class groups, times, device ids, CSV row numbers, eyebrows |

- Anything `text-4xl` or larger takes `tracking-display` (`-0.03em`).
- Body copy runs at `line-height: 1.7`, set once on `body`. Headings are `1.1`.
- Eyebrows are `font-mono text-xs uppercase tracking-eyebrow` (`0.14em`), in
  `marigold-400` on ink or `curb-500` on light. They name the audience for the
  screen, never the software.
- Type scale, and nothing between: `text-sm` `text-base` `text-lg` `text-xl`
  `text-2xl` `text-3xl` `text-5xl` `text-6xl`. `/display` tiles go bigger —
  measure those against a screenshot at 1920×1080, not against the scale.

### Spacing

One ladder, in Tailwind steps: **1, 2, 3, 4, 6, 8, 12, 16, 24** (4px → 96px).
Nothing else. Gaps between cards are `gap-4`; padding inside a card is `p-6`;
a section break is `py-12`.

Touch targets are not a spacing decision, they are a requirement:
`min-h-tap` (56px) is the floor anywhere; `min-h-tap-lg` (64px) is the floor for
**everything** on `/announce`; `min-h-candidate` (96px) is a candidate confirm
button. `/announce` is used one-handed, outdoors, sometimes gloved.

### Elevation

Three levels and nothing in between. Shadows are ink-tinted and layered — never
`shadow-md`, never a neutral black.

| Level    | Classes                                                   | What lives here                       |
| -------- | --------------------------------------------------------- | ------------------------------------- |
| base     | `bg-curb-50`                                              | The page ground                       |
| elevated | `bg-white border border-curb-200 rounded-2xl shadow-card` | Cards, list rows, panels              |
| floating | `bg-white rounded-2xl shadow-float`                       | The PIN gate, confirm sheets, dialogs |

`shadow-press` is the inset used on `:active`. On `/display`, tiles use
`shadow-tile-waiting` / `shadow-tile-arrived`, which carry their own colour.

Radii: `rounded-xl` for controls, `rounded-2xl` for surfaces. Nothing else.

### Motion

Only `transform` and `opacity`. **Never `transition-all`** — on the slow stick PC
driving the display that is a repaint of every tile. Name the properties:
`transition-[transform,box-shadow] duration-200 ease-spring`.

| Animation                                        | Where                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `animate-arrival-flash` + `animate-arrival-glow` | A tile going waiting → arrived on `/display`. The glow is an opacity overlay, not a `filter` |
| `animate-listen-pulse`                           | The ring on the push-to-talk button while the mic is open                                    |
| `animate-hazard-slide`                           | The signature band, while listening                                                          |
| `animate-tile-in`                                | A row or tile entering                                                                       |

`ease-spring` (`cubic-bezier(0.34,1.56,0.64,1)`) for anything a finger touches;
`ease-out` for everything else. The `prefers-reduced-motion` guard in
`globals.css` neutralises all of them globally — verify with the OS setting on,
and make sure the arrival is still legible without the flash (it is: the tile
changes colour).

### The signature: the hazard rule

`<HazardRule />` — a 6px band of marigold/ink diagonal stripes, the painted
warning band from the kerb. **It appears exactly once per screen**, directly
under the header, and it is the only ornament in the app. Spend the boldness
here and keep everything else quiet.

On `/announce` it earns a second job: `<HazardRule live />` slides the stripes
while the microphone is open. That is the listening indicator — readable at arm's
length in sunlight in a way a small red dot is not. The motion is a `translateX`
on an over-wide child, never a `background-position`.

### Interactive states

Every clickable element has hover, `focus-visible` and active. No exceptions.
Use the `.focus-ring` utility (3px `marigold-500`, 2px offset) — it is the one
focus treatment in the app and it reads on both the light routes and the ink
`/display` ground, which a slate ring does not.

### Shared components — reuse, do not reimplement

`src/components/ui/`: `Button` (variants `primary` | `secondary` | `quiet` |
`quiet-ink` | `danger`; sizes `sm` | `md` | `tap` | `candidate`), `PageHeader`,
`HazardRule`, `PinGate`, `ErrorBanner`, `EmptyState`, `LoadingState`.

A button in `PageHeader`'s `action` slot sits on the ink bar and must use
`quiet-ink`, not `quiet` — `quiet` is `curb-600`, which against `#10151f` is
about 2:1 and not a readable control.

The eyebrow treatment (`font-mono uppercase tracking-eyebrow`) is for one- and
two-word labels only. A whole sentence in wide-tracked caps is harder to read,
not more emphatic — explanations go in sentence case.

`src/lib/`: `api.ts` (typed client for all three endpoints, `ApiError` with
`kind`/`status`/`retryAfterSeconds`), `use-pin-session.ts` + `pin-session.ts`
(PIN in memory for the tab, never storage), `device-id.ts`, `cn.ts`.

### Words

Sentence case everywhere. Name things by what a staff member controls, never by
how the system is built — "Send back to waiting", not "Revert status". A control
keeps its name through the whole flow: a button that says "Confirm" produces a
line that says "Confirmed". Errors say what happened and what to do next, in one
sentence, and the Edge Functions already write that sentence — render it
verbatim rather than paraphrasing it. Empty states say what is true and what to
do next.

## Build phases and definition of done

Work the phases in order. After each one: summarize what was built, run
`npm run lint && npm run typecheck && npm test`, and **pause for review before
starting the next phase.**

### Phase 1 — Scaffold

- [x] Next.js 14 + TS + Tailwind, App Router, `src/` dir, `@/*` alias
- [x] Supabase client helpers and typed row definitions
- [x] `.env.example` with names only; `.env.local` gitignored
- [x] Lint, typecheck, Prettier, and Vitest all runnable and green
- [x] This `CLAUDE.md` and the two subagent definitions

### Phase 2 — Data layer

- [x] `students` and `status_events` migrations matching the agreed schema
- [x] RLS on: public `select` on `students`; **no** public `insert`/`update`/`delete`
- [x] `status_events` not publicly readable
- [x] Realtime publication includes `students`
- [x] Seed script with a sample roster including deliberately confusable surnames
- [ ] `npx supabase db reset && npm run seed` works from clean — **unverified,
      no Docker on this machine.** The migration itself is verified by execution
      (see below); the seed script's insert path against a live Supabase is not.

The migration is tested by _running_ it, not by reading it:
`supabase/migrations/schema.test.ts` boots an in-process Postgres
([PGlite](https://pglite.dev)), recreates the roles and publication the Supabase
platform provides, applies every `.sql` file in order, and then asserts the
trigger behaviour and the RLS boundary as `anon`, `authenticated`, and
`service_role`. No Docker, no hosted project, no credits. Add new migrations
and this picks them up automatically.

### Phase 3 — Edge Function + matching

- [x] PIN-gated Deepgram token minting; permanent key never returned to a client
- [x] Resolver: normalize (case-fold, strip punctuation, fold diacritics) + fuzzy + phonetic + aliases
- [x] Three-tier output: clear match / ambiguous / no match
- [x] Unit tests with mocked Deepgram responses — **no real API calls in tests**
- [x] Named near-miss cases covered: Cohen / Kohen / Koen / Cowan and similar
- [x] **Wrong-name cases covered too** — 38 surnames that are _not_ on the
      roster (Cruz, Shin, Lim, Gwen, Wang, Nasir…) plus mismatched first names
      ("Maya Chen") assert nothing is ever pre-highlighted. That is the
      direction that hurts, and the first pass had it entirely untested.
- [x] Write path re-validates the PIN and logs a `status_events` row
- [x] Per-device rate limit on the announce endpoint, **plus** a separate
      per-IP budget for wrong PINs

**How phase 3 is verified.** Everything in `functions/_shared/` — the whole
matching pipeline, the PIN check, the rate limiter, the keyterm builder, the
Deepgram token minting (with an injected `fetch`), and all three request
handlers end to end against an in-memory roster — is covered by Vitest and runs
in `npm test` with no Deno, no Docker, no database and no API credits. What is
**not** verified by execution on this machine: the three `index.ts` entrypoints
and the two `*.deno.ts` files, because there is no Deno and no Docker here to run
`npx supabase functions serve` against. They are deliberately thin — env reading
and supabase-js wiring, no logic — but they are unrun code until someone starts
the local stack.

**What makes a match "clear"** (all four must hold; `MATCH_POLICY` in
`resolver.ts` holds every number, and they are meant to be retuned from real
`status_events` data):

1. Score ≥ `clearScore` 0.88. Not 0.80: Jaro alone rates a single substitution
   in a four-letter surname at 0.833, which made Shin a confident Chin.
2. Margin over the runner-up ≥ `clearMargin` 0.07. This one has little headroom
   — the genuine confusable pairs sit at 0.11–0.13, and the "Layla Nguyen"
   disambiguation needs it below 0.10. Re-run the cluster tests before touching it.
3. The score did not depend on the phonetic floor. Sharing a sound is enough to
   be _offered_, never enough to be _pre-highlighted_: Cruz and Garza share a
   code, and so do Berg and Brook.
4. Either an exact key hit, or a name of at least `minInexactClearLength` 6
   letters. Below that a single edit is too large a share of the word for
   distance to mean anything (Lim scores 0.91 against Li).

Failing any of these still leaves the child on screen as a tap target — it only
withholds the pre-highlight, which costs one tap.

**Judgment calls made in phase 3, for the record:**

- **The undo window is not enforced server-side.** `set-status` accepts
  `waiting` from any PIN holder at any time; the server cannot tell a 2-minute
  undo from an admin reset without inventing state. Phase 4 enforces the window
  in the UI.
- **The PIN guessing budget is keyed on client IP**, which on school wifi is one
  NAT address for everyone. Ten wrong PINs in ten minutes therefore throttles the
  whole building, and someone on the network could burn the budget deliberately.
  The alternative — no throttle — lets a 4-digit PIN fall in about an hour, so
  the throttle wins. Mitigation is a longer PIN, not a looser limit.
- **No global fallback limiter.** A school-wide lockout would let anyone deny
  staff access to the board at 3pm, which is a worse failure here than a slow
  distributed guess.
- **CORS stays `*`.** The PIN is the boundary; an origin allow-list would break
  on every Vercel preview URL and protects nothing the PIN does not.

**Agreed approach (approved, don't re-derive):** the resolver is a
**zero-dependency** TypeScript module — a surname-tuned phonetic coder plus
Jaro-Winkler, no `double-metaphone` or similar. The reason is that the exact same
file has to run in Deno (inside the Edge Function) _and_ under Vitest in Node;
a shared npm dependency makes that resolution awkward, and the phonetic rules we
need are narrow. The key rule is folding C/K/Q to a single onset class, which is
what makes Cohen / Kohen / Koen collide correctly while string distance still
separates them. Test fixtures come from `supabase/seed/roster.ts`, which is built
adversarially for exactly this.

Hand the finished resolver to the `careful-review` subagent before checking these
boxes.

### Phase 4 — `/announce`

- [ ] PIN entry once per device session, memory only
- [ ] Optional grade / class filter that narrows the keyterm list
- [ ] Push-to-talk with an unmistakable listening state
- [ ] Top 2–3 candidates as large tap targets; nothing auto-commits
- [ ] Searchable/typeable roster fallback always available
- [ ] Undo window (~2 minutes) after a confirm
- [ ] Works end to end with `NEXT_PUBLIC_MOCK_SPEECH=true`

### Phase 5 — `/display`

- [ ] Realtime subscription updates the grid with no reload
- [ ] Red/green grid readable across a room
- [ ] Flash animation + audio chime on a new arrival
- [ ] Reconnect **refetches** current state rather than waiting for the next event
- [ ] Honors `prefers-reduced-motion`

### Phase 6 — `/admin`

- [ ] Add / edit / remove students, including the `aliases` field
- [ ] CSV import for initial roster setup, with a validation report
- [ ] "Reset all to waiting" with a confirmation step
- [ ] Optional: scheduled Edge Function doing the morning reset

### Phase 7 — Polish

- [ ] Error and empty states on all three pages
- [ ] Accessibility pass: keyboard paths, focus states, contrast, screen-reader labels
- [ ] Deployed to Vercel + Supabase with env vars set in both
- [ ] README written for a **non-technical staff member's daily use**, not just setup

## Model delegation

The main session runs on **Sonnet** for most implementation work. Two subagents
live in `.claude/agents/`:

### `boilerplate` (Haiku) — mechanical, low-ambiguity work

Invoke it for: CRUD scaffolding, repetitive component generation, the CSV
import parser, renames and formatting sweeps, routine test fixtures, and
turning a described roster into seed data. Give it the exact shape you want; it
should not be making design decisions.

### `careful-review` (Opus) — the parts where a mistake is expensive

Invoke it for:

- the matching / confidence-threshold algorithm and its thresholds
- RLS policy and Edge Function security review
- realtime race conditions (e.g. two near-simultaneous arrivals for one student)
- any architecture call where the requirements above are genuinely ambiguous

### When to just work inline on Sonnet

Most of the app. Wiring a page, adding a component, writing a straightforward
test, fixing a clear bug. Delegation has a cost — a subagent starts cold and
re-derives context you already have. Don't spawn one for work you could finish
in a few edits.

**Escalating to Opus inline (no subagent) is also fine** when a genuinely hard
bug shows up mid-task and handing it off would lose the context that makes it
tractable.

## Process rules

- **Never run anything that spends real Deepgram or Supabase credits without
  asking first.** Use mock mode and the local Supabase stack by default.
- Never commit secrets. `.env.local` stays local.
- Flag judgment calls in the phase summary rather than burying them in a diff.

- **Invoke the `frontend-design` skill** before writing any frontend code, every session, no exceptions.

## Local Server

- **Always serve on localhost** — never screenshot a `file:///` URL.
- Start the dev server with `npm run dev` (Next.js, http://localhost:3000). There
  is no `serve.mjs` in this project and there should not be — Next compiles
  Tailwind and the App Router routes, so a static file server would serve nothing.
- Run it in the background before taking screenshots. If it is already running,
  do not start a second instance.
- `/display` and `/announce` need a reachable Supabase; use the local stack
  (`npx supabase start`) plus `NEXT_PUBLIC_MOCK_SPEECH=true`.

## Screenshot Workflow

No screenshot tooling is installed in this project yet — there is no
`screenshot.mjs` and Puppeteer is not a dependency. Set one up before the phase 5
`/display` work, where reading the board across a room is the whole point.

When comparing a rendered screen against a reference:

- Be specific: "heading is 32px but reference shows ~24px", "card gap is 16px but
  should be 24px".
- Check spacing/padding, font size/weight/line-height, colors (exact hex),
  alignment, border-radius, shadows, image sizing.

## Output Defaults

- Next.js App Router pages and React components under `src/`. **Not** a single
  `index.html`, and **not** inline `<style>` blocks.
- Tailwind is a build-time dependency compiled through PostCSS. **Never** add the
  `cdn.tailwindcss.com` script tag — it would ship a second, conflicting Tailwind
  and ignore `tailwind.config.ts`.
- Mobile-first responsive. `/announce` is used one-handed on a phone outdoors;
  `/display` is a fixed large screen viewed from across a room. Design for both
  ends, not for a laptop.

## Anti-Generic Guardrails

- **Colors:** Never use default Tailwind palette (indigo-500, blue-600, etc.). Pick a custom brand color and derive from it.
- **Shadows:** Never use flat `shadow-md`. Use layered, color-tinted shadows with low opacity.
- **Typography:** Never use the same font for headings and body. Pair a display/serif with a clean sans. Apply tight tracking (`-0.03em`) on large headings, generous line-height (`1.7`) on body.
- **Gradients:** Layer multiple radial gradients. Add grain/texture via SVG noise filter for depth.
- **Animations:** Only animate `transform` and `opacity`. Never `transition-all`. Use spring-style easing.
- **Interactive states:** Every clickable element needs hover, focus-visible, and active states. No exceptions.
- **Images:** Add a gradient overlay (`bg-gradient-to-t from-black/60`) and a color treatment layer with `mix-blend-multiply`.
- **Spacing:** Use intentional, consistent spacing tokens — not random Tailwind steps.
- **Depth:** Surfaces should have a layering system (base → elevated → floating), not all sit at the same z-plane.

**Parallelism**
categorize/group tasks so that they can be run in parallel when safe to do so. This should be marked whenever making a plan.

**Coding methodology**
Use SOLID principle of design when coding. it should be clean, documented clearly, modular and easily scalable
