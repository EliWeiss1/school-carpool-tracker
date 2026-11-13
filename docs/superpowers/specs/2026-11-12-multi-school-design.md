# CarpoolCaller: from one school to a multi-school service

## Context

CarpoolCaller serves one school today. There are no accounts: one shared staff PIN (a server env var) gates `/announce` and `/admin`, one `DISPLAY_PASSWORD` gates `/display` (on `master`), no table has a school column, and the roster is readable by anyone holding the site's public key. The goal is to offer it to other schools: a public landing page, saved accounts with login, and every school's roster, classes, carpools and history kept strictly separate. The existing school's live data (198 students, 16 classes, 57 carpools, ~1,875 history rows as of 2026-10-25) becomes school #1 with nothing lost.

## Decisions (yours)

| Topic | Decision |
|---|---|
| Office | One email + password account per school; the same login may be used on several computers. Separate invited accounts come later, with no database rework. |
| Curb phones and wall boards | No accounts. The office sets a short code in `/admin` (one for announce, one for display, or the same for both). A device enters it once and stays connected until the office disconnects it or changes the code. |
| Sign-up | Instant self-serve, with per-school caps on voice use. |
| Landing page | Public page at `/`; "Free during early access", no pricing table. |
| Isolation | No school can see another school's data. |

## Design (my calls, checked by an Opus design review)

