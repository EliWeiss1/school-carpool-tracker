# Handoff — phases 4, 5 and 6

Written to be read cold, over coffee, assuming you remember nothing.

## The one-paragraph version

`/announce`, `/display` and `/admin` are all built, merged into `master`, and
**deployed to a live Supabase project** (`yqkzspdhrtvwqngsauoo`). All eight Edge
Functions are live, the roster is seeded, and every end-to-end path in section 2
has actually been run against them — the resolver, the write path, RLS, realtime,
the full `/announce` mic flow, and a CSV import including the exact file that
reproduces the critical bug from the review. `lint`, `typecheck`, `test` (429
tests) and `build` all still pass. Two real bugs were only found by this live
run and are already fixed and committed — see section 5.

## 1. What happened, in order

1. **A foundation commit** locked the design system and shared plumbing before
   anything else started, so three screens built in parallel would look like one
   app rather than three.
2. **Three agents built `/announce`, `/display` and `/admin` in parallel**, each
   in its own git worktree on its own branch, so they could not collide.
3. **The five new roster Edge Functions went to a review agent before merging.**
   It found one critical bug and several real ones. Each was reproduced as a
   failing test before it was fixed.
4. **Each branch was merged one at a time**, with all four gates re-run in the
   main checkout after each merge. No agent's word that its tests passed was
   taken on trust — and that turned out to matter (section 5.1).
5. **The project was created and deployed live**, with you running the two
   interactive logins and me driving everything scriptable — schema push, seed,
   secrets, all eight function deploys, and then a full pass of live
   verification: RLS probed directly, the PIN boundary checked, `/display`
   proven to update in real time from a real write, `/announce` walked through
   PIN → mic → candidates → confirm with real PointerEvents, and `/admin`
   walked through a CSV import. Two real bugs surfaced only at this stage
   (section 5.4 and 5.5), both now fixed, tested, and committed.

Every phase branch still exists (`phase-4-announce`, `phase-5-display`,
`phase-6-admin`), so nothing is lost.

## 2. What was run live, and what it proved

This is no longer a to-do list — it is a record of what has been verified. Kept
in the original order so it doubles as the recipe for a second environment
(e.g. a staging project) if you ever need one.

1. **Project created**, linked with `npx supabase link --project-ref
yqkzspdhrtvwqngsauoo -p ""` (empty password works — the CLI only needs it
   for a direct Postgres connection, not for `db push`/`functions deploy`).

2. **`.env.local` filled in.** One real bug here: `NEXT_PUBLIC_SUPABASE_URL`
   was pasted as `https://<ref>.supabase.co/rest/v1/` instead of the bare
   `https://<ref>.supabase.co`. That doubles the path segment supabase-js
   appends and every request 400s with "Invalid path specified in request
   URL" — it broke the seed script first, and would have broken every Edge
   Function call too. Fixed in `.env.local`, and `.env.example`'s comment now
   warns about it explicitly (commit "Warn against a trailing path on the
   Supabase URL" — check `.env.example` if this file is ever regenerated from
   scratch).

3. **Schema pushed**: `npx supabase db push --linked` applied
   `20260902090000_init_carpool_board.sql` cleanly.

4. **Roster seeded**: `npm run seed -- --allow-remote` inserted 36 students
   (6 per grade, K–5) once the URL was fixed.

5. **Secrets set**: `npx supabase secrets set STAFF_PIN=... MOCK_SPEECH=true`.

6. **All eight Edge Functions deployed** with `--use-api` (no Docker on this
   machine): `deepgram-token`, `resolve-name`, `set-status`, `roster-list`,
   `roster-write`, `roster-delete`, `roster-import`, `roster-reset`. This is
   the first time any of the five roster functions, or their
   `supabase-store.deno.ts` code, has ever executed.

7. **Resolver smoke test**, called directly against the deployed function:
   `resolve-name` with `transcript: "Cohen"` returned tier `ambiguous` with
   Maya Cohen (1.000), Elias Kohen (0.980), Zoe Koen (0.970) — exactly matching
   the local resolver run against the same seed roster before deployment.
   Nothing pre-highlighted, as designed.

8. **PIN boundary**, checked on both a phase-3 endpoint (`resolve-name`) and a
   phase-6 endpoint (`roster-list`): a wrong PIN returns `401` with "That PIN
   was not recognised" on both.

9. **RLS boundary**, probed directly with the public anon key (the one that
   ships in the browser bundle) against the raw REST API — not the anon
   client's happy path, the actual boundary:
   - read `students` → **200**, as designed
   - insert / update / delete `students` → **401**, all three
   - read `status_events` → **401**
     All five held. This is the RLS policy doing its job against a real
     Postgres instance, not the PGlite approximation.

