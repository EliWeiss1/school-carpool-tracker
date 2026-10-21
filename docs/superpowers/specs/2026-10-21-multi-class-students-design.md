# Students in multiple classes — design

Date: 2026-10-21. Status: draft for approval.

## Intent and why

Some classes meet only on certain days or times, and on other days the same
students sit in a different class group. Today a student has exactly one
`class_group`, so a teacher whose class includes "visiting" students either
doesn't see them on the board or sees them under the wrong class.

The fix: a student can belong to **any number of classes**, and staff can add
or remove a class for a student **at any time**, including students already
on the roster. On `/display`, each teacher picks the class relevant to them
that day from the existing class dropdown; a student in two classes shows up
under both.

There is deliberately **no schedule, no weekday, no "today's classes"
state**. Which class applies on which day lives in the teachers' heads. The
app only needs to make every class a student belongs to a selectable,
correct view.

## Goals

- A student belongs to zero or more classes. Staff can change that set from
  `/admin` at any time with immediate effect everywhere.
- `/display`: the class dropdown lists every class; choosing one shows every
  student in that class, including students who are also in other classes.
- `/announce`: a student is reachable from every one of their classes (class
  drawer, class-narrowing filter, typeahead, name matching).
- Status stays a property of the **student**. Announcing a multi-class
  student turns all their tiles to arrived together, with one flash and one
  chime per screen.
- The data model follows relational practice: a junction table with real
  foreign keys and constraints, no arrays or delimited strings in columns,
  and one source of truth for class membership.
- Existing data survives: every student keeps the class they have today.

## Non-goals

- Day-of-week or time-based scheduling, or any notion of "the active class".
- Per-class status (a student arrives once, not once per class).
- A primary/home class distinction. All memberships are equal. (Anti-goal
  below.)
- Class renaming (does not exist today; not added here).
- Changing carpools, which are an orthogonal grouping.

## Anti-goals (would be a failure even if it technically works)

- A student appearing twice in a count (waiting/arrived totals must count
  distinct students).
- A student chiming or flashing twice, or chiming a teacher whose selected
  class does not contain them.
- Any code path that creates or changes a status as a side effect of editing
  class membership. Class edits must never touch `status` or `arrived_at`.
- A class membership edit that leaves a student half-updated (partly old
  set, partly new set) if the request fails midway.
- Silent data loss: deleting a class must never quietly leave a student with
  **no class at all**. Removing a class from a student who is also in
  another class is routine and needs no ceremony; stranding a student in
  "Ungrouped" needs an explicit, informed confirmation.
- Making staff edit students one at a time to populate a class. Putting many
  students into a class must be a single, quick action.

## Current state (what the builder is starting from)

- `students.class_group` is a **free-text** column. `class_groups` (id, name,
  sort_order) is only a suggestion list for pickers; there is no foreign key
  between them (migration `20260916010000_class_groups.sql`). A student can
  today carry a class name that is not on the list.
- `class_groups` is publicly readable; students are publicly readable;
  all writes go through service-role Edge Functions. `student_parents`
  (migration `20260916000000_parent_names.sql`) is the existing precedent for
  a side table joined into the student row by the store layer.
- `/display` loads `students.select("*")` with the anon client and subscribes
  to Postgres Changes on `students` only. `display-sections.ts` groups by
  `student.class_group`. Sections are keyed by class name.
- `class_group` appears in roughly 40 source files (types, store port, real
  and fake store, handlers, CSV import, admin form/table/class manager,
  announce reducer/drawer/rail/typeahead, display, seed data, tests). A
  full inventory is `grep -rn "class_group\|classGroup" src supabase scripts`.
- Edge Function filter `classGroups: string[]` (class **names**) already
  narrows the roster, keyterms and resolver pool.

## Data model

New table `public.student_classes`:

| Column | Type | Notes |
| --- | --- | --- |
| `student_id` | `uuid not null` | FK → `students(id)` **on delete cascade** |
| `class_group_id` | `uuid not null` | FK → `class_groups(id)` **on delete cascade** |
| `created_at` | `timestamptz not null default now()` | |

- Primary key `(student_id, class_group_id)`: a student cannot be in the
  same class twice. The PK index also serves "classes of a student".
- Secondary index on `(class_group_id, student_id)` for "students of a
  class" (used by `/display`, drawers, filters).
