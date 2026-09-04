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

**Read `HANDOFF.md` before doing anything else in this repo.** It is the
narrative account of everything built, deployed, verified live, and left
open — written to be read cold. This file's status lines and checklists are
the durable summary; `HANDOFF.md` is the detail behind them.

**Status: phases 1–6 are built and merged on `master`, plus a post-phase-6
carpools + class-filtered-display + multi-select-announce feature (see
"Carpools" below the endpoint table) covering all three screens. Phase 7
(polish, accessibility, deploy, staff README) has not been started.** The
per-phase checklists below are the source of truth — keep them updated as you
go.

**The carpools feature is built, tested (533 tests, all green), typechecked,
linted, built, committed and pushed (`f5ea436` on `master`), and deployed
live**: the migration is applied to the linked Supabase project, all nine
Edge Functions (the original eight plus the new `carpool-write`) are
deployed, and Vercel's connected auto-deploy picked up the push. Verified
live, not just deployed — a real carpool was created linking two seeded
students, `resolve-name` was confirmed to collapse them into a single `clear`
match (the actual payoff of the whole feature), `set-status` was confirmed to
mark both in one call and to be idempotent on a repeat, and the test carpool
and status changes were then cleaned up — the live roster is back to its
original 36 students, 0 carpools. The user separately confirmed the deployed
site itself works. See `HANDOFF.md` section 10 for the full account.

**Grade has since been removed as a separate concept.** Classification is
now a single field, `class_group`, with a fixed set of values (`K1`, `K2`,
`1st`, `2nd`, `3rd`, `4th`, `5th`, in `src/lib/classes.ts`) backing dropdowns
on `/admin` and `/announce` in place of the old two free-text fields. The
sample seed roster (`supabase/seed/roster.ts`) was rewritten to 105 Jewish-
named students (15 per class), keeping the file's adversarial confusable-
surname-cluster design. `/display`'s board is now visibly denser at that
scale — see "Carpools" below for the class-filter dropdown and the
per-section grid layout fix that made it possible.

**Built, tested (527 tests, all green), typechecked, linted, built,
committed and pushed (`4148bd2` on `master`), and deployed live**: the
`20260903120000_drop_grade.sql` migration is applied to the linked Supabase
project, all nine Edge Functions were redeployed (their shared store/handler
code changed, same reasoning as the carpools deploy), and the live roster
was wiped and reseeded with the new 105-student roster via
`npm run seed -- --allow-remote`. Verified live: `roster-list` returns
exactly 105 students across the 7 classes (15 each) with no `grade` field on
any row; `resolve-name` on "Cohen" reproduces the same three-way ambiguous
Cohen-family match (Miriam/Aaron/Rivka Cohen) the local resolver tests
predict; the PIN boundary still 401s a wrong PIN on the redeployed
`resolve-name`. One unrelated stale carpool ("Test carpool", left over from
an earlier session and never touched by the reseed, since `scripts/seed.ts`
only wipes `students`) was found during verification and deleted, leaving
the live project at exactly 105 students, 0 carpools. Vercel's connected
auto-deploy picked up the push for the frontend.

