# Students in multiple classes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student can belong to any number of classes (changeable any time from `/admin`, singly or in bulk), `/display` and `/announce` show them under every one of their classes, and class deletion never silently strands a student.

**Architecture:** A `student_classes` junction table (composite PK, real FKs, cascade) replaces the free-text `students.class_group`. Atomic membership changes are Postgres functions called by the service-role Edge Function store. Reads expose `class_groups: string[]` (names, in class `sort_order`); writes carry class ids resolved by the handler. Shipped as expand → deploy → contract migrations on a feature branch.

**Tech Stack:** Next.js 14 + TS + Tailwind, Supabase Postgres/Realtime, Deno Edge Functions, Vitest + PGlite.

**Spec:** `docs/superpowers/specs/2026-10-21-multi-class-students-design.md` (executors read it alongside this plan).

## Global Constraints

- Work only on branch `feature/multi-class-students`. **Nothing merges or pushes to `master`** (Vercel auto-deploys it) until the user has approved and Task 12 has run the live steps.
- **No live change without the user's explicit go-ahead**: applying a migration to the linked Supabase project, deploying an Edge Function, seeding. Tests use PGlite/fakes only. No Deepgram/Supabase credits spent.
- Invoke the `frontend-design` skill before writing any frontend code (Tasks 6–10). Use the `supabase-postgres-best-practices` skill (installed globally) for Tasks 1–2.
- Curbside design system only: existing tokens in `tailwind.config.ts`; `Button` variants, `ErrorBanner`, etc. from `src/components/ui/`; `rounded-xl` controls / `rounded-2xl` surfaces; elevation base/elevated/floating; only `transform`/`opacity` animate, never `transition-all`; every clickable has hover, `focus-visible` (`.focus-ring`) and active; sentence case; touch targets `min-h-tap`.
- TypeScript strict, no `any`. Comments explain why. Env vars only via `src/lib/env.ts`.
- Status and `arrived_at` are never written by any class-membership code path.
- Read shape: `class_groups: string[]` = class **names** ordered by `class_groups.sort_order`, `[]` = Ungrouped. Write shape into the store: `class_group_ids: string[]`. A request still carrying the old singular `class_group` to `roster-write`/`roster-import` is rejected 400 `"This page is out of date. Reload it and try again."`
- Migration filenames: `20261021120000_student_classes.sql` (expand), `20261021130000_drop_student_class_group_column.sql` (contract).
- CSV: several classes in one cell separated by `;`; unknown class names are a row error, never auto-created.
- Each commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Gate between phases: `npm run lint && npm run typecheck && npm test` green. `typecheck` may be red inside a group (backend `_shared`, or frontend `src`) until that group's last task; each task's own vitest files must pass.

## Execution map (models and parallelism)

| Phase | Tasks | Run | Model |
| --- | --- | --- | --- |
| 0 | Branch setup (Task 1 step 1) | first | inline |
| 1 | **A** Tasks 1→2 (database) · **B** Task 3→{4 ∥ 5} (Edge Function code) · **C** Task 6 (frontend foundation) | A, B, C in parallel (disjoint files; shapes are fixed by this plan) | Task 1: Opus (atomic SQL; then `careful-review`); Task 2: Sonnet; Tasks 3, 5: Sonnet; Task 4: Sonnet + `careful-review` (untestable locally); Task 6: Haiku (`boilerplate`) |
| 2 | Tasks 7 ∥ 8 ∥ 9 ∥ 10 | parallel after Task 6 (disjoint files) | Sonnet (frontend-design applies) |
| 3 | Task 11 (seed, mocks, docs) | after phases 1–2 | Haiku for seed/mocks, Sonnet for docs |
| 4 | Task 12 (live rollout) | serial, user-gated | inline |

## Review Focus

1. A multi-class student ticked in two class drawers on `/announce` is announced **once** (ids de-duplicated before `set-status`), one audit row.
2. A realtime `students` UPDATE (which has no class data) and a snapshot merge never blank or keep a stale `class_groups` on `/display`; a membership edit made while `/display` is open shows up without a flash or chime.
3. CSV class cells: `"3rd; Art"`, `"3rd;3rd"`, `";;"`, trailing/leading spaces, mixed case and an empty cell all behave (trim, de-duplicate case-insensitively, ignore empty segments, empty = Ungrouped).
4. Racing/stale admin actions: membership edit or delete against a class another admin already deleted returns a clean 404 sentence; `move_to` equal to the deleted class or nonexistent returns a 400 sentence and changes nothing.
5. A student with zero classes: appears only under "Ungrouped" on `/display`, is excluded by any class filter on `/announce`/resolver, and is still found by the typed search with no filter.

---

