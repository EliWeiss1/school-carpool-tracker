/**
 * The optional grade / class narrowing that every announce endpoint accepts.
 *
 * It exists for two reasons at once: a shorter keyterm list stays inside
 * Deepgram's budget, and a smaller roster gives the resolver fewer confusable
 * names to weigh.
 */

import { readString } from "../http.ts";
import type { RosterFilter } from "../ports.ts";

export function rosterFilterFrom(body: Record<string, unknown>): RosterFilter {
  return {
    grade: readString(body, "grade"),
    classGroup: readString(body, "classGroup"),
  };
}