**All nine Edge Functions (the original eight, plus `carpool-write`) are
deployed to a live Supabase project, and every end-to-end path has been run
against it**: schema pushed, roster seeded, RLS probed directly with the anon
key, the PIN boundary checked on both a phase-3 and a phase-6 endpoint,
`/display` proven to update from a real `set-status` call with no reload,
`/announce` walked through PIN → mic → candidates → confirm with mock speech,
`/admin` walked through a CSV import producing a validation report —
including the file that reproduces the critical unterminated-quote bug,
confirmed still rejected — and the carpool collapse walked through live
end-to-end (see "Carpools" below and `HANDOFF.md` section 10). Two real
defects from phases 1–6 were only
found by this: a font-sizing regression on `/display` that clipped names
against the real 36-student roster (fixed, verified at both 26 and 36
students), and a Puppeteer-only false alarm on the mic button that led to a
defensive fix on its own merits. See `HANDOFF.md` for the full account.

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
    announce/           candidate-list.tsx renders both a lone student and a
                        whole carpool; multi-select is a toggle in this list
    display/            class-filter.tsx + section-heading.tsx group the board
                        by class, on top of the per-section grid + tile pieces
    admin/              carpool-manager.tsx (create/edit/delete a carpool,
                        assign members) alongside the roster CRUD pieces
  lib/
    env.ts              single place env vars are read and validated
    api.ts              typed client for the three announce/display Edge
                        Functions + ApiError (resolve/set-status carry
                        carpools and plural student ids -- see below)
    admin-api.ts        typed client for the five roster + carpool-write
                        Edge Functions /admin calls
    announce-reducer.ts /announce's state machine: candidates carry
                        `students[]` + `carpool`, multi-select is opt-in
    display-sections.ts pure grouping + per-viewer class filter for /display
    pin-session.ts      the PIN store: memory only, no React
    use-pin-session.ts  the React hook over it
    device-id.ts        per-tab id for the rate-limit bucket
    cn.ts               class-name join
    supabase/
      browser.ts        memoised anon client for client components
      server.ts         anon client for server components (never service-role)
  types/db.ts           row types + a Database type for supabase-js generics
                        (Student.carpool_id, the Carpool type)
supabase/
  config.toml           local stack config
  migrations/           SQL schema + RLS policies
    schema.test.ts      applies the migrations to PGlite and asserts RLS + triggers
  functions/            Deno Edge Functions
    _shared/            runtime-neutral logic: runs in Deno *and* under Vitest
      normalize.ts      case-folding, diacritics, comparison keys, phrases
      phonetic.ts       surname-tuned sound coder (the C/K/Q fold lives here)
      similarity.ts     Jaro-Winkler
      resolver.ts       rankCandidates + tierFor (see below) + MATCH_POLICY
      keyterms.ts       roster + carpool names -> Deepgram keyterm list
      deepgram.ts       short-lived token minting (fetch injected, mockable)
      pin.ts            constant-time staff PIN check, fails closed
      rate-limit.ts     per-device fixed window, injectable clock
      http.ts           JSON/CORS/error shapes
      ports.ts          RosterStore interface — the seam the handlers depend on
      handlers/         one request handler per endpoint, no Deno APIs
        carpool-write.ts  create/update/delete a carpool + replace its members
      *.deno.ts         Deno-only wiring (env, supabase-js store)
    deepgram-token/     entrypoint: mint a session token + keyterms
    resolve-name/       entrypoint: transcript -> ranked candidates, collapsed
                        by carpool (read-only)
    set-status/         entrypoint: the only write path — one or many students
    carpool-write/      entrypoint: create/update/delete a carpool
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

| Endpoint         | Body (beyond pin/deviceId)                                                       | Returns                                          |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------------------- |
| `deepgram-token` | `classGroup?`                                                          | `{ token, expiresIn, keyterms[] }`               |
| `resolve-name`   | `alternatives[{transcript,confidence}]` or `transcript`, `classGroup?` | `{ tier, transcript, candidates[] }`             |
| `set-status`     | `studentId` **or** `studentIds[]`, `status`, `source`, `matchConfidence?`, `transcript?`, `carpoolId?` | `{ students[], changed[], logged, missing[] }` |
| `carpool-write`  | `action: "create"\|"update"\|"delete"`, `carpoolId?`, `name?`, `aliases?`, `memberIds?` | `{ carpool, members[], created }` or `{ deleted }` |

Notes phase 4 will need:

- `tier` is `clear` (pre-highlight the first candidate, still require a tap),
  `ambiguous` (show 2–3 equal-weight buttons, nothing preselected), or `none`
  (go straight to the typed search). `none` is a **200**, not an error — a 4xx
  would look like a fault to someone standing outside in the rain.
- `resolve-name` never writes. Only `set-status` does, and it re-checks the PIN
  itself rather than trusting that `resolve-name` already did.