### Task 1: Expand migration — table, backfill, functions

**Files:**
- Create: `supabase/migrations/20261021120000_student_classes.sql`
- Modify: `supabase/migrations/schema.test.ts` (existing assertion at ~line 131 uses `students.class_group`; keep it, the column still exists after this migration)

**Interfaces:**
- Produces (SQL, all in `public`, `security invoker`, `set search_path = ''`, `revoke execute ... from public, anon, authenticated` like `nightly_reset_board()`):
  - table `student_classes(student_id uuid, class_group_id uuid, created_at timestamptz default now(), primary key (student_id, class_group_id))`, FKs `on delete cascade` to `students(id)` and `class_groups(id)`; index `student_classes_class_idx on (class_group_id, student_id)`; RLS on, `revoke all` from anon/authenticated, `grant select`, one public `select` policy; added to the `supabase_realtime` publication (guarded `do` block like the init migration).
  - `backfill_student_classes() returns void`: idempotent. For each distinct `lower(trim(class_group))` of non-empty students values not matching a `class_groups.name` (case-insensitive), insert a `class_groups` row (trimmed original spelling, `sort_order` appended after the current max); then insert one link per student (`on conflict do nothing`).
  - `set_student_classes(p_student_id uuid, p_class_group_ids uuid[]) returns void`: makes the student's links exactly that set (delete the rest, insert the missing); errors if the student does not exist.
  - `change_class_members(p_class_group_id uuid, p_add_ids uuid[], p_remove_ids uuid[]) returns jsonb` → `{"member_count": int, "ignored_ids": [uuid...]}`; adds existing students (no-op if already members), removes listed links; ids not on the roster go in `ignored_ids`; raises `P0002` if the class does not exist.
  - `remove_class_group(p_class_group_id uuid, p_move_to uuid default null, p_force boolean default false) returns jsonb`: locks the class row `for update`; sole members = students whose only link is this class. Returns `{"deleted": true, "moved_count": n}` when it deleted, else `{"deleted": false, "member_count": n, "sole_member_count": n, "sole_members": [{"id","first_name","last_name"}]}` (sample capped at 10) when sole members exist and neither `p_move_to` nor `p_force`. With `p_move_to`: every member (sole or not) gets a link to it first, then the class is deleted. Raises `P0002` (class missing) and `22023` (`p_move_to` equals the class or does not exist), rolling back.

- [ ] **Step 1:** `git switch -c feature/multi-class-students`. Read `supabase/migrations/20260916010000_class_groups.sql`, `20261011120000_nightly_board_reset.sql` (privilege pattern) and `schema.test.ts` lines 1–130 (how migrations are applied and how roles are queried).
- [ ] **Step 2: Write failing tests** appended to `schema.test.ts` in a new `describe("student_classes")`:
  - `rejects a duplicate (student, class) pair` (unique violation `23505`).
  - `rejects a link to a nonexistent student or class` (`23503`).
  - `deleting a student removes only their links`; `deleting a class removes only its links and keeps the students`.
  - `anon can select student_classes but not insert, update or delete` (permission denied / RLS), `service_role can write`.
  - `set_student_classes replaces the set atomically` (final set exact; unknown student errors and leaves existing links intact); `change_class_members` adds, is idempotent on re-add, removes, reports `ignored_ids`, raises for a missing class.
  - `remove_class_group`: no sole members deletes; sole members with neither option deletes nothing and returns the count and sample; with `p_move_to` every member (including one also in a third class) ends up linked to the target and the class is gone; with `p_force` the sole member ends with no links; a two-class student is never a sole member; `p_move_to` = self and nonexistent raise and roll back (class still present).
  - `anon and authenticated cannot execute set_student_classes, change_class_members, remove_class_group, backfill_student_classes`.
  - `backfill`: apply migrations only up to `20260916010000_class_groups.sql`, insert students with `' 3rd '`, `'3RD'`, `'Art Club'` (not in `class_groups`), `''` and `null`; then apply `20261021120000_student_classes.sql`; assert `3rd` students link to the existing row, `Art Club` was created and appended, blank/null students have no links, and calling `backfill_student_classes()` again changes no row counts. (The file-by-file application helper already exists; add a variant that takes a cutoff filename.)
- [ ] **Step 3:** Run `npx vitest run supabase/migrations/schema.test.ts` — expect the new tests FAIL.
- [ ] **Step 4:** Write the migration per the Interfaces. The migration ends by calling `select public.backfill_student_classes();`.
- [ ] **Step 5:** Re-run the same command — all PASS, including the pre-existing ones.
- [ ] **Step 6:** Dispatch `careful-review` on the migration (atomicity, locking, privileges, search_path). Fix findings, re-run.
- [ ] **Step 7: Commit** — `git add supabase/migrations && git commit -m "feat(db): student_classes junction table, backfill and membership functions"`.

