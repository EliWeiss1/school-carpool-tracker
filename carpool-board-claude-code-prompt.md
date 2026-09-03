# Carpool Pickup Board — Claude Code build prompt

Paste everything below into Claude Code to kick off the project.

---

## Project brief

Build a small internal web app for a school carpool pickup line. Someone standing outside speaks a student's last name into a phone/tablet. The app transcribes it, matches it against the enrolled roster, and — after a one-tap confirmation — flips that student's status from "waiting" (red) to "arrived" (green) on a big shared screen inside, with a visual + audio alert so the teacher notices without staring at it.

This is a small, low-traffic, single-building app. No user accounts. Optimize for reliability and low maintenance over scale.

## Decided architecture — do not re-derive, just build

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind, deployed on Vercel.
- **Data + realtime:** Supabase — Postgres for the roster/status tables, Supabase Realtime (Postgres Changes) to push status updates to every connected browser, Supabase Edge Functions for anything that needs a secret.
- **Speech-to-text:** Deepgram Nova-3 streaming, using **Keyterm Prompting** with the roster's surnames as keyterms so recognition is biased toward the actual names in play. The Deepgram API key never touches the browser — an Edge Function mints a short-lived token per session.
- **Matching:** server-side (in the Edge Function) fuzzy + phonetic resolver that maps the Deepgram transcript (and its alternatives) to the nearest roster entry, using a three-tier confidence policy (below). This is the highest-risk-of-error component — treat it as the part deserving the most care and test coverage.
- **Auth:** none. Instead: the display page is public read-only; the announce and admin pages require a shared staff PIN (stored server-side as an env var, checked by the Edge Function, never written to localStorage) before any write succeeds.

## Pages

**`/announce`** (outside, phone or tablet)

