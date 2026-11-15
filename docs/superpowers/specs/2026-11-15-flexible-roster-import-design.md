# Flexible roster + carpool import

## Context

New schools should get from "whatever spreadsheet the office already has" to a working roster with
carpools with as little reformatting as possible. The current importer
([src/lib/csv-import.ts](src/lib/csv-import.ts)) already matches headers by name, in any order, and
the server ([roster-import.ts](supabase/functions/_shared/handlers/roster-import.ts)) already creates
carpools from a `carpool` column. Real school files still fail for these reasons:

- only `.csv` files are accepted (offices have Excel or Google Sheets)
- the header must be on row 1
- names must be split into first and last columns
- an unrecognised header can only be fixed by editing the file and uploading it again
- a class name the app doesn't know rejects the row, so a brand-new school has to set up every class first
- importing the same file again is rejected if even one student is already on the roster
- carpools come in only through an exactly typed name column

**Decisions (from the user):** build both pieces: (1) a smart importer in the app, and (2) a
"Copy AI prompt" fallback for files it can't handle. Carpool formats vary, so support a carpool
column *and* suggest sibling carpools automatically. Class names that don't exist yet are
**created when the admin confirms**, after a preview line lists them.

**Branch:** `feature/flexible-import`, cut from `master`. It must not touch `preview/multi-school`.
That branch also edits `csv-import-panel.tsx` and `roster-import.ts`, in small diffs, so expect
minor conflicts when the two are merged. Per the preview-first memory, this goes to a preview
branch until it is approved, never straight to `master`.

## Design

### 1. Input: read many formats into one grid (`src/lib/import/read-source.ts`, new)
- `.csv`, `.tsv` and `.txt`: work out the delimiter (comma, tab or semicolon; European Excel uses
  semicolon) by counting consistent splits over the first rows. The existing RFC 4180 tokenizer is
  kept and given a delimiter parameter.
- `.xlsx`: read with **`read-excel-file`** (MIT, small, browser-side), loaded by `import()` only
  when an xlsx file is picked so it isn't in the main bundle. *Judgment call:* this is the first
  parsing dependency, and the importer was deliberately hand-rolled. A zip+XML format can't
  reasonably be hand-rolled. SheetJS was rejected because its npm build is stale and carries
  known CVEs. Legacy `.xls` gets a one-sentence "Save it as .xlsx or CSV" message.
- **Paste box:** a textarea next to "Choose file". Text copied from Google Sheets or Excel arrives
  tab-separated and goes through the same path. The pasted reply from the AI prompt also lands here.
- Output: `string[][]`. Everything after this step works on the grid, whatever the source was.

### 2. Understand the grid (`src/lib/import/detect-columns.ts`, new, pure)
- **Find the header row:** score each of the first ~10 non-blank rows by how many cells match a
  known field, and take the best. Rows above it are ignored, and the preview says so
  ("Skipped 2 title rows").
- **Looser header matching:** lowercase, strip punctuation and underscores, and drop the prefixes
  `student`, `child`, `child's`, `pupil` ("Student First Name" becomes "first name"). This keeps
  the existing priority-ordered alias walk (`mapHeaders`) and grows the alias lists:
  - `teacher` and `room` map to classes
  - `name`, `student`, `student name`, `full name` map to a new **`full_name`** field
  - `mom`, `dad` and `guardian` variants map to the parent fields
- **Full-name splitting** (`src/lib/import/split-name.ts`): "Cohen, Miriam" is read as last name,
  first name. With no comma, the default is *First … Last* (last word = surname). A name-order
  control in the mapping step switches to *Last First*.
- Output: a `ColumnMapping` (field → column index, plus a confidence for each), which feeds
  step 3.

### 3. Column mapping step (UI: `src/components/admin/import-mapping.tsx`, new)
- One row per column in the file: the header, 3 sample values, and a dropdown (First name / Last
  name / Full name / Classes / Carpool / Parent 1 / Parent 2 / Aliases / Ignore), pre-filled from
  step 2.
