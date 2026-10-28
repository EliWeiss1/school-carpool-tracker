# CarpoolCaller

A small internal web app for a school's carpool pickup line. Someone outside
speaks a student's last name into a phone; after a one-tap confirmation the
student flips from **waiting** (red) to **arrived** (green) on a big screen
inside, with a flash and a chime.

Three screens:

- **`/announce`** — outside, on a phone or tablet. The search box and the
  push-to-talk button share one row at the bottom of the screen, so the
  matches get the space in between. Hold to talk and confirm the
  matched name, or search the roster by hand: suggestions appear as you
  type a first name, last name, nickname or carpool name (matched in the
  browser, no request per keystroke), and Search adds fuzzy, sound-alike
  matching for misspellings. The class filter in the header takes any
  number of classes, and a button per class down the right edge opens a
  drawer of that class's students to tap and announce without speaking or
  typing. Between calls, the screen lists the last few names announced from
  that device, each with "Send back" to undo a wrong tap. PIN-protected.
- **`/display`** — inside, on the big screen. Live blue (waiting) / white (arrived) grid, grouped by class. A student in several classes appears under each one. Optionally reads each arrival's name aloud after the chime ("Read names" in the header; free, uses the browser's built-in voice). No login.
- **`/admin`** — roster management, the class list, and a manual "Reset all to waiting". PIN-protected.

## Classes and the roster

A student can be in any number of classes (or none). Classes are their own
admin-editable list (`/admin` > Classes: add, reorder, delete, see member
counts), and membership is its own table, `student_classes`, rather than a
column on the student. To put a whole group in a class, open the class's
**Students** sheet; to move a handful, select them in the roster table and use
**Add to class** / **Remove from class**. Deleting a class that would leave some
students with no class asks first: move everyone to another class, delete
anyway, or cancel.

CSV import columns: `first_name`, `last_name`, optional `aliases`, and the
classes in a `class_groups` column (`classes` also works). Put several classes
in one cell separated by a semicolon, for example `1st;2nd`. A class that does
not exist yet is an error on that row, not a new class: add it under Classes
first, then import.

The board also clears itself: a `pg_cron` job in Supabase sends every arrived
student back to waiting at **8:00 PM Pacific, Sunday through Thursday** (Friday and Saturday
nights are skipped). It runs inside the database, so it works even if Vercel or
the Edge Functions are down. See `supabase/migrations/20261011120000_nightly_board_reset.sql` and `20261011130000_nightly_reset_skip_friday.sql`.

> **Note:** this README is the developer setup guide. A separate day-to-day
> guide written for school staff lands in phase 7.

## Stack

Next.js 14 (App Router) + TypeScript + Tailwind on Vercel · Supabase Postgres,
Realtime, and Edge Functions · Deepgram Nova-3 streaming with Keyterm
Prompting.

See [CLAUDE.md](CLAUDE.md) for the full architecture, conventions, and phase
checklist.

## Installing on a phone

The site is an installable PWA, so staff can keep it on a phone's home screen
instead of using an app store. The landing page (`/`) shows an "add to home
screen" card at the bottom, on phones and tablets only:

- **Android (Chrome):** the card has an **Install** button that opens the
  browser's own install dialog.
- **iPhone / iPad:** iOS has no install API, so the card shows the steps instead
  — tap **Share**, then **Add to Home Screen**.

The card stays away once the app is installed, and for two weeks after **Not
now** (remembered per device in `localStorage`).

What makes it installable: `src/app/manifest.ts` (name, colours, icons, a
long-press shortcut per screen), the icons in `public/icons/` (regenerate with
`node scripts/generate-icons.mjs`), and `public/sw.js`, registered in production
only. The service worker **caches nothing** — it exists because Chrome requires
one to offer the install prompt, and to show a "No connection" page instead of
the browser's error. Live data and Edge Function calls always go straight to the
network, so an installed copy can never show a stale board.

## Local setup

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Set `NEXT_PUBLIC_MOCK_SPEECH=true` in `.env.local` to develop against faked
speech recognition so you don't burn Deepgram credits.

For the local Supabase stack (needs Docker):

```bash
npx supabase start
npx supabase db reset
npm run seed
```

## Commands

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Dev server on http://localhost:3000 |
| `npm run build`     | Production build                    |
| `npm run lint`      | ESLint                              |
| `npm run typecheck` | `tsc --noEmit`                      |
| `npm test`          | Vitest                              |
| `npm run seed`      | Load the sample dev roster          |
| `npm run format`    | Prettier                            |

## Secrets

`.env.local` is gitignored and never committed. `.env.example` lists variable
names only. The Deepgram key, the Supabase service-role key, and the staff PIN
are server-side only — they live in Supabase and Vercel project settings and
never appear in the client bundle.

## Build status

Phase 1 (scaffold) complete. Phases 2–7 — data layer, Edge Function and
matching, the three pages, polish — are tracked in
[CLAUDE.md](CLAUDE.md#build-phases-and-definition-of-done).
