# Carpool Pickup Board

A small internal web app for a school's carpool pickup line. Someone outside
speaks a student's last name into a phone; after a one-tap confirmation the
student flips from **waiting** (red) to **arrived** (green) on a big screen
inside, with a flash and a chime.

Three screens:

- **`/announce`** — outside, on a phone or tablet. Push-to-talk, confirm the
  matched name, or search the roster by hand. PIN-protected.
- **`/display`** — inside, on the big screen. Live red/green grid. No login.
- **`/admin`** — roster management and the daily reset. PIN-protected.

> **Note:** this README is the developer setup guide. A separate day-to-day
> guide written for school staff lands in phase 7.

## Stack

Next.js 14 (App Router) + TypeScript + Tailwind on Vercel · Supabase Postgres,
Realtime, and Edge Functions · Deepgram Nova-3 streaming with Keyterm
Prompting.

See [CLAUDE.md](CLAUDE.md) for the full architecture, conventions, and phase
checklist.

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