- `resolve-name`'s candidates carry `students[]` (one or more) and `carpool`
  (null, or the group they were collapsed into) rather than a single
  `student` — see "Carpools" below for how and why they're grouped before the
  tier policy runs.
- `set-status` accepts one student or several (a whole carpool, or a
  multi-select confirm from `/announce`) through the same endpoint, and always
  answers with the plural shape: `changed` names only the ids that actually
  moved, `missing` names ids not on the roster at all, and `logged` counts
  audit rows written (never a reason to retry). A single-student confirm is
  simply the one-element case of this — nothing distinguishes it at the wire
  level any more.
- `set-status` is idempotent per id: a student already in the requested status
  is absent from `changed`, logs no second audit row, and fires no second
  flash — true individually, so confirming a 3-member carpool where one
  already arrived still moves and logs the other two.
- `arrived_at` is ignored if a client sends it; a database trigger derives it.
- Undo is just `set-status` with `status: "waiting"` and the same id(s). The
  ~2-minute window is a client-side affordance — the server does not enforce
  it (see judgment calls).
- `source` is **required** (`voice` | `manual` | `admin`). It is not defaulted:
  a client that omitted it used to log a voice confirmation as hand-picked,
  dropping the transcript and score that `status_events` exists to collect.
- `logged` less than `changed.length` means the status change(s) stuck but not
  every audit row did. Worth surfacing quietly; it is never a reason to undo.
- Two rate limits, doing different jobs:
  - **Spam**, keyed on the self-reported `deviceId`: 20/min token, 40/min
    resolve, 30/min status, 30/min carpool-write. Per isolate, so
    best-effort. Not a security control.
  - **PIN guessing**, keyed on client IP and spent only on a _wrong_ PIN: 10
    per 10 minutes on the announce/status endpoints, 3 per 10 minutes on every
    roster/carpool endpoint (see `pin-budget.test.ts`, which sums this across
    every deployed function and fails the build if the total creeps past 50).
    This one is a security control — `deviceId` comes out of the request
    body, so keying the PIN budget on it meant there was no budget at all.
- Error statuses the UI must handle: `401` wrong PIN, `429` throttled
  (`retry-after` header), `503` database unreachable **or** `STAFF_PIN` unset on
  the server (the message distinguishes them), `502` speech service down — all
  of which fall back to the typed search.

## Carpools

A carpool is its own row (`public.carpools`: `name`, `aliases`) with a
callable identity of its own, not a text tag on a student. `students.carpool_id`
links a child to at most one carpool (`on delete set null`, so deleting a
carpool never touches the roster), and `status_events.carpool_id` records
when a status change came from confirming a whole carpool at once — both
nulled rather than cascaded, the same pattern `student_id`'s FK already used.
RLS on `carpools` has **no policy and no grants at all**: `/display` never
needs a carpool's name, so anon/authenticated can neither read nor write it,
matching `status_events`' boundary rather than `students`' public-read one.

