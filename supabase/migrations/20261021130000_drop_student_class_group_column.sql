-- Multi-class students, step 3 of 3 (contract): drop the old single-class column.
--
-- Apply this one LAST, only after the frontend and Edge Functions that read and
-- write public.student_classes are deployed and verified live. Until then old
-- code still reads students.class_group, so dropping it earlier breaks the board.
--
-- This migration deliberately does NOT re-run backfill_student_classes() first.
-- Between the expand migration and now, admins manage classes through the new
-- membership tools (remove_class_group, change_class_members, ...). The stale
-- students.class_group text knows nothing of those edits, so a final backfill
-- would resurrect classes and memberships an admin had already removed. The
-- links in student_classes are the source of truth from the cut-over onward.

drop index if exists public.students_class_group_idx;

alter table public.students drop column class_group;

drop function public.backfill_student_classes();