---

### Task 2: Contract migration — drop the old column

**Files:**
- Create: `supabase/migrations/20261021130000_drop_student_class_group_column.sql`
- Modify: `supabase/migrations/schema.test.ts` (fix the ~line 131 `update public.students set class_group = '4th'` assertion to use another column, e.g. `last_name`, keeping its intent; assert the column is gone)

**Interfaces:** Consumes Task 1's `backfill_student_classes()`. Produces: `students.class_group` and `students_class_group_idx` removed.

- [ ] **Step 1: Write failing tests:** `students no longer has a class_group column`; `students_class_group_idx no longer exists`; `backfill_student_classes no longer exists` (the migration drops the helper after use); a **cut-over** test applying all migrations to a DB seeded (before the expand migration) with a student whose class text was written after the expand ran, asserting the contract migration re-backfills it before dropping the column.
- [ ] **Step 2:** Run `npx vitest run supabase/migrations/schema.test.ts` — new tests FAIL.
- [ ] **Step 3:** Write the migration: `select public.backfill_student_classes();` → `drop index if exists students_class_group_idx;` → `alter table public.students drop column class_group;` → `drop function public.backfill_student_classes();`. Add a header comment: apply this one **last**, after the frontend deploy is verified.
- [ ] **Step 4:** Re-run — PASS. Also `npx vitest run supabase/migrations` whole folder.
- [ ] **Step 5: Commit** — `feat(db): drop students.class_group after cut-over`.

---

### Task 3: Store port, fake store, name resolution helper