- Guesses with low confidence are marked "check this". Any change re-runs the validation
  immediately.
- When the guesses are confident and complete, the step starts collapsed ("We matched all 6
  columns, review") so a clean file doesn't cost an extra click.
- This replaces today's "rename the column and re-upload" warning.

### 4. Validation and preview (refactor `parseRosterCsv` into `buildImportReport(grid, mapping, context)`)
- All of the existing row rules are kept: blank rows, missing names, length limit, duplicates
  within the file, the unterminated-quote refusal. Every test in `csv-import.test.ts` keeps
  passing through a thin `parseRosterCsv` wrapper.
- **Unknown classes** stop being row errors. They collect into `newClasses: string[]`, and the
  preview shows "These 7 classes will be created: …". Case- and whitespace-variants fold into one
  class (first spelling wins), so a typo shows up as an extra entry the admin can see.
- **Already on the roster:** the context carries the current roster's name keys, and matching
  rows are listed as "Already on the roster, will be skipped" instead of failing the whole import.
  The server's 409 guard stays as the backstop.
- **Carpools:**
  - Typed carpool values are normalised (trim, collapse whitespace, compare case-insensitively)
    and shown as "Carpools: Levy (3 students, new), Cohen family (2, existing)". A typo becomes
    a visible one-member carpool.
  - **Sibling suggestions** (`src/lib/import/suggest-carpools.ts`, pure): students with no
    carpool value who share a surname **and** at least one parent name (or a surname alone when
    the file has no parent columns, with a softer label) are offered as
    "Suggested carpool: Cohen family — Miriam, Aaron" with a checkbox.
  - Suggestions are **off by default when there are no parent columns, on when parents match**.
  - A checked suggestion fills in those students' `carpool` value before import. It never
    overrides a carpool typed in the file.
  - Sibling grouping needs no name match for voice: `resolve-name` already collapses students
    who share a `carpool_id`.

### 5. Server: create missing classes (`roster-import.ts`)
- The body gains an optional `createMissingClasses: true`. When it is set, `resolveClasses` calls
  the existing `store.createClassGroup` for each unknown name (case-insensitively unique,
  created once), the same way `resolveCarpools` already creates carpools. When it is absent,
  today's 422 behaviour is unchanged, so an old open browser tab still behaves the same.
- New classes get the next `sort_order`. `RosterImportHandlerDeps.store` adds `createClassGroup`
  to its `Pick`.
- Add `createMissingClasses` to `RosterImportInput` in [admin-api.ts](src/lib/admin-api.ts).
- The client sends it only when the admin confirmed a preview that listed new classes.

### 6. "Copy AI prompt" fallback (`src/lib/import/ai-prompt.ts`, pure, plus a panel section)
- A collapsible "File won't import? Let your AI tool reformat it" section with a **Copy prompt**
  button. The prompt is generated live and includes:
  - the exact header line `first_name,last_name,classes,carpool,parent1_name,parent2_name,aliases`
  - the school's current class names ("use these exact names where they match; new names are
    fine")
  - the rules: one row per student; split full names; several classes separated by `;`; give
    siblings and kids who ride together the same carpool value; merge in any separate carpool
    list; one row per child when a row lists several children; leave a cell blank rather than
    guessing; output only the CSV in one code block
- Step text: "1. Copy this prompt. 2. Paste it into ChatGPT, Claude, Gemini… with your
  spreadsheet attached. 3. Paste the reply into the box above."
- A one-line privacy note: "This shares your students' names with that AI service. Check your
  school's policy first." No server-side AI: no student data leaves the app through us.

### 7. Panel restructure ([csv-import-panel.tsx](src/components/admin/csv-import-panel.tsx))
- Retitle to "Import your roster".
- Flow: **Source** (file or paste) → **Columns** (mapping, collapsed when clean) → **Preview**
  (counts, new classes, carpools and suggestions, skipped and errors) → **Import** → the existing
  undo.
- Keep the panel thin: state lives in a small reducer `src/lib/import/import-flow.ts`, unit-tested
  the same way `announce-reducer.ts` is.
- Split the presentational pieces into `import-source.tsx`, `import-mapping.tsx`,
  `import-preview.tsx` and `import-ai-help.tsx`.
- Curbside tokens only. Red and green only for the will-import and skipped counts, as today.
- Invoke the `frontend-design` skill before writing any UI.

### 8. Making the UI clear (user requirement: obvious options, visibly flexible)
- **Show the choices first.** Before anything is uploaded, the panel shows three equal cards, so
  the options are visible without reading instructions:
  - **Upload a spreadsheet**: "Excel, CSV or Google Sheets download. Any column order, any
    headings."
  - **Paste from a spreadsheet**: "Select the cells in Excel or Google Sheets, copy, paste here."
  - **Let your AI tool tidy it**: opens the prompt section from step 6.
- **Say outright that it's flexible**, as a short line of chips under the cards:
  "Headings can say *Student Name*, *Surname*, *Teacher*, *Homeroom*… · Title rows are fine ·
  Classes and carpools are created for you".
- **Show a step tracker** across the top: `1 Choose · 2 Check columns · 3 Review · 4 Import`.
  The current step is in marigold, and the admin can click back to any earlier step without
  losing anything.
- **Make the column step show, not tell.** Each column is a card with its heading, 3 real sample
  values and "We think this is: Last name ▾".
  - Confident guesses get a quiet "Matched" label. Unsure ones are outlined in marigold with
    "Check this".
  - Only two things block the import: no name column (first+last, or a full name), or the same
    field chosen twice. Both are said in one plain sentence at the top of the step.
- **Phrase the review step as outcomes** ("**98 students** will be added · **7 new classes**:
  K1, K2… · **12 carpools** · **3 already on your roster** (skipped) · **2 rows need a fix**").
  Each line expands to its list.
  - Sibling suggestions sit in their own card ("We found 9 families with more than one child —
    group them as carpools?"), with a select-all and a checkbox per family.
- **Offer a sample file.** A "Download a sample file" link: a CSV with the ideal headings and two
  example rows (Jewish sample names, per the landing-page preferences), for schools that would
  rather fill in a template.
- **Explain errors in place.** Each row error names the row as the spreadsheet shows it and says
  how to fix it, with a "Fix in the file and re-upload, or skip these rows" choice.
- Verified by screenshots at desk width and 390px phone width, with the walkthrough done cold:
  could someone who has never seen it import a messy file without reading paragraphs?

### 9. Landing page note (on `preview/multi-school`, in its worktree)
- Edit `C:/Users/eliis/AI_Projects/School_Carpool_Tracker-multischool`, branch
  `preview/multi-school`, where the landing page lives
  ([landing-sections.tsx](../School_Carpool_Tracker-multischool/src/components/landing/landing-sections.tsx),
  `SetupSection`, whose step 2 reads "Add your roster").
- Keep to the user's landing-page preferences: very little text, no small text, colourful but not
  extreme. Proposed change:
  - Step 2 becomes **"Drop in your spreadsheet"**, with a one-line subhead in body size: "Any
    format. We sort it out."
  - Under the four steps goes one row of large format chips, white on the blue band:
    `Excel` `Google Sheets` `CSV` `Copy & paste`, ending with a marigold chip "Messy is fine".
    The headline "Ready by this afternoon's pickup." already sells the speed. This adds why it
    is believable.
- Invoke `frontend-design` and `copywriting` before editing. Screenshot on that worktree's dev
  server (port 3107) at desk and phone widths.
- Commit **only** `landing-sections.tsx` to `preview/multi-school`, then push. Another session may
  be working in that worktree, so check `git status` first and never stage its files.
- **Order:** do this last, once the importer works, so the page never claims something the
  product can't do. Both still need to be merged before the claim is true in production. Note
  that in HANDOFF.md on both branches.

### Non-goals
- No server-side AI or LLM call. No persisting uploaded files.
- No `.xls` and no Google Sheets API (paste covers Sheets).
- No separate "carpool sheet" upload; the AI prompt merges those.
- No "replace roster" mode; import still only adds.

## Files
New: `src/lib/import/{read-source,detect-columns,split-name,suggest-carpools,ai-prompt,import-flow}.ts`
plus tests, and `src/components/admin/import-{source,mapping,preview,ai-help}.tsx`.
Modified: `src/lib/csv-import.ts` (delimiter param, report builder, wrapper),
`csv-import-panel.tsx`, `admin-dashboard.tsx` (pass the roster name keys),
`supabase/functions/_shared/handlers/roster-import.ts` and its test, `src/lib/admin-api.ts`,
`package.json` (`read-excel-file`), plus CLAUDE.md, the README import section and HANDOFF.md, and the
design doc `docs/superpowers/specs/2026-11-15-flexible-roster-import-design.md` (committed first).
Reuse: `tokenizeCsv`, `mapHeaders`, `splitClasses` and `splitAliases` from `csv-import.ts`;
`resolveCarpools`, `resolveClassNames` and `store.createClassGroup` on the server; `ErrorBanner`,
`Button` and `ModalSurface` from the UI kit.

## Execution (models + parallelism)
0. Run `/find-skills` for spreadsheet-import or xlsx skills; vet them and report back. Write and
   commit the design doc. *(inline, Opus)*
1. **Parallel group A**, independent pure modules, each with Vitest (TDD):
   - `read-source` with delimiter sniffing and the xlsx adapter: **Sonnet**
   - `detect-columns` and `split-name`: **Sonnet**
   - `suggest-carpools`: **Sonnet**
   - `ai-prompt`: **Haiku** (`boilerplate`), since it is template text plus a snapshot test
   - server `createMissingClasses` and handler tests: **Sonnet**
2. Report-builder refactor of `csv-import.ts` (new classes, roster skip, carpool summary) keeping
   the old tests green. Depends on A. *(Sonnet)*
3. `import-flow` reducer, then the UI components and panel rewire. *(inline, Opus, with
   frontend-design)*
4. `careful-review` (Opus) on the server class-creation change and the sibling-suggestion
   heuristic, so that a suggestion can never silently merge two different families.
5. Update the docs, run `npm run lint && npm run typecheck && npm test`, then commit and push to
   `feature/flexible-import` (preview only; not merged to master).
6. Landing page note on `preview/multi-school` (step 9). *(Sonnet, frontend-design + copywriting;
   can run in parallel with steps 4–5 since it is a different worktree and branch)*

## Verification
- Unit tests cover:
  - delimiter sniffing (comma, tab, semicolon)
  - finding the header on row 3
  - "Student Name" with "Cohen, Miriam" and with "Miriam Cohen"
  - prefixed headers
  - classes that don't exist yet being collected, not rejected
  - roster duplicates being skipped
  - sibling suggestions with and without parent columns, and two different Cohen families with
    different parents *not* merged
  - the server creating classes once and still returning 422 when the flag is absent
  - the AI prompt including the live class names
- Fixture files under `src/lib/import/__fixtures__/`: a messy xlsx with a title row, merged
  first/last names and a "Teacher" column, a semicolon-delimited European CSV, and a Google Sheets
  paste. Each must preview correctly.
- Manual check: `npm run dev` (only when no dev server is already running, and never `npm run build`
  while one is), `/admin`, import each fixture, screenshot the mapping and preview steps at desk
  and phone widths. Write calls are intercepted or faked; nothing hits the live Supabase project
  without asking first.
- Deploying the changed `roster-import` function is a separate step that needs the user's OK.