**How a spoken carpool name resolves.** `resolve.ts` folds every carpool into
the same ranking pass as students — a carpool becomes one more
`ResolverStudent` with its name standing in for a surname (an empty first
name, so it folds onto the surname key the same way a real student's does) —
then **collapses** candidates that share a `carpool_id` into one group,
keeping the best-scoring member's score and match metadata, before the tier
policy (`tierFor`) runs on the collapsed list. The collapse is the reason two
siblings who each score 1.00 on their own surname resolve to one **clear**
candidate instead of two **ambiguous** ones: uncollapsed, their margin over
each other is zero, which `MATCH_POLICY.clearMargin` is built to withhold a
pre-highlight over; collapsed, the margin is measured against the next
different family, which is the comparison that actually matters for "should
this one tap be trusted." `resolver.ts` itself is unchanged in every other
respect — `rankCandidates` + `tierFor` is a behavior-preserving split of the
old `resolveName` (all 63 pre-existing resolver tests pass unchanged), and
`resolveName` still exists as `tierFor(rankCandidates(...))` for any caller
that doesn't need to regroup first.

**Confirming a carpool is one tap, no per-member checkboxes** — the
announcer's decision was already made by tapping the carpool candidate;
asking again per child would be the friction carpools exist to remove. Ad-hoc
multi-student announcing (unrelated candidates, not a carpool) is a separate,
opt-in "Announce several" toggle on `/announce`'s candidate list: off by
default, in which case a tap confirms immediately exactly as it always has.
On, a tap checks a candidate instead, and one "Confirm N arrived" button
sends a single `set-status` call for the whole batch. It is deliberately a
second, explicit action rather than automatic, because two high-scoring
candidates can mean "both are right" or "I'm not sure which," and only a
person standing there can tell those apart.

**`/display` groups the board into class sections with a per-viewer filter**
(`display-sections.ts`, pure and unit-tested, the same treatment
`realtime-reconcile.ts` gets). The filter is entirely client-side — several
teachers can each filter to their own class at the same time off the one
public realtime subscription, with no server state and no extra query — and
is remembered per-browser in `localStorage` (a per-device convenience, not
the staff PIN CLAUDE.md's storage rule is about) plus overridable via
`?class=` for a bookmarked classroom tablet. The chime and flash
are scoped to the filter (`visibleIds`) so a 3rd-class teacher's screen is
never chimed for a 5th-class arrival, and changing the filter never
retroactively flashes anything. Below `sm`, `/display` becomes `min-h-screen`
and scrolls normally rather than staying viewport-locked — the one
deliberate departure from the phase 5 `h-screen` decision, on the grounds
that a phone is not a wall.

The class filter itself is a `<select>` dropdown (`class-filter.tsx`), not
the chip row phase 5 originally built — a deliberate trade made when the
roster grew to 7 classes: a chip row of 8 options (7 classes + "All") eats
real header space on a screen that has none to spare, and a dropdown is more
compact. This does give up the chip row's original rationale (documented in
its own comment: a chip reads identically on a touchscreen and a wall-mounted
TV in a way a dropdown, which needs a click-to-open, does not) — a real
trade-off, not a free improvement, made because 8 options no longer fit the
original design.

**A real bug the class filter caught, the same lesson phase 5 already
learned once:** the tile surname's font-size (`.tile-surname` in
`globals.css`) was sized from the container's height alone (`cqh`). A
filtered view can leave just a handful of tiles on screen, so the grid's
`1fr` row grows to fill nearly the whole viewport height while the tile stays
only a few columns wide — a tall, narrow tile that `cqh` alone read as "plenty
of room," sizing a surname that no longer fit the width and wrapping "Garcia"
into "Garc"/"ia". Fixed by taking `min(...cqh, ...cqi)` — the smaller of the
height- and width-based size — for every tile font size, extending the
existing "size from the tile, not the viewport" rule to both axes instead of
just the one the original always-many-rows board happened to vary on.