- **Delete behaviour.** Removing a student removes only their links.
  Removing a class cascades to its links, **but** the application guards the
  one case that matters: if any student's *only* class is the one being
  deleted ("sole members"), the delete is not carried out until the admin
  explicitly decides what happens to them (see "Retiring a class" below).
  Students who are also in another class simply lose this one with no
  ceremony. The guard cannot live only in the FK, so it lives in a Postgres
  function (below) that checks and deletes in one transaction.
- RLS: same shape as `class_groups`/`students`: RLS on, `revoke all`
  from anon/authenticated, `grant select`, one public `select` policy, **no**
  write policies. Writes only via the service role.
- Realtime: add `student_classes` to the `supabase_realtime` publication so
  `/display` hears membership edits.
- `students.class_group` and `students_class_group_idx` are **dropped**
  once the cut-over is complete (one source of truth).

Class membership writes must be atomic. supabase-js has no transactions, so
the "replace this student's set of classes" operation is a Postgres function
(e.g. `set_student_classes(student_id uuid, class_group_ids uuid[])`) that
deletes the removed links and inserts the added ones in one statement
block. Like `nightly_reset_board()`, it is revoked from anon/authenticated
and called only by the service-role store. Student creation (single and CSV
bulk) also writes memberships atomically with the student where practical;
the builder decides how, as long as a failed request never leaves a student
with a partial set.

Two more database functions, same privileges (revoked from
anon/authenticated, service role only), both atomic:

- `change_class_members(class_group_id uuid, add_ids uuid[], remove_ids
  uuid[])`: inserts the missing links (`on conflict do nothing`, so adding a
  student already in the class is a no-op) and deletes the listed links.
  Drives the bulk-assign UI. Ids that are not on the roster are ignored and
  reported back, not an error.
- `remove_class_group(class_group_id uuid, move_to uuid default null, force
  boolean default false)`: locks the class row, finds sole members, and
  then: with none, deletes; with sole members and `move_to` set, links
  **every** member of the class (sole members and students who are also in
  other classes alike) to `move_to` and deletes; with sole members and `force`,
  deletes and leaves them with no class; with sole members and neither,
  deletes nothing and returns the sole-member count and a capped sample of
  their names so the caller can ask. `move_to` equal to the class being
  deleted, or a nonexistent class, is an error. Doing the check and the delete
  in one transaction means a student added or removed concurrently cannot slip
  past the guard.

## Migration plan (expand, then contract)

Frontend (Vercel) and Edge Functions deploy separately from the database, so
the change ships in two migrations to avoid a window where deployed code
reads a column that no longer exists:

1. **Expand** migration: create `student_classes` (+ indexes, RLS, grants,
   publication, the replace function). Backfill: for every distinct
   non-empty `students.class_group`, match to `class_groups` by
   `lower(trim(name))`; if no match, insert a new `class_groups` row
   (appended after the highest `sort_order`, original spelling trimmed) so no
   student loses a class. Then insert one `student_classes` row per student
   with a class. The backfill is idempotent (safe to re-run). `class_group`
   column is left in place.
2. Deploy the Edge Functions, then the frontend, both reading the new table.
3. **Contract** migration: drop `students.class_group`,
   `students_class_group_idx` and the `backfill_student_classes()` helper. It
   deliberately does **not** re-run the backfill: by then `student_classes` is
   the source of truth, and re-running would resurrect classes an admin
   retired and memberships an admin removed after the deploy (found in task
   review). Instead, immediately before applying it, the rollout compares the
   legacy `class_group` text against the links and shows the user any
   student whose text has no matching link, so a write that old code made
   during the short window between steps 1 and 2 can be fixed by hand.

The live roster is small and single-building; a brief inconsistency window
between steps 1 and 2 is accepted. The sequence and a rollback note (the
column still exists until step 3) go in `HANDOFF.md`.

**Branching and push timing.** Vercel auto-deploys the frontend on every
push to `master`, so pushing code that reads `student_classes` before the
table exists live would break `/display` and `/announce`. Therefore: all
work happens on a feature branch. Nothing merges to `master` (and so nothing
ships) until the user has approved, and the builder has run, the live steps
in order: apply the expand migration, deploy the Edge Functions, verify live,
then merge/push so Vercel deploys the frontend. The plan needs explicit pause
points for the user's go-ahead before each live step, consistent with the
project rule about not spending or changing live resources unasked.