**Base branch.** Cut `preview/multi-school` from `origin/master` (not the current `preview/announce-mobile-layout`, which lacks master's display gate) in its own git worktree. Nothing reaches `master` until you approve.

**Tenancy in the database.**
- New tables: `schools` (name, slug, timezone, reset hour/days, `last_reset_on`, voice on/off, monthly voice limit), `school_secrets` (the two codes, a version per code, failed-attempt lockout; no client access at all), `school_members` (user ↔ school, role), `school_devices` (one row per connected phone/TV: school, can announce, can display, label, code version, last seen), `school_usage` (voice sessions per month).
- `school_id` on `students`, `class_groups`, `carpools`, `status_events`, `student_parents`, `student_classes`. Composite keys `(school_id, id)` and composite foreign keys make a cross-school link impossible in the database itself. `on delete set null (student_id)` column-list form keeps today's "history outlives roster edits" behaviour (verified in PGlite).
- Class and carpool names become unique per school instead of globally.

**Identity: Supabase Auth for people and devices.**
- Office: email + password, email confirmation, password reset. Session in cookies via `@supabase/ssr` so pages can redirect before rendering.
- Devices: an anonymous Supabase session created when a code is submitted, then a new `pair-device` function checks the code and records the device. The session lives in `localStorage` under its own storage key, separate from the office session, so an office login on a paired TV never knocks the TV off. Wrong codes are limited per IP and per school (database counter); a lockout only blocks new pairings, never devices already connected.
- The office sees "Connected devices" and can disconnect one (which also deletes its session). "Change code" and "Change code and disconnect its devices" are separate actions.
- A signed-in office user needs no code on `/announce` or `/display` for their own school.

**Read boundary: row-level security.** A private helper returns the schools the caller belongs to (member or device); every readable table's policy is `school_id in (select private.current_school_ids())`. Anonymous visitors read nothing.

**Live board: database Broadcast instead of Postgres Changes.** Postgres Changes sends every school's delete events to every subscriber (ids only, but still a cross-school leak). Triggers on `students` and `student_classes` broadcast to a private per-school topic authorised by the same helper. This also fixes an existing bug: live deletes are silently dropped today because the delete payload carries only the id (`fullRowOrNull` in `src/lib/display-subscription.ts`). First task of that phase is a short spike against the Supabase docs and the live project; if Broadcast cannot be verified, fall back to filtered Postgres Changes and ignore unknown-id deletes.

**Write boundary: Edge Functions, as today.**
- `supabase/functions/_shared/handlers/guard.ts` stops reading a PIN. It verifies the caller's Supabase token, rejects the public key and tokens with no user, takes `schoolId` from the body, looks up membership or device row, and checks the capability the endpoint declares (announce devices: `deepgram-token`, `resolve-name`, `set-status`; office: everything; display devices: none).
- `supabase/functions/_shared/supabase-store.deno.ts` gains `forSchool(id)`: scoped `select/insert/update/delete/rpc` helpers that always inject the school. `ports.ts` and handler logic stay as they are. A static test bans raw `.from(`/`.rpc(` outside those helpers.
- New functions: `pair-device`, and `school-write` (create school, settings, get/set codes, list/disconnect devices) built as one multi-action function like `classes-write`.
- During rollout the guard also accepts the legacy `STAFF_PIN`, mapped to school #1, so today's phones keep working until an explicit cutover.

**Routes and flows.**

```
/                      landing page
/signup  /login  /forgot-password  /auth/confirm
/welcome               confirm school name, web address, time zone -> creates the school
/s/[school]            screen picker + install card (today's home page)
/s/[school]/announce   code gate (devices) or straight in (office)
/s/[school]/display    code gate (devices) or straight in (office)
/s/[school]/admin      office login required
/app                   installed-app launcher: last school used on this device
```

- Sign-up: school name + email + password, then "check your email", then `/welcome` prefilled, then `/admin` with a first-run checklist (add classes, import roster, set device codes, connect a screen).
- Devices: open the school's link, type the code once. The gate shows the school name only after a correct code (no public school lookup).
- `/admin` gains School settings (name, time zone, nightly reset time and days), Devices (codes, share link, connected devices) and Voice usage.
- Old `/announce`, `/display`, `/admin` keep working until cutover, then redirect.

**Per-school behaviour.** Nightly reset runs hourly and resets each school at its own local time and days (school #1 keeps 8 PM Pacific, Sun to Thu), guarded by `last_reset_on`. Voice: an atomic per-school monthly counter in `deepgram-token`; over the cap the function answers politely and `/announce` falls back to typed search as it already does. Voice is off until the account's email is confirmed.

**Landing page.** Curbside design system, ink hero with a live mini board built from the real tile components (a tile flipping from waiting to arrived), one hazard rule, three "lanes" explaining Announce / Display / Office, why a person always confirms the name, setup steps, privacy section, final call to action "Get started, free during early access", nav with Sign in, footer with Privacy and Terms links. Any new token (for example a grain texture) is added to `tailwind.config.ts` and `CLAUDE.md` in the same commit.

**Rule change to record in `CLAUDE.md`.** "The staff PIN is held in memory only" becomes "No code or password is ever stored on a device; devices hold only a revocable session." The architecture table's Auth row, the endpoint table and the non-negotiables are updated to match.

## Skills

- Install at the start of implementation (not possible in plan mode): `supabase/agent-skills@supabase` and `supabase/agent-skills@supabase-postgres-best-practices` (official Supabase, 360K+ installs, also recommended by the Supabase connector). Used in every database and auth phase.
- Optional for landing copy: `coreyhaines31/marketingskills@copywriting` (253K installs, third party, text guidance only). I'll install it only if you say so.
- Rejected: the third-party `nextjs-supabase-auth` skills (unknown authors, small install counts).
- Already installed and required: `frontend-design` before any frontend code; superpowers TDD and verification skills during the build.

## Phases

Model tiers: **H** Haiku (mechanical), **S** Sonnet (normal), **O** Opus (`careful-review`, security-critical). Each phase ends with `npm run lint && npm run typecheck && npm test`, a commit and push to `preview/multi-school`, a short summary, and a pause for your review.

| # | Phase | Runs in parallel with | Tier |
|---|---|---|---|
| 0 | Setup | none | S |
| 1 | Landing page | 2, 3 | S |
| 2 | Database expand migration | 1 | S, then O review |
| 3 | Function boundary (3a guard, 3b store scoping, 3c new functions, in parallel) | 1, 4 | S, O for guard, store, `pair-device` |
| 4 | Office sign-up and login | 3, 6 | S |
| 5 | School-scoped screens, device gate, Broadcast | 6 | S, H for prop threading, O for realtime |
| 6 | Per-school reset and voice caps | 4, 5 | S, O for the counter |
| 7 | Rollout of school #1, cutover, contract migration, docs | none | O |

**0. Setup.** Worktree and branch; install the skills; save this design as `docs/superpowers/specs/2026-11-12-multi-school-design.md`; move the PGlite bootstrap in `supabase/migrations/schema.test.ts` into `supabase/migrations/test-bootstrap.ts` and add stubs (`auth` schema, `auth.users`, `auth.uid()`, `auth.jwt()`, an `asUser(uid, fn)` helper, a note that PGlite is Postgres 18 while the project is 17); bump the functions' `npm:@supabase/supabase-js` pin to match the frontend.

**1. Landing page.** New `src/app/page.tsx` and `src/components/landing/*`; today's picker moves to `src/app/screens/page.tsx` (later `/s/[school]`); `PageHeader` back link and `src/app/manifest.ts` (`start_url: "/app"`, new `src/app/app/page.tsx` launcher) follow. Reuse `Button`, `HazardRule`, the lane-card pattern from the current `page.tsx`, and the display tile components. Add a link-styled variant to `Button`. Screenshot at phone and desk sizes with `npm run screenshot` and compare.

**2. Expand migration** (`supabase/migrations/2026111x_multi_school_expand.sql`, safe to apply while old code runs). New tables; school #1 with a fixed id; `school_id not null default <school #1>` on the six tables (existing rows fill instantly, old functions keep writing valid rows); composite unique keys; each foreign key swapped in one statement (two relationships at once would break the `students -> student_classes -> class_groups` embed); per-school name indexes; the private helper; policies (public key limited to school #1 for now, signed-in callers scoped); RPC overloads of `set_student_classes`, `change_class_members`, `remove_class_group` taking `p_school_id`. Tests: backfill counts unchanged, cross-school links rejected, deletes null only id columns, same name allowed across schools, member of A sees only A, a device sees only its school, secrets unreadable, helper not callable by the public key.

**3. Function boundary.**
- 3a `guard.ts` rewrite plus an `AccessStore` port in `ports.ts`; every `supabase/functions/*/index.ts` declares its capability; `guard.test.ts`; new `auth-boundary.test.ts` asserting every entrypoint goes through the guard (`pin-budget.test.ts` stays until the PIN branch is removed).
- 3b scoped store helpers; multi-tenant `handlers/fake-store.ts`; new `handlers/tenant-isolation.test.ts` (two schools with identical names, call all 22 `RosterStore` methods as A, assert B is untouched and never returned).
- 3c `pair-device` and `school-write` handlers, entrypoints and tests. Duplicate-student checks in `roster-import.ts` and `roster-write.ts` become per school.

**4. Office sign-up and login.** Add `@supabase/ssr`; `src/middleware.ts`; cookie-based `src/lib/supabase/server.ts`; `src/lib/supabase/device.ts` (own storage key); `src/app/(auth)/{signup,login,forgot-password}`, `src/app/auth/confirm/route.ts`, `src/app/welcome`; captcha widget shown when a site key is configured; `src/lib/api.ts` and `admin-api.ts` send the session token and `schoolId` instead of `{pin, deviceId}`.

**5. School-scoped screens.** `src/app/s/[school]/{page,announce,display,admin}`; existing screens take `schoolId`; `components/ui/code-gate.tsx` replaces `pin-gate.tsx` for devices; `display-subscription.ts` moves to Broadcast with a per-school topic and a token-expiry resubscribe test; `use-class-roster.ts`, `class-groups.ts` and `fetchSnapshot` scope by school; `/admin` gains School settings, Devices and Voice usage; `localStorage` keys become per school.

**6. Per-school behaviour.** Migration with `reset_board_to_waiting(p_school)`, an hourly `nightly_reset_due(at)`, a cleanup job for unpaired anonymous users older than a day, and `increment_voice_session(...)`. Tests: replay every hour of a year (both clock changes) and prove school #1 resets exactly when the old function did; cap refuses at the limit; month rollover.

**7. Rollout (each step with your go-ahead).** Backup; apply the expand migration and check the live board; deploy the dual-auth functions; merge the frontend (new routes alongside old); you sign up and I attach your account to school #1; set codes and re-pair TVs and phones on the new address; switch the reset job; cutover (old routes redirect, `STAFF_PIN` and `DISPLAY_PASSWORD` unset, contract migration drops the defaults, public-key policies and old RPC signatures); only then open sign-ups. Remove `pin.ts`, `pin-session.ts`, `verify-pin.ts`, `pin-budget.test.ts` and master's `display-auth` pieces. Update `CLAUDE.md`, `README.md`, `HANDOFF.md`, `.env.example`. Rollback before cutover is reverting frontend and functions; the expand migration is harmless to leave.

## Verification

- **Database:** PGlite tests in `schema.test.ts` for isolation, composite keys, backfill and the reset replay.
- **Functions:** Vitest handler tests, the 22-method tenant-isolation contract test, the static no-raw-query test, the auth-boundary test.
- **Frontend:** reducer and API-client tests on the existing patterns; screenshots of landing, sign-up, login, code gate, Devices panel at phone, desk and display sizes; reduced-motion check.
- **End to end on a preview deployment, with a throwaway second school:** sign up, confirm, create the school, import a CSV, set codes, pair a phone and a TV, announce a child and watch the board flip; then confirm school #2 cannot read or write school #1 through the app, the public key, a device session, or a direct function call with school #1's ids; disconnect a device and confirm it drops; hit the voice cap and confirm typed search still works. Throwaway data removed afterwards.
- Nothing that spends Deepgram or Supabase credits runs without asking first; mock speech stays the default.

## Needed from you (none blocks phases 0 to 6)

- School #1's display name and web address (for example `/s/your-school`).
- A domain for the product, and an email-sending provider: Supabase's built-in mailer allows only a few emails an hour, too few for self-serve sign-up.
- Cloudflare Turnstile keys (captcha for sign-up and device pairing).
- Supabase dashboard settings at rollout: enable anonymous sign-ins and raise their hourly limit, email confirmation on, session time-box and inactivity timeout left off (either would sign out every wall board).
- A decision on Supabase Pro: free projects can pause after a week of low activity (summer break) and have no downloadable backups.
- A default monthly voice limit per school.
- Privacy policy and terms before real schools sign up (this is children's data); I can draft placeholders, not legal advice.

## Not in this version

Billing and payments; separate invited office accounts; a platform-owner dashboard (school limits are edited in Supabase for now); Google sign-in; per-school subdomains; QR codes for pairing.