10. **Write path and idempotency**, exercised live end to end on Maya Cohen:
    confirm arrived (`changed: true, logged: true`, `arrived_at` set by the
    trigger) → confirm again (`changed: false, logged: true`, no second audit
    row) → undo to waiting (`changed: true`, `arrived_at` cleared). Matches
    the documented contract exactly.

11. **`/display` realtime, end to end**: opened the page against the live
    project, called `set-status` over HTTP from outside the browser, and
    watched the tile change colour and flash with **no reload** — driven
    purely by the Postgres Changes subscription. This is the one thing no
    unit test could ever establish.

12. **`/announce`, full mic flow, with real PointerEvents** (not
    `element.click()`, which does not exercise `onPressStart`/`onPressEnd`):
    PIN gate → press and hold the mic button (caption went CONNECTING… →
    LISTENING) → release → resolver returned "Heard 'Cohen' — more than one
    close match" with all three candidates, nothing preselected. Separately,
    typed search on "Cohen" → tap Maya Cohen → confirmed arrived, with the
    2-minute undo window showing and counting down live.

13. **`/admin` CSV import, end to end**, including the file that reproduces
    the critical bug from the pre-merge review:
    - A file with a missing last name, a duplicate row, and a blank row
      produced a validation report: 5 rows in file, 2 will import, 2 skipped
      with reasons, 1 blank — exactly right, including the short-row-padding
      fix from the review (a row missing its trailing `grade`/`class` columns
      still imported rather than being rejected).
    - A file with an unterminated quotation mark (`Maya,"Cohen\nTheo,Ng...`)
      was refused outright with "A quotation mark in this file is never
      closed" — confirming the critical fix from the review holds against the
      real backend, not just the unit tests.

14. **`roster-write`'s duplicate guard and `roster-reset`'s idempotency**,
    both checked live: re-adding Maya Cohen returned `409` "already on the
    roster"; calling reset once returned `{reset: 1, logged: 1}`, calling it
    again immediately returned `{reset: 0, logged: 0}`.

## 3. Verified by execution vs. merely written

**Verified, now including live execution against real Postgres and real Edge
Functions:**

- Every `_shared/` module, all eight request handlers, both API clients, the
  CSV parser, the PIN session, the realtime reconciler — unit-tested as before.
- All eight Edge Function entrypoints and both `*.deno.ts` files — previously
  unrun, now deployed and called over HTTP (section 2, steps 6–14).
- The RLS boundary — previously PGlite-only, now also confirmed against a real
  hosted Postgres instance with the real anon key (section 2, step 9).
- The full write path, its idempotency, and the trigger-derived `arrived_at` —
  previously asserted by handler tests against a fake store, now confirmed
  against real Postgres (section 2, step 10).
- Realtime delivery end to end — previously synthetic-payload tests only, now
  proven with a real browser holding a real Postgres Changes subscription
  (section 2, step 11).
- The full `/announce` and `/admin` user flows — previously screenshotted in
  isolation with no backend, now driven end to end with real PointerEvents and
  real file uploads against the live project (section 2, steps 12–13).

**Still not run:**

- `npx supabase db reset` / `npx supabase functions serve` — the **local**
  Docker-based stack. There is no Docker on this machine, and the hosted
  project was used for everything instead, which is the real deploy path
  anyway. If a local dev loop is ever wanted, this is the one gap left.
- Real Deepgram. `MOCK_SPEECH=true` was used throughout, per the standing
  instruction never to spend real Deepgram credits. The mock speech source and
  the token/keyterm contract are both tested; the actual WebSocket client for
  a real Deepgram connection was out of scope for phase 4 and still is.
- Load beyond a handful of manual requests. Nothing here says anything about
  behaviour under concurrent load — not a concern this app's traffic profile
  should ever create, but worth naming as a gap rather than leaving implicit.

## 4. Judgment calls

Made deliberately. Each is reversible.