**A second board bug, found tuning the grid for 105 students:** `BoardGrid`
used to be one flat CSS grid spanning every section, with a heading
(`col-span-full`) sharing the same `grid-auto-rows` track as the tile rows
below it — so a heading's row was stretched to the same `minmax(7rem, 1fr)`
height as a row of tiles, several inches of near-empty space per class
section that was invisible at the old ~36-student, few-section scale and
glaring at 105 students across 7. Fixed by giving every section its own tile
grid (`board-grid.tsx`) rather than one grid shared across sections, so a
heading is a normal block-height element and each section's rows are sized
only by its own tiles. The one place rows still stretch to fill the whole
board is the common single-filtered-class view, kept via `flex-1` on that
one section. The tile floor also moved down, from `minmax(150px, 1fr)`
columns / `minmax(7rem, 1fr)` rows to `minmax(112px, 1fr)` / `minmax(4.5rem,
1fr)` — chosen by screenshotting the real 105-student mock roster
(`display-mock-roster.ts`, itself rewritten to 105 entries for this reason)
until 5 of 7 classes fit one 1080p screen at once with no mid-word wrapping
on all but the very longest surnames (a rare `line-clamp-2` wrap on
"Rosenberg" is an accepted trade, not a bug — see the tile's own container-
query font sizing above).

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
| `font-mono`    | IBM Plex Mono 400/500     | Only things that line up in columns: classes, times, device ids, CSV row numbers, eyebrows |

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
- [x] `npm run seed -- --allow-remote` works against a live, linked Supabase
      project — **verified**: 36 students inserted, grouped correctly by grade.
      `npx supabase db reset` (the local Docker stack variant) is still
      unverified, since there is no Docker on this machine — `npx supabase db
  push --linked` was used against the hosted project instead, which is the
      real deploy path and the one `HANDOFF.md` documents. One real bug caught
      in the process: `NEXT_PUBLIC_SUPABASE_URL` must be the bare project URL
      (`https://<ref>.supabase.co`), not the REST endpoint
      (`.../rest/v1/`) — the latter silently doubles the path segment
      supabase-js appends and every request 400s with "Invalid path specified
      in request URL". `.env.example`'s comment now says so explicitly.

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
in `npm test` with no Deno, no Docker, no database and no API credits.
**Additionally, all three entrypoints and both `*.deno.ts` files are now
deployed to a live Supabase project and have been called over HTTP**: the
`resolve-name` smoke test (Cohen → ambiguous, Maya Cohen / Elias Kohen / Zoe
Koen) matches the local resolver exactly, `set-status` was confirmed
idempotent live (`changed: false` on a repeat, `arrived_at` cleared correctly
on undo), and the PIN boundary was checked with a wrong PIN (401). There is
still no Deno and no Docker on this development machine, so `npx supabase
functions serve` has never been run locally — but the deployed functions
themselves are proven, not merely written.

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

- [x] PIN entry once per device session, memory only
- [x] Optional class filter that narrows the keyterm list
- [x] Push-to-talk with an unmistakable listening state
- [x] Top 2–3 candidates as large tap targets; nothing auto-commits
- [x] Searchable/typeable roster fallback always available
- [x] Undo window (~2 minutes) after a confirm
- [x] Works end to end with `NEXT_PUBLIC_MOCK_SPEECH=true` — **verified live**,
      driven with real PointerEvents against the deployed functions: PIN gate →
      hold-to-talk (CONNECTING → LISTENING captions confirmed) → release →
      `resolve-name` returned tier `ambiguous` with Maya Cohen / Elias Kohen /
      Zoe Koen, nothing preselected → typed search on "Cohen" → tap Maya Cohen
      → `set-status` confirmed her arrived, with the 2-minute undo window
      showing and counting down.
- [x] Real Deepgram streaming client (`src/lib/speech-deepgram.ts`) — built,
      unit-tested, twice reviewed by `careful-review`, and **verified live**:
      `scripts/verify-deepgram-live.ts` minted a real token, connected, and
      transcribed a locally-synthesized "Nguyen" correctly. That run is also
      what caught the one bug review couldn't have: the client authenticated
      with the wrong `Sec-WebSocket-Protocol` scheme (`token` instead of
      `bearer`), which would have made real voice fail silently, every time.
      **Still not tested on a real device** — see "The real Deepgram client"
      below.

**How phase 4 is verified.** The whole screen is a pure reducer
(`src/lib/announce-reducer.ts`) with `announce-screen.tsx` as a thin dispatcher,
so mic status, tier handling, banners, the confirm lifecycle and the undo window
are all unit-tested with no DOM and no network. `speech-mock.ts` implements the
`SpeechSource` interface `speech-deepgram.ts`'s `createDeepgramSpeechSource`
also implements — `announce-screen.tsx` only ever picks which one to call,
based on `NEXT_PUBLIC_MOCK_SPEECH` — and a test on the mock stubs `fetch` and
`WebSocket` to throw and asserts they are never touched, so mock mode cannot
leak a real Deepgram call. `announce-undo.ts` and `announce-token.ts` take an
injected `now`. On top of that, the whole PIN → mic → candidates → confirm
path has been run against the deployed `deepgram-token`, `resolve-name` and
`set-status` functions and the live seeded roster (see `HANDOFF.md`) — with
`NEXT_PUBLIC_MOCK_SPEECH=true`, i.e. exercising everything except the real
speech client itself.