**The contract migration is authored in this change** (so `schema.test.ts`
and the full test suite run against the final schema, with the column gone)
but is **applied live last**, only after the frontend has been deployed and
verified. Because `supabase db push` applies every pending migration, the
plan must apply the expand migration first (push before the contract file is
on the linked branch, or apply by explicit version) and apply the contract
migration as its own later step.

## Wire and store shapes

- `StudentRow` (store port) and `Student` (browser type) drop `class_group:
  string | null` and gain `class_groups: string[]`: the student's class
  **names**, ordered by `class_groups.sort_order`. Empty array means
  "Ungrouped". Names are unique case-insensitively (existing unique index),
  and there is no rename, so names are a stable identifier on the read side.
- The real store reads them with an embedded select, alongside the existing
  `student_parents` embed (e.g. `*, student_parents(...),
  student_classes(class_groups(name, sort_order))`), flattening and sorting
  in the same place `toStudentRow` already flattens parents.
- Writes (`roster-write` create/update, `roster-import`) accept
  `class_groups: string[]` of names. The handler validates each name against
  `class_groups` and resolves to ids server-side. An unknown name is a 4xx
  with a one-sentence message naming it ("There's no class called 'Art'.
  Add it under Classes first."). Duplicates in the request are collapsed. An
  update that omits `class_groups` leaves memberships untouched; sending `[]`
  clears them (matches the existing partial-patch semantics).
- `StudentWriteInput.class_group` becomes `class_groups: string[]`.
- **A request still carrying the old singular `class_group`** (a stale admin
  tab or an old frontend during the deploy window) to `roster-write` or
  `roster-import` is **rejected** with one sentence ("This page is out of
  date. Reload it and try again."), never mapped or ignored. Mapping it to a
  one-element set would silently strip a multi-class student's other
  classes; ignoring it would silently drop the edit. (The read-side
  `classGroup` filter compatibility is unaffected: it only narrows reads.)
- `RosterFilter.classGroups` (names) keeps its meaning: a student matches if
  **any** of their classes is in the filter; absent/empty still means "every
  class". The wire accepts, as it does today, the old single `classGroup`
  string merged into the array.
- `classes-write` (extend it; do **not** add a new Edge Function, because
  `pin-budget.test.ts` sums the wrong-PIN allowance across every deployed
  function and fails the build past 50):
  - `remove` takes `classGroupId` plus optional `moveToClassId` and
    `force`. With sole members and neither option it returns **409** with
    `{ error, soleMemberCount, soleMembers: [{ id, first_name, last_name }]
    (capped) }`; the `error` is a plain sentence ("3 students are only in this
    class."). Otherwise it behaves per `remove_class_group` above.
  - a new `members` action takes `classGroupId`, `addStudentIds` and
    `removeStudentIds` and calls `change_class_members`. It returns the
    class's updated member count and any ids it ignored.
  - the file's header comment (which says it never touches `class_group`) is
    rewritten to describe the new rules. Same PIN guard, rate limit and
    wrong-PIN budget wiring as the existing actions.
- Resolver (`resolve.ts` currently maps `student.class_group`): carries the
  array through; the carpool collapse and tier policy are unchanged. A
  student matched via any class is one candidate, never duplicated.

## Screens

### `/admin`

- Student form: the single class select becomes a multi-select of checkboxes
  (all classes from the existing admin-editable list, in `sort_order`).
  Works identically when adding a new student and when editing an existing
  one; saving applies immediately. No class selected = Ungrouped.
- Roster table: the class column shows all of a student's classes (compact,
  e.g. comma-separated or chips; builder's call within the Curbside design
  system).
- Class manager: shows the member count per class.

#### Adding many students to a class (bulk assign)

The requirement: putting a whole group of students into a class (a new
elective, a visiting group) never means opening each student. The interaction
design is the builder's within the Curbside system, but the intended shape,
which the builder should follow unless it hits a real problem, is two entry
points over the one `members` action:

1. **From the class** (primary): each class in the class manager has a
   "Students" button that opens a floating sheet, a membership editor for
   that class. It lists every student with a checkbox, checked if they are in
   the class. A search box filters by name; filter chips narrow to "In this
   class", "Not in this class" and any other class (so "everyone currently in
   3rd" is one click away, which is how a new group is usually built from an
   existing one); "Select all shown" ticks everyone visible. Each row shows the
   student's other classes in small text so the admin can see who is already
   placed. A sticky footer says what saving will do ("Add 12, remove 1")
   and one Save button applies it. Cancel discards. Unchecking is allowed, so the
   same sheet also edits and removes members.
2. **From the roster** (secondary): the roster table's existing row selection
   (builder: confirm it exists; `removeStudents(ids)` suggests it does) gains an
   "Add to class…" action: pick a class, and every selected student is added.
   Alongside it, a "Remove from class…" action takes the same selection and
   removes those students from one chosen class (a confirmation states the
   count). Removing one or a few specific students from a class is thus
   possible three ways: untick them in the class's membership sheet, use this
   action from the roster, or untick the class on the individual student's form.

Both use `members` (add/remove id lists), so there is one server path to test.
Neither touches status or `arrived_at`.

#### Retiring a class

Deleting a class in the class manager is a single action when it is safe:
a class with no members, or whose members are all also in another class,
deletes immediately (its links go with it).

When some students are in no other class, the first delete attempt returns the
409 above and the UI opens a confirmation dialog instead of deleting: "N
students are only in this class" with the first few names, a class picker
("Move them to…", defaulting to nothing selected), and three actions: **Move N
students to [class] and delete** (enabled once a class is chosen), **Delete
anyway** (the sole-member students will have no class; the dialog says so in
words), and **Cancel**. "Move" relocates **all** of the class's students
(per the user), including those who are also in other classes; those keep
their other classes and gain the destination. The button count therefore
shows the whole membership, not just the sole members. Both resolve calls
repeat the `remove` with `moveToClassId` or `force`.

### CSV import

- The `class_group` header (and its existing aliases) continues to work; add
  `class_groups`/`classes` as aliases. A cell may contain several class names
  separated by `;`. A comma cannot be the separator inside a CSV cell
  without quoting.
- Unknown class names are a **validation error** on that row in the import
  report (naming the class and telling staff to add it under Classes first),
  not silently created. This prevents a typo creating a junk class. (Builder:
  keep the existing unterminated-quote protections and tests untouched.)

### `/display`

- Class dropdown: lists every class (existing behaviour, single selection),
  plus "All classes". No change in how a teacher uses it.
- `display-sections.ts`: a student is placed in **every** section for the
  classes they belong to, and in "Ungrouped" only if they have none. Section
  `waiting`/`arrived` counts are per class. **Header totals and the "All
  classes" totals count distinct students.** `visibleIds` is the union of
  ids in visible sections (used to scope flash and chime; a student in two
  visible sections still flashes/chimes once).
- A student in the "All classes" view therefore appears as one tile in each
  of their classes' sections. Tiles are keyed by `(sectionKey, studentId)`,
  not by student id alone. Flash state stays keyed by student id so all of a
  student's visible tiles flash together.
- Realtime has a new hazard the builder must handle explicitly:
  1. `students` UPDATE payloads carry no class data (it lives in another
     table). `reconcile` must preserve the held row's `class_groups` when
     applying a `students` payload, and must not blank it.
  2. Membership edits do not change `students.updated_at`, so
     `applySnapshot`'s freshness check on `updated_at` would keep stale
     classes. Class membership must be taken from the snapshot regardless of
     that check, or the snapshot must otherwise be allowed to replace it.
  3. `/display` also subscribes to `student_classes` and, on any event,
     re-runs the snapshot fetch (debounced). Membership edits are rare, a
     refetch is simple and always correct, and it must never trigger a
     flash or chime.
  Cover all three with `realtime-reconcile` tests, including: a rename
  arriving after a class change; a status arrival for a two-class student;
  and a reconnect.
- The tile's secondary meta line (`student-tile.tsx` reads `class_group`) is
  **removed**: in sectioned views the class is already the heading, and no
  unsectioned view should print an arbitrary one of several classes. Adjust
  any tile layout/font-fit tests that assumed the line.
- Chime/flash scoping: arrivals only fire for ids in `visibleIds`, as today,
  so a teacher viewing the 5th class is not chimed for a 3rd-only student.

### `/announce`

- `class-roster.ts`, class drawer and class rail: a student is listed in
  every class they belong to. Tapping to announce acts on the student; the
  other drawers reflect the new status immediately (the same roster source
  already drives this).
- Typeahead, candidate list and the class-narrowing filter: match on any
  class; never show the same student twice in one list.
- Keyterm minting and `resolve-name` use the filter semantics above.

## Seed data, mocks, docs

- `supabase/seed/roster.ts` and `scripts/seed.ts`: seed `student_classes`
  from the roster, and include a handful of deliberately multi-class
  students so the new paths are exercised. The seed is still 105 students; do
  not change its adversarial surname design.
- `display-mock-roster.ts` gains multi-class students for the dev preview.
- Update `CLAUDE.md` (data model, directory map, classGroup notes, the
  "never touches a student's class" statements, test counts), `HANDOFF.md`
  (deploy sequence above), and `README.md` if present (any section
  describing the school data model).

## Testing

- `supabase/migrations/schema.test.ts` (PGlite): PK rejects a duplicate
  pair; FK rejects a nonexistent student/class; deleting a student cascades
  only links; deleting a class cascades its links; anon can select but not
  insert/update/delete; the replace, `change_class_members` and
  `remove_class_group` functions are atomic and not callable by
  anon/authenticated. `remove_class_group` specifically: no sole members
  deletes; sole members with neither option deletes nothing and reports them;
  with `move_to` every member (sole or not) is linked to the destination and
  the class is deleted;
  with `force` they end with no class; a student in two classes is never
  counted as a sole member; a bad `move_to` is an error and rolls back. A dedicated test of the
  **backfill**: apply migrations up to before the expand migration, insert
  students with assorted class text (mixed case, padded whitespace, a name not
  in `class_groups`, null), apply the expand migration, assert the links and
  new class rows; assert re-running the backfill changes nothing.
- Handler tests against the fake store (updated to hold sets of classes):
  create/update with several classes; omitted vs empty `class_groups`;
  unknown name; duplicates; class delete returning the 409 with sole members,
  then succeeding with `moveToClassId` and with `force`; `members` add/remove,
  re-adding an existing member, and an unknown student id; filter matches any
  class; resolver returns a multi-class student once.
- Pure-logic tests: `display-sections` (appears in each section; totals
  distinct; visibleIds union; Ungrouped only if none), `class-roster`,
  `typeahead`, `csv-import` (`;` separator, unknown class error), reducer.
- Existing suites (533 tests) stay green; no real Deepgram or Supabase
  credits spent. Applying the migrations to the live project and redeploying
  functions requires the user's go-ahead, as with prior deploys.

## Decisions made by me (the writer), for the user to check

1. Class deletion cascades, per the user, except that sole members trigger a
   confirm/move dialog. "Move" relocates every member of the class, including
   students who are also in other classes (user's clarification).
2. A student shows in every one of their sections in "All classes" view,
   with totals counting distinct students.
3. CSV: unknown class names are a row error, not auto-created; `;` separates
   multiple classes in one cell.
4. Names (not ids) are the read-side identifier on the wire; writes resolve
   names to ids server-side.
5. Two-step expand/contract migration with an idempotent backfill.
6. Membership replacement is a Postgres function for atomicity.
7. `/display` handles membership edits by refetching the snapshot on any
   `student_classes` realtime event.
8. Bulk assign UI (the user left the design to me): a per-class membership
   editor sheet as the primary path, plus add-only "Add to class…" from the
   roster table's selection. Both go through one `members` action added to
   `classes-write` rather than a new Edge Function (PIN-budget ceiling).
9. Work on a feature branch; merge to `master` only after the live steps are
   approved and run (see "Branching and push timing").
10. The contract migration is authored now but applied live last.
11. A stale request carrying the old singular `class_group` is rejected, not
    mapped or ignored.
12. The tile's class line is removed.

## Left to the builder

Component and styling details within the Curbside design system (chips vs
checkbox list; the roster table's class column); exact SQL and function
names; how single-student create writes memberships atomically; debounce
interval; file-by-file ordering of the change; how to phase the plan for
parallel work (the schema, store/handlers, and the three screens are largely
separable once the `class_groups: string[]` shape is fixed).