**Files:**
- Modify: `supabase/functions/_shared/ports.ts`, `supabase/functions/_shared/handlers/fake-store.ts`, `supabase/functions/_shared/handlers/roster-input.ts`
- Test: `supabase/functions/_shared/handlers/roster-input.test.ts` (create if absent), `fake-store.test.ts` if one exists (else cover through Task 5's handler tests)

**Interfaces — Produces (exact):**
```ts
// ports.ts
interface StudentRow { /* class_group removed */ class_groups: string[]; /* names, sort_order order */ }
interface StudentWriteInput { /* class_group removed */ class_group_ids: string[]; }
interface SoleMember { id: string; first_name: string; last_name: string }
type RemoveClassGroupOutcome =
  | { status: "deleted"; movedCount: number }
  | { status: "needs-decision"; memberCount: number; soleMemberCount: number; soleMembers: SoleMember[] }
  | { status: "not-found" }
  | { status: "bad-target" };
interface ChangeMembersOutcome { memberCount: number; ignoredIds: string[] }
// RosterStore additions / changes
removeClassGroup(id: string, options?: { moveToClassId?: string; force?: boolean }): Promise<RemoveClassGroupOutcome>; // replaces the boolean version
changeClassMembers(classGroupId: string, addIds: string[], removeIds: string[]): Promise<ChangeMembersOutcome | null>; // null = class not found
countClassMembers(): Promise<Record<string, number>>; // class id -> member count, for the class manager
// roster-input.ts
function resolveClassNames(names: readonly string[], classes: readonly {id: string; name: string}[]):
  { ok: true; ids: string[] } | { ok: false; unknown: string };
// trims, ignores empty entries, de-duplicates case-insensitively (first spelling wins), returns ids in input order
```
`RosterFilter.classGroups` keeps its meaning; `updateStudent`'s patch accepts `class_group_ids` (omitted = untouched, `[]` = clear).

- [ ] **Step 1: Write failing tests** in `roster-input.test.ts`: `resolveClassNames resolves case-insensitively and trims`; `drops duplicates and empty entries`; `returns the first unknown name`; `empty input yields ok with no ids`.
- [ ] **Step 2:** `npx vitest run supabase/functions/_shared/handlers/roster-input.test.ts` — FAIL.
- [ ] **Step 3:** Implement `resolveClassNames`; update `ports.ts` types; update `fake-store.ts` so it holds a `Map<studentId, Set<classId>>`, derives `class_groups` names in class `sort_order`, implements `list` filter as "any class name in `filter.classGroups`", honours `class_group_ids` on create/update/bulk, and implements the new/changed methods with the **same outcome semantics as the SQL functions** (needs-decision, move-all-members, force, bad-target, ignored ids). `makeStudent` accepts `class_groups`.
- [ ] **Step 4:** Run the file again — PASS. Other handler test files are expected red until Task 5.
- [ ] **Step 5: Commit** — `feat(functions): store port and fake store for multi-class membership`.

---

### Task 4: Real Supabase store

**Files:**
- Modify: `supabase/functions/_shared/supabase-store.deno.ts` (excluded from `tsc`/Vitest — verified live in Task 12)

**Interfaces:** Consumes Task 1 SQL and Task 3 port. Behaviour:
- `STUDENT_SELECT` becomes `"*, student_parents(parent1_name, parent2_name), student_classes(class_groups(name, sort_order))"`; `toStudentRow` flattens to `class_groups: string[]` sorted by `sort_order` then name, and guards like the parents embed does (throws a clear error if the embed shape is not an array of `{ class_groups: {...} | null }`).
- `list(filter)`: replace the `.in("class_group", ...)` query with an `!inner` embed filter on `student_classes.class_groups.name` (any of the names) while still returning **all** the student's class names; if PostgREST cannot do both in one query, query class ids by name, then student ids from `student_classes`, then `.in("id", ids)`.
- `createStudent`: insert student, then `rpc("set_student_classes", ...)`; if the rpc fails, delete the just-inserted student and rethrow (never leave a partial row). `updateStudent`: update fields, then rpc only when `class_group_ids` is present. `bulkCreateStudents`: insert students, then one `student_classes` insert of all links; on failure delete the created students and rethrow.
- `removeClassGroup` → `rpc("remove_class_group")` mapped to `RemoveClassGroupOutcome` (`P0002` → not-found, `22023` → bad-target). `changeClassMembers` → `rpc("change_class_members")` (`P0002` → `null`). `countClassMembers` → grouped count over `student_classes`.
- Remove every remaining `class_group` column reference (selects, inserts, `.in`).

- [ ] **Step 1:** Make the edits above. No unit test is possible (Deno-only file); the pure flattening/sorting goes in a small exported function `flattenClassNames(embed: unknown): string[]` in `supabase/functions/_shared/class-embed.ts` (plain TS, so Vitest can run it) with `class-embed.test.ts`: `sorts by sort_order then name`, `treats null class rows as absent`, `throws on a non-array embed`.
- [ ] **Step 2:** `npx vitest run supabase/functions/_shared/class-embed.test.ts` — write the test first (FAIL), implement, PASS.
- [ ] **Step 3:** Dispatch `careful-review` on `supabase-store.deno.ts` focused on partial-write compensation and the rpc error-code mapping.
- [ ] **Step 4: Commit** — `feat(functions): supabase store reads and writes student_classes`.

---

### Task 5: Handlers

**Files:**
- Modify: `handlers/filter.ts`, `handlers/resolve.ts` (line ~51 maps `class_group`), `handlers/roster-write.ts`, `handlers/roster-import.ts`, `handlers/classes-write.ts`, `handlers/roster-list.ts` (also return class member counts), and the matching `*.test.ts` files in `supabase/functions/_shared/handlers/`
- Test: same folder

**Interfaces:** Consumes Task 3. Wire contract:
- `roster-write` create/update body accepts `class_groups: string[]` (names). Unknown name → 422 `There's no class called "<name>". Add it under Classes first.` A body containing singular `class_group` → 400 (constraint above). Update leaves classes untouched when `class_groups` is absent; `[]` clears.
- `roster-import` rows carry `class_groups: string[]`; validated identically (422 naming the first unknown class); singular `class_group` → 400.
- `roster-list` response adds `classMemberCounts: Record<string, number>` (class id → count).
- `classes-write` actions become `create | delete | reorder | members`. `delete` takes `classId`, optional `moveToClassId`, optional `force: boolean`; responses: 200 `{ deleted: true, movedCount }`, **409** `{ error: "<N> student(s) are only in this class.", memberCount, soleMemberCount, soleMembers }`, 404 `That class no longer exists.`, 400 `Choose a different class to move them to.`. `members` takes `classId`, `addStudentIds`, `removeStudentIds` (arrays of strings, each capped at 500, at least one non-empty); 200 `{ memberCount, ignoredIds }`, 404 for a missing class. Update the file header comment (it currently says it never touches students).
- `resolve.ts`: candidate students carry `class_groups`; the carpool collapse and tiers are untouched.
- No new Edge Function is added (the wrong-PIN budget in `pin-budget.test.ts` must still pass unchanged).

- [ ] **Step 1: Write failing tests** (each its own `it`): roster-write — `creates a student in several classes`, `omitting class_groups on update leaves classes alone`, `empty array clears classes`, `unknown class name is 422 and writes nothing`, `duplicate and differently-cased names collapse`, `singular class_group is rejected 400`. roster-import — same unknown/duplicate/legacy cases plus `imports rows with multiple classes`. classes-write — `delete with no sole members deletes`, `delete with sole members returns 409 with count and sample`, `delete with moveToClassId moves every member (including one in another class) then deletes`, `delete with force leaves sole members classless`, `moveToClassId equal to the class is 400`, `deleting a missing class is 404`, `members adds, removes, and is idempotent on re-add`, `members with a missing class is 404`, `members rejects an empty request`. filter/resolve — `a student matches when any of their classes is in the filter`, `a student in two classes resolves to one candidate`, `a student with no classes is excluded by any filter but included with none`. roster-list — `returns class member counts`.
- [ ] **Step 2:** `npx vitest run supabase/functions` — expect the new tests FAIL.
- [ ] **Step 3:** Implement per Interfaces, using `resolveClassNames` (Task 3) against `store.listClassGroups()`.
- [ ] **Step 4:** `npx vitest run supabase/functions` — all PASS (including `pin-budget.test.ts`). `npm run typecheck` should now be green for `supabase/functions/_shared`.
- [ ] **Step 5: Commit** — `feat(functions): multi-class roster writes, class delete guard and bulk members`.

---

### Task 6: Frontend foundation — types, embed helper, API clients

**Files:**
- Modify: `src/types/db.ts`, `src/lib/api.ts` (candidate `Student` shape at ~line 37), `src/lib/admin-api.ts`
- Create: `src/lib/student-classes.ts`
- Test: `src/lib/student-classes.test.ts`, `src/lib/admin-api.test.ts` (extend)

**Interfaces — Produces (exact):**
```ts
// db.ts: Student loses class_group (it is the DB row). New:
export type StudentWithClasses = Student & { class_groups: string[] };
export type StudentClass = { student_id: string; class_group_id: string; created_at: string };
// add student_classes to the Database type (Row/Insert/Update/Relationships)
// student-classes.ts
export const STUDENT_WITH_CLASSES_SELECT: string; // "*, student_classes(class_groups(name, sort_order))"
export type StudentClassesEmbed = { student_classes: { class_groups: { name: string; sort_order: number } | null }[] };
export function withClassNames(row: Student & Partial<StudentClassesEmbed>): StudentWithClasses; // sorted sort_order then name, embed stripped
// api.ts: the candidate student's class_group: string|null becomes class_groups: string[]
// admin-api.ts
StudentFields: class_group removed; class_groups?: string[]
RosterStudent = StudentWithClasses & { parent1_name; parent2_name }
RosterListResponse adds classMemberCounts: Record<string, number>
ClassDeleteInput adds moveToClassId?: string; force?: boolean
ClassDeleteResponse = { deleted: true; movedCount: number }
ClassDeleteNeedsDecision = { memberCount: number; soleMemberCount: number; soleMembers: {id: string; first_name: string; last_name: string}[] }
ClassMembersInput = Credentials & RequestOptions & { classId: string; addStudentIds?: string[]; removeStudentIds?: string[] }
ClassMembersResponse = { memberCount: number; ignoredIds: string[] }
AdminApiClient adds: changeClassMembers(input: ClassMembersInput): Promise<ClassMembersResponse>
```
`deleteClass` surfaces the 409 as an `ApiError` whose `kind` is `"conflict"` and which carries the `ClassDeleteNeedsDecision` payload (add a typed `details` field to `ApiError` if it has none; check `ApiError` in `src/lib/api.ts` first). `updateStudent` keeps `undefined` (omit) vs explicit value semantics for `class_groups`.

- [ ] **Step 1: Write failing tests:** `withClassNames sorts by sort_order then name`, `strips the embed`, `yields [] for a student with no links`, `ignores a link whose class row is null`; `admin-api`: `createStudent sends class_groups`, `updateStudent omits class_groups when undefined but sends []`, `deleteClass sends moveToClassId and force`, `deleteClass 409 rejects with the decision payload`, `changeClassMembers posts to classes-write with action "members"`.
- [ ] **Step 2:** `npx vitest run src/lib/student-classes.test.ts src/lib/admin-api.test.ts` — FAIL.
- [ ] **Step 3:** Implement. (Invoke `frontend-design` first per Global Constraints.)
- [ ] **Step 4:** Re-run — PASS. `npm run typecheck` is red in files Tasks 7–10 own; that is expected.
- [ ] **Step 5: Commit** — `feat(app): multi-class types, embed helper and admin API client`.

---

### Task 7: `/display`

**Files:**
- Modify: `src/lib/display-sections.ts`, `src/lib/realtime-reconcile.ts`, `src/components/display/display-board.tsx`, `src/components/display/student-tile.tsx`, `src/components/display/board-grid.tsx` (React keys), `src/lib/display-mock-roster.ts`
- Test: `display-sections.test.ts`, `realtime-reconcile.test.ts`, tile/board tests that exist

**Interfaces:** Consumes Task 6. Contract:
- `DisplayRoster = Record<string, StudentWithClasses>`. `StudentChangePayload` carries plain `Student` for `new`/`old`.
- `reconcile(roster, payload)` keeps the held `class_groups` when applying a payload (a new INSERT with no held row gets `[]`), and arrival/freshness logic is otherwise unchanged.
- `applySnapshot(roster, rows: readonly StudentWithClasses[])`: row fields obey the existing `updated_at` freshness rule, but **`class_groups` is always taken from the snapshot** (membership edits do not touch `updated_at`).
- `groupIntoSections`: a student is placed in a section for **each** class name; in `"__none__"` ("Ungrouped") only when `class_groups` is empty. `DisplaySection.students` per section; `waiting`/`arrived` per section; `totals` and `visibleIds` count **distinct students**. Option counts unchanged in meaning.
- `display-board.tsx`: snapshot uses `STUDENT_WITH_CLASSES_SELECT` + `withClassNames`; add a second `postgres_changes` subscription on `student_classes` (`event: "*"`) that calls the snapshot fetch through a debounce (≈300 ms, cleared on unmount) and never calls `handleArrivals`. Tile React keys are `${sectionKey}:${student.id}`; flash state stays keyed by student id.
- `student-tile.tsx`: remove the class meta line.
- `display-mock-roster.ts`: produce `class_groups`, with a handful of students in two classes.

- [ ] **Step 1: Write failing tests:** display-sections — `a two-class student appears in both sections`, `totals count them once`, `visibleIds is the union with no duplicates`, `a student with no classes is only Ungrouped`, `filtering to one class shows its multi-class students`. reconcile — `an UPDATE payload keeps the held class_groups`, `an INSERT starts with []`, `a stale payload is still discarded`, `an arrival for a two-class student reports one arrival id`. applySnapshot — `takes class_groups from the snapshot even when the held row is fresher`, `still never lowers a fresher status`. Board — `a student_classes event triggers one debounced refetch and no arrival`.
- [ ] **Step 2:** `npx vitest run src/lib/display-sections.test.ts src/lib/realtime-reconcile.test.ts` (plus board tests) — FAIL.
- [ ] **Step 3:** Implement. (Invoke `frontend-design`.)
- [ ] **Step 4:** PASS. Screenshot `/display?mock=1` at 1920×1080 with the mock roster using the repo's `npm run screenshot` and confirm multi-class students show in each section and nothing clips; view the image.
- [ ] **Step 5: Commit** — `feat(display): students appear under every class they belong to`.

---

### Task 8: `/announce`

**Files:**
- Modify: `src/lib/class-roster.ts`, `src/lib/typeahead.ts`, `src/lib/use-class-roster.ts`, `src/lib/announce-reducer.ts` (only where it reads class fields), `src/components/announce/{announce-screen,candidate-list,carpool-prompt,class-drawer}.tsx`
- Test: `class-roster.test.ts`, `typeahead.test.ts`, `announce-reducer.test.ts`

**Interfaces:** Consumes Task 6.
- `PadStudent.class_group: string|null` → `class_groups: string[]`.
- `studentsInClass(roster, classGroup)`: members = students whose `class_groups` includes the name.
- `typeahead` class filter: matches when any of the student's classes is in `classGroups`; the typed search with no filter still includes classless students. A student is listed once.
- `use-class-roster.ts` reads via `STUDENT_WITH_CLASSES_SELECT` and `withClassNames` (it currently selects `class_group` directly).
- `pad` selection stays keyed by the class it was picked from; the id list sent to `set-status` is **de-duplicated** (a helper `uniqueSelectedIds(selection: PadSelection): string[]` in `class-roster.ts`, used by the announce action).
- Candidate/prompt labels that printed `class_group` now print the student's classes joined with `", "` or `"No class on file"` when empty.

- [ ] **Step 1: Write failing tests:** `studentsInClass includes a multi-class student in each of their classes`, `uniqueSelectedIds collapses a student picked in two drawers`, `typeahead filter matches any class and lists a student once`, `typeahead with no filter includes a classless student`, `pruneSelection keeps picks for classes still in the filter`, plus a candidate-label test for the joined/empty case.
- [ ] **Step 2:** `npx vitest run src/lib/class-roster.test.ts src/lib/typeahead.test.ts src/lib/announce-reducer.test.ts` — FAIL.
- [ ] **Step 3:** Implement. (Invoke `frontend-design`; behaviour changes only, no restyle.)
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(announce): find and announce students from any of their classes`.

---

### Task 9: `/admin` — student form, roster table, CSV import

**Files:**
- Modify: `src/components/admin/student-form.tsx`, `roster-table.tsx`, `csv-import-panel.tsx`, `src/lib/csv-import.ts`
- Test: `csv-import.test.ts`, `student-form` tests if present

**Interfaces:** Consumes Task 6.
- `student-form.tsx`: replace the single `<select>` with a checkbox group of every class (`classGroups: string[]` prop in `sort_order`), initial state from `student.class_groups`, submits `class_groups: string[]`. Works for new and existing students; saving an edit sends the full set.
- `roster-table.tsx`: the class column renders all classes as compact chips (wrap, `—` when none).
- `csv-import.ts`: `CsvImportStudent.class_group: string|null` → `class_groups: string[]`. Add `class_groups` and `classes` as header aliases alongside the existing `class_group` ones (lines ~79–90). New signature: `parseRosterCsv(text: string, knownClassNames: readonly string[] = []): CsvImportReport` — when `knownClassNames` is non-empty, any class name not matching one (case-insensitively) becomes a row error `Row N: there's no class called "X". Add it under Classes first.`; the cell is split on `;`, trimmed, empty segments dropped, case-insensitive de-dupe keeping the first spelling. When `knownClassNames` is empty the check is skipped (existing callers/tests). `csv-import-panel.tsx` passes the live class names and previews the classes.
- Existing CSV protections (unterminated quote, header detection) and their tests are untouched.

- [ ] **Step 1: Write failing tests** in `csv-import.test.ts`: `splits a cell on semicolons and trims`, `drops empty segments and case-insensitive duplicates`, `accepts class_groups and classes headers`, `flags an unknown class as a row error naming it`, `skips the class check when no known classes are passed`, `an empty cell means no classes`, and a regression that the unterminated-quote test still passes. Form: `shows every class as a checkbox, checked from the student`, `submits the chosen set`, `submits [] when all are unticked`.
- [ ] **Step 2:** `npx vitest run src/lib/csv-import.test.ts` (+ form tests) — FAIL.
- [ ] **Step 3:** Implement. (Invoke `frontend-design`.)
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(admin): assign several classes per student, in the form and CSV import`.

---

### Task 10: `/admin` — class manager: delete dialog, membership sheet, bulk roster actions

**Files:**
- Create: `src/components/admin/class-members-sheet.tsx`, `src/components/admin/class-delete-dialog.tsx`, `src/lib/class-members.ts` (pure logic)
- Modify: `src/components/admin/class-manager.tsx`, `roster-manager.tsx`, `admin-dashboard.tsx`
- Test: `src/lib/class-members.test.ts`, component tests alongside if the repo has the pattern

**Interfaces — Produces (exact, `class-members.ts`):**
```ts
export interface MembershipDiff { add: string[]; remove: string[] }
export function diffMembership(original: ReadonlySet<string>, chosen: ReadonlySet<string>): MembershipDiff;
export function filterStudents(students: readonly RosterStudent[], q: { text: string; scope: "all" | "in" | "out" | { classGroup: string }; classId: string; className: string }): RosterStudent[]; // name/alias search, scope chips
export function describeDiff(diff: MembershipDiff): string; // "Add 12, remove 1" / "No changes"
```
Behaviour (follow the spec's "Adding many students to a class" and "Retiring a class" sections):
- Class manager rows show the member count (from `classMemberCounts`) and a **Students** button opening `ClassMembersSheet` (floating surface): search box, scope chips (All / In this class / Not in this class / each other class), per-row checkbox with the student's other classes in small text, **Select all shown**, sticky footer with `describeDiff` and one Save (calls `changeClassMembers` with the diff; disabled when no changes), Cancel. After Save, refresh roster and class list.
- Delete flow: `handleDelete` calls `deleteClass`; a 409 opens `ClassDeleteDialog` ("N students are only in this class", up to the first 5 names, class picker "Move them to…" defaulting to none, buttons **Move M students to X and delete** (M = the class's whole member count, enabled once a class is picked), **Delete anyway** (text states those students will have no class), **Cancel**). It re-calls `deleteClass` with `moveToClassId` or `force: true`. A 404 refreshes the list and shows the returned sentence. No red styling beyond the existing delete control's current variant.
- Roster manager: with rows selected (existing `selectedIds`), add **Add to class…** (class picker + confirm → `changeClassMembers` add-only per chosen class) and **Remove from class…** (class picker + a confirmation stating the count). Both refresh and show a `bulkInfo` message with the result counts.
- Nothing here touches student status.

- [ ] **Step 1: Write failing tests (`class-members.test.ts`):** `diffMembership returns only the changes`, `diffMembership is empty when unchanged`, `filterStudents scope "in"/"out"/other-class`, `filterStudents matches first name, last name and aliases case-insensitively`, `describeDiff wording for add only, remove only, both, none`. Component tests: `Save is disabled until something changes`, `a 409 on delete opens the dialog and Move is disabled until a class is chosen`, `Delete anyway re-sends force`, `Move re-sends moveToClassId`.
- [ ] **Step 2:** `npx vitest run src/lib/class-members.test.ts` — FAIL.
- [ ] **Step 3:** Implement. (Invoke `frontend-design`; screenshot the sheet and the dialog at phone width and desktop and view them.)
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(admin): bulk class membership, add/remove from roster, safe class delete`.

---

### Task 11: Seed data, mocks, docs, full gate

**Files:**
- Modify: `supabase/seed/roster.ts`, `scripts/seed.ts` (+ their tests), `CLAUDE.md`, `HANDOFF.md`, `README.md` (only the sections describing classes/the data model), `.env.example` untouched
- Test: existing seed tests

**Interfaces:** `roster.ts` entries use `class_groups: string[]` instead of `class_group`; add ~6 deliberately multi-class students (two classes each) without changing the adversarial surname cluster design or the 105 count. `scripts/seed.ts` inserts students, then `student_classes` links by class name→id (classes already seeded by the class_groups migration); it still refuses a non-local target without `--allow-remote`.
Docs: CLAUDE.md (data model, directory map entries for `student-classes.ts`/`class-members.ts`/new components, endpoint table rows for `classes-write` actions, replace the "class_group is free text / never touches students" statements, test counts), HANDOFF.md (new section with the deploy sequence from Task 12 and rollback note), README.md if it describes classes.

- [ ] **Step 1:** Update seed/mocks (tests that count students/classes must still pass: `npx vitest run supabase/seed scripts`).
- [ ] **Step 2:** Update docs.
- [ ] **Step 3:** Run `npm run lint && npm run typecheck && npm test && npm run build` — all green. Record the new test count.
- [ ] **Step 4:** Dispatch `careful-review` on the whole branch diff, prioritising Review Focus items 1–5; fix findings, re-run Step 3.
- [ ] **Step 5: Commit** — `docs+seed: multi-class students`.

---

### Task 12: Live rollout (user-gated; serial)

Do **not** start without the user's go-ahead for each numbered live step. Pause after each and report.

- [ ] **Step 1:** Ask the user to approve applying the **expand** migration only. Before `npx supabase db push --linked`, temporarily ensure the contract file is not pending (apply by explicit version, or move the contract file out of `supabase/migrations` for this push and restore it after). Verify with `mcp__supabase__execute_sql`: `student_classes` row count equals the number of students that had a non-blank `class_group`; no class names lost.
- [ ] **Step 2:** With approval, deploy all Edge Functions (`classes-write`, `roster-write`, `roster-list`, `roster-import`, `roster-delete`, `roster-reset`, `resolve-name`, `set-status`, `deepgram-token`, `carpool-write`) via `npx supabase functions deploy <name>`. Verify live: `roster-list` returns `class_groups` arrays and `classMemberCounts`; `classes-write` `members` adds then removes a throwaway test membership; `classes-write` `delete` on a class with a sole member returns 409; a wrong PIN still 401s. Clean up anything created.
- [ ] **Step 3:** With approval, merge `feature/multi-class-students` into `master` and push (Vercel deploys the frontend). Verify `/display`, `/announce`, `/admin` on the live site, including a student in two classes under both sections.
- [ ] **Step 4:** With approval, apply the **contract** migration. Re-verify roster counts (105 students, links intact, `students.class_group` gone).
- [ ] **Step 5:** Update `CLAUDE.md`/`HANDOFF.md` status lines with the deployed commit and verification results; commit and push.

---

## Self-review

- **Spec coverage:** data model/RLS/realtime/backfill/functions → T1; contract → T2; wire shapes, filter semantics, legacy-field rejection, 409/members/force/move → T3–T6; `/display` sections, totals, realtime hazards, tile line → T7; `/announce` → T8; form, table, CSV → T9; class manager delete dialog, bulk membership sheet, roster add/remove → T10; seed/docs/testing → T11; branch/push timing and expand-deploy-contract → Global Constraints and T12; decisions list is reflected throughout.
- **Placeholders:** none; every task names files, signatures and test names.
- **Type consistency:** `class_groups: string[]` (read) and `class_group_ids: string[]` (store write) used consistently; `RemoveClassGroupOutcome`/`ChangeMembersOutcome`/`ClassDeleteNeedsDecision` shapes match across T3, T5, T6, T10; SQL function names/args match between T1 and T4.
- **Proportion:** the plan states interfaces and tests and leaves bodies to the implementer.
