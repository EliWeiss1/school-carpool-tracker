import { LEGACY_SCHOOL_ID } from "../functions/_shared/schools.ts";

/**
 * Which school `npm run seed` wipes and refills, read from its arguments.
 *
 * Seeding deletes a school's students and history first. Once there is more
 * than one school, "which school" has to be answered before anything is
 * touched, and a muddled answer must stop the script rather than fall back to
 * a default: the default is the original school, the one with real children
 * in it.
 */

export type SeedSchool =
  { by: "id"; id: string } | { by: "slug"; slug: string };

export type SeedTarget =
  | { ok: true; allowRemote: boolean; school: SeedSchool }
  | { ok: false; error: string };

/** The same rule the database enforces on `schools.slug`. */
const SLUG = /^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$/;

export function parseSeedTarget(argv: readonly string[]): SeedTarget {
  const allowRemote = argv.includes("--allow-remote");

  const named: (string | undefined)[] = [];
  argv.forEach((arg, index) => {
    if (arg === "--school") named.push(argv[index + 1]);
    else if (arg.startsWith("--school=")) named.push(arg.slice(9));
  });

  if (named.length === 0) {
    return {
      ok: true,
      allowRemote,
      school: { by: "id", id: LEGACY_SCHOOL_ID },
    };
  }
  if (named.length > 1) {
    return { ok: false, error: "Name one school with --school, not several." };
  }

  const slug = named[0];
  if (slug === undefined || slug === "" || slug.startsWith("--")) {
    return {
      ok: false,
      error:
        "--school needs the school's web address, for example --school oak-hill.",
    };
  }
  if (!SLUG.test(slug)) {
    return {
      ok: false,
      error: `"${slug}" is not a school web address. Use the part after /s/ in the school's link.`,
    };
  }
  return { ok: true, allowRemote, school: { by: "slug", slug } };
}
