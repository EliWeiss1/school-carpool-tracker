/**
 * Flattens the PostgREST embed `student_classes(class_groups(name, sort_order))`
 * into the plain list of class names a StudentRow carries.
 *
 * Kept out of supabase-store.deno.ts (which only runs in Deno against a live
 * database) so the shape check and the ordering are unit-tested in Vitest.
 *
 * `student_classes` is a to-many embed (an array) and each link's
 * `class_groups` is a to-one embed (an object, or null for a link whose class
 * could not be read). If a schema change ever flipped either, silently reading
 * `undefined` would make every student look like they are in no class, so an
 * unexpected shape throws instead -- the same insurance toStudentRow already
 * applies to the student_parents embed.
 */

const SHAPE_ERROR =
  "student_classes embedded in an unexpected shape -- the schema no longer matches this code's assumption.";

interface ClassNameEntry {
  name: string;
  sortOrder: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One link row -> its class, or null when the class side is absent. */
function readLink(link: unknown): ClassNameEntry | null {
  if (!isRecord(link) || !("class_groups" in link)) throw new Error(SHAPE_ERROR);
  const group = link.class_groups;
  if (group === null) return null;
  if (
    !isRecord(group) ||
    typeof group.name !== "string" ||
    typeof group.sort_order !== "number"
  ) {
    throw new Error(SHAPE_ERROR);
  }
  return { name: group.name, sortOrder: group.sort_order };
}

/**
 * Class names in class sort_order, ties broken by name. Does not mutate its
 * input. Links with a null class are skipped.
 */
export function flattenClassNames(embed: unknown): string[] {
  if (!Array.isArray(embed)) throw new Error(SHAPE_ERROR);

  const entries: ClassNameEntry[] = [];
  for (const link of embed) {
    const entry = readLink(link);
    if (entry) entries.push(entry);
  }

  entries.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return entries.map((entry) => entry.name);
}