**The real Deepgram client.** `speech-mock.ts` was, for a while, the *only*
`SpeechSource` implementation — `announce-screen.tsx` called it
unconditionally, ignoring `NEXT_PUBLIC_MOCK_SPEECH`, which meant `/announce`'s
voice path had never actually transcribed real speech, in any environment,
ever. (It also meant a real reported bug: a fresh mock instance was built on
every press, resetting its demo script to entry #1 each time, so voice always
"recognized" the same canned name no matter what was said or how many times
the page was reloaded.) Both are fixed: `getSpeechSource()` in
`announce-screen.tsx` now caches one `SpeechSource` per valid token and reuses
it across presses — the `SpeechSource` contract was always meant to support
repeated `start()`/`stop()` cycles on one instance, which is what makes the
mock's own script cycling (and the real client's per-session bookkeeping)
correct — and `createDeepgramSpeechSource` is a real implementation: mic →
Web Audio (`ScriptProcessorNode`, chosen over `MediaRecorder` because
Safari/iOS's MediaRecorder output isn't reliably chunk-streamable, and staff
carry Android, iPhone, and laptops) → 16kHz mono PCM
(`src/lib/audio-resample.ts`, pure and separately unit-tested) → a WebSocket to
Deepgram's live-streaming endpoint, authenticated via the
`Sec-WebSocket-Protocol` header (the browser-safe mechanism Deepgram
documents, since custom `Authorization` headers aren't available to browser
`WebSocket`) using the **`bearer`** subprotocol, not `token` — `token` is for
a permanent API key used directly, while the short-lived JWT
`deepgram-token` hands the browser (it never sends a permanent key) needs the
`Bearer` scheme, the same distinction Deepgram's REST API makes between
`Authorization: Token <key>` and `Authorization: Bearer <JWT>`. Confirmed
empirically before shipping: `["token", <JWT>]` closes immediately (code
1006, no useful error surfaced) while `["bearer", <JWT>]` opens — this was
the one thing code review alone could never have caught, since it depends on
Deepgram's actual server behavior, not anything visible in this repo. →
`CloseStream` on release to force a flush → the final transcript, or a
2-second safety timeout if Deepgram never answers.

Every `start()`/`stop()` cycle is tagged with a `sessionId`, because a rapid
double-press is reachable in real use: `handleMicPressEnd` clears its
press-guard *before* awaiting `stop()`, so a second press can legitimately
begin while the first is still waiting on Deepgram to finalize. `sessionId` is
what keeps a superseded session's late timer, socket event, or in-flight
connect attempt from ever tearing down the session that replaced it, rather
than the mic silently staying live or a stray timer killing a different
press's capture. Two review passes by `careful-review` found five real bugs
in the first draft of this (a promise that could be poisoned before it was
even assigned, a finalize timer with no session identity, an early Deepgram
endpoint discarding what was said next, `cancel()` abandoning a pending
`stop()` instead of resolving it, and a doomed in-flight attempt surviving a
tap-then-press) plus a sixth I found myself on re-read (the mic and socket
staying live for up to the connect timeout if released mid-connect) — all
fixed, each with a regression test reproducing the original failure. A second
review round then caught a regression the first round's own recommended fix
introduced: resolving immediately on an already-known transcript skipped
`CloseStream` entirely, so a self-correction ("Chen" — pause — "no, Chan")
would have locked in the wrong half. Fixed by always letting `CloseStream`
flush before answering; `lastFinal` is the fallback if nothing more comes
back, never a shortcut past it.

