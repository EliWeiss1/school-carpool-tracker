# Handoff — phases 4, 5 and 6

Written to be read cold, over coffee, assuming you remember nothing.

## The one-paragraph version

`/announce`, `/display` and `/admin` are all built and merged into `master`.
Everything is covered by unit tests, and `lint`, `typecheck`, `test` and `build`
all pass. **Nothing has ever run against a real Supabase project**, because
there is no `.env.local` in this checkout and no project to point it at. So the
code is written and tested; the app is unproven. Section 2 is the list of
commands that changes that, in order, and it takes about twenty minutes.

## 1. What happened overnight

Stage A of the plan — pushing the schema, seeding, setting secrets, deploying
functions, smoke-testing — **was skipped in its entirety**, because `.env.local`
does not exist. The plan says to skip it in that case and carry on, so that is
what happened. Nothing else was blocked by it.

Then, in order:

1. **A foundation commit** locked the design system and shared plumbing before
   anything else started, so three screens built in parallel would look like one
   app rather than three.
2. **Three agents built `/announce`, `/display` and `/admin` in parallel**, each
   in its own git worktree on its own branch, so they could not collide.
3. **The five new roster Edge Functions went to a review agent before merging.**
   It found one critical bug and several real ones. Each was reproduced as a
   failing test before it was fixed.
4. **Each branch was merged one at a time**, with all four gates re-run in the
   main checkout after each merge. I did not take any agent's word that its
   tests passed — and that turned out to matter (see 5.1).

Every branch still exists (`phase-4-announce`, `phase-5-display`,
`phase-6-admin`), so nothing is lost even where master moved.

## 2. What to run this morning, in order

Steps 1–3 are the only things that genuinely need you. Everything after them is
copy-paste.

1. **Create the Supabase project.** <https://supabase.com/dashboard> → New
   project, closest region to the school, free plan. **Save the database
   password** — it is not recoverable.

2. **Create `.env.local`** (it is gitignored; never commit it):

   ```bash
   cp .env.example .env.local
   ```

   From Project Settings → API, fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` — the Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the anon / publishable key
   - `SUPABASE_SERVICE_ROLE_KEY` — the service_role / secret key

   And set these by hand:
   - `NEXT_PUBLIC_MOCK_SPEECH=true`
   - `MOCK_SPEECH=true`
   - `STAFF_PIN=` — **six digits or more.** Four is guessable in about an hour.
   - Leave `DEEPGRAM_API_KEY` empty. Mock mode needs no key and spends nothing.

3. **Two interactive logins.** `<ref>` is the subdomain of your project URL:

   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   ```

4. **Apply the schema and load the sample roster:**

   ```bash
   npx supabase db push
   npm run seed -- --allow-remote
   ```

   The `--allow-remote` flag is mandatory — the seed script refuses a non-local
   database without it, on purpose.

5. **Set the function secrets.** Never set `DEEPGRAM_API_KEY` here, and never
   anything `SUPABASE_`-prefixed — the platform injects those itself:

   ```bash
   npx supabase secrets set STAFF_PIN=<the pin you chose> MOCK_SPEECH=true
   ```

6. **Deploy all eight Edge Functions.** The first three are from phase 3; the
   last five are new and have never been deployed. Add `--use-api` to any that
   complains about Docker:

   ```bash
   npx supabase functions deploy deepgram-token
   npx supabase functions deploy resolve-name
   npx supabase functions deploy set-status
   npx supabase functions deploy roster-list
   npx supabase functions deploy roster-write
   npx supabase functions deploy roster-delete
   npx supabase functions deploy roster-import
   npx supabase functions deploy roster-reset
   ```

   **Deploy all of them.** Missing one gives the screen that uses it a 404,
   which surfaces as a generic "that request could not be completed" — an
   annoying thing to debug.

7. **Smoke-test the resolver:**

   ```bash
   curl -X POST "https://<ref>.supabase.co/functions/v1/resolve-name" \
     -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" \
     -d '{"pin":"<pin>","deviceId":"smoke","transcript":"Cohen"}'
   ```

   Expect tier `ambiguous`, with Maya Cohen (1.000), Elias Kohen (0.980) and
   Zoe Koen (0.970) — confirmed by running the real resolver against the real
   seed roster, so if the deployed function disagrees, the deployment is wrong
   rather than the expectation. Nothing is pre-highlighted, which is the point:
   three children genuinely sound alike and a human picks. If you get `401`
   the PIN in step 5 does not match the one in `.env.local`. If you get `503`
   mentioning the staff PIN, step 5 did not take.

8. **Then the three end-to-end checks nobody has been able to run:**
   - `/display` open in one window; `curl` `set-status` to flip a student →
     the tile flashes and chimes within a second, with no reload.
   - `/announce` with `NEXT_PUBLIC_MOCK_SPEECH=true` → mock transcript →
     candidates → confirm → the `/display` tile turns green. Undo within two
     minutes puts it back.
   - `/admin` → import a CSV with a deliberately broken row → a validation
     report, not a crash. **Also try a file with an unmatched `"` in it** —
     that was the critical bug, and it should now be rejected outright.

