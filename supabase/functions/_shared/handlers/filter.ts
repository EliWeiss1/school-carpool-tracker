/**
 * The optional class narrowing that every announce endpoint accepts.
 *
 * It exists for two reasons at once: a shorter keyterm list stays inside
 * Deepgram's budget, and a smaller roster gives the resolver fewer confusable
 * names to weigh.
 *
 * Two wire spellings are accepted and merged: `classGroups` (an array, what
 * /announce sends now) and `classGroup` (a single string, what any client built
 * before multi-class narrowing still sends). Keeping the old one means a stale
 * browser tab never breaks mid-deploy. This only narrows a read: a student
 * matches when ANY of their classes is named, and an empty filter means every
 * student, classless ones included -- the store applies that rule. (Writes are
 * stricter: the singular `class_group` on a write is refused, see
 * class-input.ts.)
 */

import { readString } from "../http.ts";
import type { RosterFilter } from "../ports.ts";

/** The class list is admin-editable but small; this only bounds a hostile body. */
const MAX_CLASS_GROUPS = 50;

export function rosterFilterFrom(body: Record<string, unknown>): RosterFilter {
  const names = new Set<string>();

  const single = readString(body, "classGroup");
  if (single !== null) names.add(single);

  const many = body["classGroups"];
  if (Array.isArray(many)) {
    for (const item of many) {
      if (names.size >= MAX_CLASS_GROUPS) break;
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (trimmed !== "") names.add(trimmed);
    }
  }

  return { classGroups: [...names] };
}