**What is proven and what isn't.** 466 tests, lint, typecheck, and build are
all green, and the client's async/session logic is exercised against fake
WebSocket and audio-capture implementations, including overlapping-press
races. **The wire protocol has now also run against the real Deepgram API and
succeeded**: `scripts/verify-deepgram-live.ts` — synthesizing a WAV locally
with Windows SAPI (no cloud) and streaming it through the exact
`buildDeepgramListenUrl`/`downsampleTo16kHz`/`float32ToInt16PCM` functions the
browser client uses — minted a real token, connected, and got back
`{"transcript":"nguyen","confidence":0.976...}` for a synthesized "Nguyen".

That run is *why* this script existed: the first attempt failed with a
same-endpoint 403 (the API key needed Member permission for `/v1/auth/grant`
— fixed by reissuing the key with that role), and the second attempt
connected but the socket closed immediately with no useful error (code 1006).
Empirical testing (three quick real connection attempts, no audio, against
the live API) found why: **`speech-deepgram.ts` had authenticated with the
wrong `Sec-WebSocket-Protocol` scheme.** `options.token` is always a
short-lived JWT from `/v1/auth/grant` — `deepgram-token` never sends a
permanent API key to the browser — and Deepgram authenticates a granted JWT
via `Bearer`, not `Token` (the same split as its REST API's `Authorization`
header). The client shipped with `["token", jwt]`, which Deepgram silently
rejects; `["bearer", jwt]` is what actually opens. This is exactly the kind
of bug two rounds of code review could not have caught — it depends on
Deepgram's real server behavior, not anything visible in this repo — which is
the whole reason this live-verification step existed rather than calling the
first review pass "done."

Fixed and reverified: the full round trip above is with the corrected
`bearer` scheme. `NEXT_PUBLIC_MOCK_SPEECH=true` is still what's deployed to
Vercel production (unrelated to this fix — flipping it is still a separate,
pending step), which is *why* the originally reported "always recognizes the
same name" bug was live in the first place. **Still outstanding: a real
click-and-talk test on an actual iPhone (Safari) and Android phone (Chrome).**
Nothing above touches `MediaRecorder`, Safari, or the app's own PIN/token
flow — it proves the wire protocol and the PCM math, not that
`ScriptProcessorNode` capture behaves identically across real devices, which
is the one thing that needs a human holding the hardware.

Two writes exist in the whole screen, both in user-triggered handlers
(`handleConfirm`, `handleUndo`). There is no code path from a transcript to a
status change that does not pass through a tap.

One defensive fix came out of the live run: `setPointerCapture` /
`releasePointerCapture` both throw `InvalidPointerId` when the pointer is no
longer active, and an uncaught throw on release used to be able to abort the
handler before it reached `onPressEnd` — the failure mode being a microphone
stuck open with the screen reading "listening". Both calls are now
best-effort; starting and stopping the mic never is.

### Phase 5 — `/display`

- [x] Realtime subscription updates the grid with no reload — **verified live**:
      `/display` was opened against the deployed project, a real `set-status`
      call flipped a student to arrived over HTTP, and the tile changed colour
      and flashed with no page reload, driven purely by the Postgres Changes
      subscription.
- [x] Red/green grid readable across a room
- [x] Flash animation + audio chime on a new arrival
- [x] Reconnect **refetches** current state rather than waiting for the next event
- [x] Honors `prefers-reduced-motion`

**How phase 5 is verified.** `realtime-reconcile.ts` is where the bugs in a
realtime UI actually live, so it is pure and dependency-free and driven by
synthetic payloads in Vitest: stale and redelivered payloads discarded on
`updated_at`, a genuine waiting → arrived transition told apart from a rename
or an undo, INSERT and DELETE handled, and a snapshot merge that never clobbers
a fresher realtime row. The chime coalescer is pure with an injected clock, so
five children arriving at once is one chime.

Two deliberate departures from the brief, both defensible:

- The transition check compares against the roster **already held**, not the
  payload's `old`. Once a payload passes the freshness check, the held row is
  the most recently accepted state and is a more reliable "before" than a
  value off the wire — and it still works if `old` is ever absent.