## 3. Verified by execution vs. merely written

**Verified by running it:**

- Every `_shared/` module: the matcher, PIN check, rate limiter, keyterms,
  Deepgram token minting with an injected `fetch`, and all eight request
  handlers end-to-end against an in-memory roster.
- All the client logic: the announce reducer and undo timer, the CSV parser,
  both API clients, the PIN session, the realtime reconciler.
- The migrations, applied to an in-process Postgres (PGlite) with the RLS
  boundary asserted as `anon`, `authenticated` and `service_role`.
- That the pages render, and that they degrade to a readable error rather than
  a blank screen when there is no backend. Checked by screenshot, not by
  reading the JSX — which is how three real defects were found.

**Written but never executed:**

- All eight Edge Function `index.ts` entrypoints and the `*.deno.ts` files.
  There is no Deno and no Docker on this machine. They are thin — env reading
  and supabase-js wiring — but they are unrun. The one automated check they
  have is `supabase/functions/pin-budget.test.ts`, which reads them as text.
- Every round trip between a browser and Supabase: realtime delivery, the
  resolve → confirm → display flash chain, and every roster CRUD operation
  against real Postgres rather than the in-memory fake.
- `npx supabase db push` and `npm run seed` against a hosted project.

## 4. Judgment calls

Made deliberately, without waking you. Each is reversible.

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
   migration. **Recommended follow-up**, noted in section 6.

7. **The roster endpoints got a tighter PIN-guess budget than the announce
   ones** (3 per 10 minutes rather than 10). The budget does not pool across
   isolates, so the attacker's real allowance is the sum across every deployed
   endpoint; adding five endpoints at 10 each would have taken it from 30 to 80,
   cutting the time to break a 6-digit PIN from months to weeks. The office
   types its PIN once at the gate, so 3 costs it nothing.

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

## 5. Things I found by checking rather than trusting

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
   criterion.** At 1920x1080 with a 26-child roster it left roughly 40% of the
   screen as empty black while the surnames sat at about 30px — on a board whose
   entire purpose is being read across a room. Three things caused it: the grid
   packed fixed-height rows from the top, the surname was a fixed step off the
   type scale, and `min-h-screen` meant there was never a definite height to
   divide, so the last row fell off the bottom. Long surnames were also
   truncating — "van der Berg" rendered as "van der ..." — and a pickup board
   that will not show a child's name has stopped doing its job. All fixed; the
   board now fills the screen with names at about 46px. **None of this is
   visible in the source, in a test, or in a passing build.** Look at this
   screen at 1920x1080 after any change to it.

5. **`npm run build` clobbers `.next/` while `npm run dev` is running**, leaving
   the dev server 404ing its own JavaScript and CSS — the page loads unstyled
   and nothing is interactive. If you see that, stop the dev server,
   `rm -rf .next`, and restart it. Do not run the two at the same time.

## 6. Known issues, deliberately not fixed

These came out of the pre-merge review of the roster write paths. Each is real;
none is a reason to hold the merge; all are yours to decide on.

1. **One shared PIN now authorizes roster deletion.** Before phase 6, the worst
   a leaked PIN could do was mark a child arrived — undone in one tap. It can
   now delete students one at a time, and there is no undo and no record of who
   did it. Every phone at the kerb holds this PIN. **Suggested fix:** a separate
   `ADMIN_PIN` env var for the five `roster-*` endpoints. `guardRequest` already
   takes the PIN as a dependency, so it is one line per entrypoint plus one
   secret. **Trade-off:** one more thing for the office to manage and get wrong
   at deploy time. This one genuinely wants a human decision, which is why it is
   here rather than done.

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
   duplicate protection airtight rather than merely reliable in practice. See
   judgment call 6.

5. **Raw Postgres error text reaches the client** in a 503 body. Pre-existing
   from phase 3, not introduced here, but there are now five more paths to it.
   Worth logging the detail and returning a fixed sentence instead.

6. **No scheduled morning reset.** It was the optional item on the phase 6
   checklist and was not built. The manual reset in `/admin` covers it.

## 7. Where things are

- **Design system** — CLAUDE.md, "Design system — Curbside". Hex values, class
  patterns and the rules three parallel agents were held to. Read this before
  touching any screen, and check it first if the screens ever stop looking like
  one app.
- **Per-phase state** — the checklists in CLAUDE.md, kept honest about what is
  verified by execution versus merely written.
- **Screenshots** — `npm run screenshot <url> --size display|phone|desk`. The
  `screenshots/` directory is gitignored.
- **Phase 7** (polish, accessibility, deploy, a README for daily staff use) has
  not been started.