- Optional grade/class filter, so the keyterm list sent to Deepgram stays well under vendor limits (Deepgram's self-serve Keyterm Prompting is documented up to ~100 terms) and matching is more precise.
- Push-to-talk mic button with a clear listening state.
- Shows the top 2–3 fuzzy-matched candidate names as large tap targets — nothing is ever auto-committed on transcription alone. Also include a plain searchable/typeable list as a fallback for noisy rooms, accessibility, or when voice just isn't working.
- One PIN entry per device session (kept in memory only).
- On confirm: calls the Edge Function, which re-validates, writes `status = arrived`, `arrived_at = now()`.
- Include an "undo" (e.g. a 2-minute window) in case the wrong name gets confirmed.

**`/display`** (inside, big screen, no auth, read-only)

- Live grid of all students via a Supabase Realtime subscription — red = waiting, green = arrived.
- A newly-arrived student gets a brief flash animation plus an audio chime.
- Must recover cleanly from a dropped connection (refetch current state on reconnect, don't just wait silently for the next event).

**`/admin`** (roster management, PIN-protected)

- Add/edit/remove students; a `aliases` field per student for alternate spellings/transliterations (the research flagged this as important for names like Cohen/Kohen).
- CSV import for initial roster setup.
- "Reset all to waiting" button, plus (optional, phase 6) a Supabase scheduled Edge Function that does this automatically each school morning.

## Data model

```sql
create table students (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  aliases text[] default '{}',
  grade text,
  class_group text,
  status text not null default 'waiting' check (status in ('waiting', 'arrived')),
  arrived_at timestamptz,
  updated_at timestamptz not null default now()
);

create table status_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id),
  changed_to text not null,
  source text not null check (source in ('voice', 'manual', 'admin')),
  match_confidence numeric,
  raw_transcript text,
  created_at timestamptz not null default now()
);
```

`status_events` is an audit log, not shown on the display — it exists so you can review false-accepts later and retune the matching thresholds. Don't store raw audio by default; discard it after transcription unless we later decide to opt into keeping labeled clips for tuning.

## Matching & confidence policy

Normalize both the transcript alternatives and the roster (case-fold, strip punctuation, normalize diacritics for comparison while keeping the original spelling for display). Combine string similarity with the `aliases` table. Then:

- **Clear top match, real margin over the runner-up:** show it as the pre-highlighted suggestion — but still require a tap to confirm. Never auto-write a status change from transcription alone; this is a public, teacher-facing alert and a wrong name is worse than an extra second of friction.
- **Ambiguous (two names close together):** show both as equal-weight buttons, no default selected.
- **No good match:** drop straight to the searchable list, don't guess.

## Deepgram integration notes

- Stream from the browser via WebSocket using the short-lived token from the Edge Function; never ship the permanent Deepgram key client-side.
- Pass the currently-relevant roster surnames as keyterms. If no class filter is set, cap the list and prioritize sensibly rather than sending the full roster if it risks exceeding vendor limits.
- Default to not persisting audio.

## Security

- Deepgram key and Supabase service-role key live only in server-side env vars (Vercel/Supabase project settings), never in the client bundle.
- Supabase RLS: public `select` on `students` where needed for the display page; no public `insert`/`update` — only the Edge Function (using the service-role key) can write.
- Rate-limit the announce endpoint per device/session to avoid accidental spam writes.
- Check in a `.env.example` with variable names only; real values stay in `.env.local` (confirm it's gitignored) and the hosting providers' env settings.

## Build phases

Work through these in order. After each phase, summarize what was built, run lint/tests, and pause for my review before starting the next one.

1. **Scaffold** — Next.js + TS + Tailwind repo, Supabase project wiring, `.env.example`, base lint/test setup, and the `CLAUDE.md` described below.
2. **Data layer** — Supabase schema + RLS policies + a seed script with a sample roster for local dev.
3. **Edge Function** — PIN-gated Deepgram token minting, plus the matching/resolver logic with unit tests using mocked Deepgram responses (no real API calls in tests). Include test cases for tricky near-miss names (e.g. Cohen/Koen/Cowan-style confusions).
4. **`/announce` page** — mic capture, Deepgram streaming client, transcript UI, confirm flow, searchable fallback.
5. **`/display` page** — realtime subscription, status grid, arrival animation + audio alert, reconnect handling.
6. **`/admin` page** — roster CRUD, CSV import, reset button, optional scheduled reset.
7. **Polish** — error/empty states, accessibility pass, deploy to Vercel + Supabase, and a README written for a non-technical school staff member to follow for day-to-day use (not just setup).

## Testing

- Build a "mock mode" env flag that fakes Deepgram responses locally, so development doesn't burn real API credits.
- Prioritize unit tests on the matching/resolver logic over UI tests — it's the component where a bug has the most real-world consequence.

## CLAUDE.md requirements

Create `/CLAUDE.md` at the repo root containing:

- A short project summary and the architecture decisions above (so future sessions don't re-litigate them).
- Exact dev commands: `dev`, `build`, `lint`, `test`, `seed`.
- A directory structure map.
- An environment variables table (name + purpose, never real values).
- Coding conventions (TypeScript strict mode, component patterns, etc. — use sensible defaults for a small Next.js app).
- A "definition of done" checklist per phase above.
- **Model delegation guidance**, specifically:
  - The main session should default to Sonnet for most implementation work.
  - Create two custom subagents in `.claude/agents/`:
    - `boilerplate.md` — `model: haiku` — for mechanical, low-ambiguity work: CRUD scaffolding, repetitive component generation, the CSV import script, formatting/renames, routine test fixtures.
    - `careful-review.md` — `model: opus` — for the matching/confidence-threshold algorithm, RLS and Edge Function security review, debugging realtime race conditions (e.g. two near-simultaneous arrivals for the same student), and any architecture decision where the requirements above are ambiguous.
  - Note in CLAUDE.md when to explicitly invoke each subagent versus just working inline on Sonnet, and that escalating to Opus inline (without a subagent) is also fine if a genuinely hard bug comes up mid-task.

## Process instructions

- Don't run anything that spends real Deepgram or Supabase credits without asking me first.
- Never commit secrets.
- Keep components small; comment only where the "why" isn't obvious from the code.
- Flag any judgment call you made that I should know about.