- `/display` is `h-screen`, not `min-h-screen`. A board screwed to a wall is
  exactly one screen and nobody scrolls it; the definite height is also what
  lets the grid's `1fr` rows divide the space instead of resolving to content.

**A real bug only the live 36-student roster caught.** Tile type was originally
sized off the viewport (`vw` units), tuned by eye against a 26-student mock
roster. Against the real seeded roster of 36, the same board has six rows
instead of four, and names clipped in half. Font size is now derived from the
tile's own height via CSS container queries (`.tile-surname` etc. in
`globals.css`), so the board self-adjusts to however many rows the roster
actually needs — verified by screenshot at both 26 and 36 students, nothing
clips at either size. **The lesson for future screens: viewport-relative sizing
on a screen whose row count depends on live data is not verified by a mock
roster of a different size.**

The chime is generated by `scripts/generate-chime.mjs` rather than fetched, and
`public/chime.wav` is committed. Autoplay policy is handled honestly: if the
browser blocks sound before a gesture, a "sound off" control appears in the
header and the board stays fully functional without it. The chime is fired from
the reconciler's `arrivals`, never from an `animationend` listener, so reduced
motion cannot silence it as a side effect.

`?mock=1`, `?empty`, `?flash=1` are dev-only preview modes, gated so they
cannot activate in production. They exist because there is no backend here.

**Known race, on record:** a DELETE landing in the window between a snapshot
query running and its response arriving can be undone by the snapshot re-adding
the row, until the next event for that student. Tombstones would close it and
are not worth the complexity for a single-building board.

### Phase 6 — `/admin`

- [x] Add / edit / remove students, including the `aliases` field
- [x] CSV import for initial roster setup, with a validation report
- [x] "Reset all to waiting" with a confirmation step
- [ ] Optional: scheduled Edge Function doing the morning reset — not built

**Five new Edge Functions**: `roster-list`, `roster-write` (create and update,
the way `set-status` covers both directions), `roster-delete`, `roster-import`,
`roster-reset`. All five go through `guardRequest`, and
`supabase/functions/pin-budget.test.ts` now asserts that across every deployed
entrypoint — the PIN budget does not pool between isolates, so the real
allowance is the sum, and it grew from 30 to 80 the moment five endpoints were
added without anyone noticing. **All five are now deployed and have been run
live**: PIN boundary checked on `roster-list` (401 on a wrong PIN), `roster-write`'s
duplicate guard confirmed against the live roster (409 on re-adding Maya Cohen),
`roster-reset` confirmed idempotent (`reset: 1` then `reset: 0`), and a CSV
import walked through `/admin` end to end — including the exact file that
reproduces the critical unterminated-quote bug, confirmed still refused with
"A quotation mark in this file is never closed."

**How phase 6 is verified.** Handler logic, the store port, the fake store,
`csv-import.ts` and `admin-api.ts` are covered by Vitest, and on top of that
all five entrypoints and the `supabase-store.deno.ts` additions have now run
against real Postgres via the deployed functions (see above and `HANDOFF.md`).
There is still no Deno and no Docker on this development machine, so nothing
here was run _locally_ — but the deployed code is proven, not merely written.
`pin-budget.test.ts` remains the one thing that reads the entrypoints as text
and checks their limiter wiring on every future change, deployed or not.

**Reviewed before merge** by `careful-review`, which cleared mass-assignment,
the `status`/`arrived_at` boundary, RLS, secret leakage and ReDoS, and found
one critical bug and several real ones. Each was reproduced as a failing test
before it was fixed. The critical one: an unterminated quotation mark made the
CSV tokenizer swallow every subsequent row into one field while the validation
report — the entire point of which is to catch that — reported no errors.

**Known and deliberately not fixed** (see HANDOFF.md for the reasoning):
`roster-reset` can race a `set-status` confirmed microseconds earlier; deleting
a student nulls `student_id` on their audit rows, so the history survives but
stops naming them; the duplicate check is check-then-write and a unique index
is the durable fix; and one shared PIN now also authorizes roster deletion.

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