1. **`/display` sits on a fixed ink ground (#10151f) while the other two screens
   are light.** CLAUDE.md pins the app to `color-scheme: light` so red and green
   read identically regardless of the OS theme. A fixed dark ground for one
   route does not conflict with that — it is not a theme and does not follow the
   OS — and a wall-mounted TV in a lit corridor washes out a white board long
   before it washes out a dark one. It forced a second pair of status colours
   (`waiting-screen`, `arrived-screen`), because `#b91c1c` disappears on ink.

2. **The brand colour is marigold (#f5a524).** CLAUDE.md bans the default
   Tailwind palette and wants a derived brand colour, but red and green are
   already spoken for as _status_ and nothing may compete with them. Marigold is
   the school-bus and crossing-guard hue, is unmistakable against both at
   distance, and never fills a status tile.

3. **Three typefaces, where CLAUDE.md asked for a pairing.** Archivo for
   display, IBM Plex Sans for body, and IBM Plex Mono added for genuinely
   tabular content — grades, class groups, times, CSV row numbers — which do not
   line up in the body face.

4. **The PIN gate opens optimistically.** It accepts an optional verification
   probe, but there is no cheap credentials-only endpoint, so verifying at the
   gate would mean spending a real call. The server re-checks the PIN on every
   request including the write path, so this costs correctness nothing: a wrong
   PIN surfaces on the first action instead of at the gate.

5. **`deviceId` is regenerated per tab and never persisted.** The server already
   treats it as forgeable and keys the PIN budget on client IP instead, so a
   stable cross-session id would be a tracking identifier for no benefit.

6. **Duplicate detection is check-then-write, not a database constraint.** A
   unique index on `(lower(first_name), lower(last_name))` is the durable fix
   and closes the race; the handler check closes the realistic case (a
   double-tapped button, a retried import from one office computer) without a
   migration. Confirmed live (section 2, step 14). **Recommended follow-up**,
   noted in section 6.

7. **The roster endpoints got a tighter PIN-guess budget than the announce
   ones** (3 per 10 minutes rather than 10). The budget does not pool across
   isolates, so the attacker's real allowance is the sum across every deployed
   endpoint; adding five endpoints at 10 each would have taken it from 30 to 80,
   cutting the time to break a 6-digit PIN from months to weeks. The office
   types its PIN once at the gate, so 3 costs it nothing. `pin-budget.test.ts`
   enforces this on every future endpoint.

8. **`/display` is `h-screen`, not `min-h-screen`,** and its grid rows stretch
   to fill the board. A screen screwed to a wall is exactly one screen tall and
   nobody scrolls it. If a roster ever grows long enough that tiles would drop
   below their legibility floor, the grid scrolls internally and the header
   stays put — at that point, use the grade/class filter or a second board.

9. **The realtime transition check compares against the roster already held,
   not the payload's `old`.** The table does carry FULL replica identity, so
   `old` is a complete row — but once a payload has passed the freshness check,
   the held row is the most recently accepted state, which is a more reliable
   "before" than a value off the wire. It also keeps working if `old` is ever
   absent.

10. **`/display` tile type is sized from the tile's own height (CSS container
    queries), not the viewport.** Only the tile knows how many rows a live
    roster actually needs. This replaced a `vw`-based approach that looked
    right at 26 students and clipped names at 36 — see section 5.4.

## 5. Things found by checking rather than trusting

Recorded because each one was invisible in the code, and because they say
something about where to look next time.

1. **`npm run lint` was silently not running for two of the three agents.**
   Both reported an ESLint "@next/next plugin conflicted" error and both worked
   around it by invoking `eslint` directly — so their "lint passes" claims came
   from a different command than the gate. ESLint's legacy config cascade was
   climbing out of the project into the parent repo's config, which happens to
   any checkout nested inside another copy of the repo. `"root": true` in
   `.eslintrc.json` fixes it; verified from both a nested worktree and the main
   checkout.

2. **Two contrast and legibility defects on `/announce`, found by screenshotting
   the running page.** The header's Lock control used the light-surface button
   variant on the ink header bar — about 2:1 contrast. And a full sentence was
   set in the eyebrow treatment (wide-tracked caps), which slows reading rather
   than emphasising it, while pointing at a search box that was above it, not
   below. Neither is visible in the source.

3. **`/admin` blamed the wifi for an unconfigured app.** `admin-api.ts` had
   duplicated the whole transport from `api.ts`, including a bug that had
   already been fixed there. There is now one transport, with the wording that
   legitimately differs between the kerb and the office as a parameter.

4. **`/display` passed every gate and still failed its own acceptance
   criterion — twice.** First against a 26-student mock roster (screenshot-only
   phase): fixed-height rows and viewport-based type left ~40% of a 1920×1080
   board as empty black with 30px surnames, and long names truncated
   ("van der Berg" → "van der …"). Fixed with `1fr` rows, `h-screen`, and
   `vw`-based type. **Then, the moment it ran against the real 36-student
   roster, the same clipping came back** — the `vw` sizing had been tuned by
   eye against the mock roster's 26 names across four rows, and the real
   roster's six rows left less height per tile than the viewport-based
   formula assumed. Font size is now derived from the tile's own height via
   CSS container queries instead, so the board self-adjusts regardless of
   roster size. Verified by screenshot at both 26 and 36 students. **The
   lesson: a screen whose row count depends on live data is not verified by a
   mock roster of a different size, no matter how carefully the mock one was
   checked.**

5. **A stuck-microphone false alarm, investigated and turned into a real
   defensive fix.** Automated testing of the mic button with a synthetic
   `pointerup` after a `pointerdown` left the UI stuck reading "listening."
   Traced it down: `releasePointerCapture` throws `InvalidPointerId` when the
   pointer is no longer active, and the throw was aborting the handler before
   it reached `onPressEnd` — in production this is the mic staying open
   one-handed, outdoors, with a queue of cars waiting. The actual live app
   (real PointerEvents, no synthetic gap) never exhibited the bug — this was a
   test-harness artifact, not an observed failure — but the underlying
   exception risk is real, so both capture calls are now best-effort while
   `onPressStart`/`onPressEnd` are guaranteed to run regardless.

6. **`npm run build` clobbers `.next/` while `npm run dev` is running**, leaving
   the dev server 404ing its own JavaScript and CSS — the page loads unstyled
   and nothing is interactive. If you see that, stop the dev server,
   `rm -rf .next`, and restart it. Do not run the two at the same time.

## 6. Known issues, deliberately not fixed

These came out of the pre-merge review of the roster write paths, or out of
running everything live. Each is real; none blocked the merge or the
deployment; all are yours to decide on. **Item 1 is now live**, not
theoretical — the PIN in `.env.local` really does authorize roster deletion on
the real project right now.

1. **One shared PIN now authorizes roster deletion, and this is live.** Before
   phase 6, the worst a leaked PIN could do was mark a child arrived — undone
   in one tap. It can now delete students one at a time, and there is no undo
   and no record of who did it. Every phone at the kerb holds this PIN, and
   the deployed `roster-delete` function checks the exact same `STAFF_PIN`.
   **Suggested fix:** a separate `ADMIN_PIN` env var for the five `roster-*`
   endpoints. `guardRequest` already takes the PIN as a dependency, so it is
   one line per entrypoint plus one secret (`npx supabase secrets set
ADMIN_PIN=...`) plus a redeploy of the five roster functions. **Trade-off:**
   one more thing for the office to manage and get wrong at deploy time. This
   one genuinely wants a human decision.

2. **`roster-reset` can un-arrive a child confirmed moments earlier.** The reset
   is "set every arrived student to waiting", unqualified by time. A child
   confirmed at 08:59:59.9 and a reset at 08:59:59.95 means the teacher sees a
   red tile for a child already collected, plus an audit row claiming they went
   back to waiting. The window is tiny and the fix is a timestamp filter on the
   update. If the reset is only ever pressed first thing in the morning with the
   board already empty, this cannot happen and is not worth the change.

3. **Deleting a student nulls `student_id` on their audit rows.** The FK is
   `on delete set null` — verified by executing the migration, not by reading
   it — so the rows survive but stop naming anyone. Since `status_events` exists
   so false accepts can be reviewed and the matching thresholds retuned, and you
   cannot tell a false accept from a true one without knowing which child it
   was, removing a graduating class turns that much tuning data into noise.
   **Suggested fix:** add a `student_last_name` column to `status_events`,
   written at insert time.

4. **A unique index on `(lower(first_name), lower(last_name))`** would make the
   duplicate protection airtight rather than merely reliable in practice — the
   current guard is check-then-write and races under two truly simultaneous
   requests, which the live test above does not exercise. See judgment call 6.

5. **Raw Postgres error text reaches the client** in a 503 body. Pre-existing
   from phase 3, not introduced here, but there are now five more paths to it.
   Worth logging the detail and returning a fixed sentence instead.

6. **No scheduled morning reset.** It was the optional item on the phase 6
   checklist and was not built. The manual reset in `/admin` covers it, and it
   was confirmed idempotent live (section 2, step 14).

## 7. Where things are

- **The live project**: `yqkzspdhrtvwqngsauoo.supabase.co`. `.env.local` in
  this checkout points at it. 36 students seeded, all currently `waiting` (the
  arrivals used to test flash/chime/undo were all reverted after each check).
- **Design system** — CLAUDE.md, "Design system — Curbside". Hex values, class
  patterns and the rules three parallel agents were held to. Read this before
  touching any screen, and check it first if the screens ever stop looking like
  one app.
- **Per-phase state** — the checklists in CLAUDE.md, kept honest about what is
  verified by execution versus merely written.
- **Screenshots** — `npm run screenshot <url> --size display|phone|desk`. The
  `screenshots/` directory is gitignored, including the ad-hoc live-verification
  scripts used to produce this handoff (`call.mjs`, `rls-probe.mjs`,
  `realtime-test.mjs`, `announce-e2e.mjs`, `admin-csv-e2e.mjs`) — they are not
  part of the app and were not committed, but the commands they ran are
  reproducible from this file if you want to re-verify anything.
- **Phase 7** (polish, accessibility, deploy to Vercel, a README for daily staff
  use) has not been started. The backend deploy that phase 7 assumed would
  still be pending is now done; what is left is the Vercel side and the
  non-technical staff documentation.
