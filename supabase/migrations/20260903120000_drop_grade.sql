-- Drops the grade column. Classification is now a single field: class_group
-- (e.g. "K1", "K2", "1st" ... "5th"). Grade and class_group used to be
-- independent (one class per grade in the sample data, but the schema
-- allowed several classes per grade); the app never needed that second axis,
-- so it is gone rather than left unused.

alter table public.students drop column grade;
