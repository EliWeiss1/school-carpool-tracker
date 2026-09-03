/**
 * The seams between the handlers and everything outside them.
 *
 * Handlers depend on these interfaces, never on supabase-js: that is what lets
 * the whole request path be tested in Vitest against an in-memory roster with no
 * database, no network and no Deno, while the Edge Function entrypoints supply
 * the real implementations.
 */

export type StudentStatus = "waiting" | "arrived";
export type StatusEventSource = "voice" | "manual" | "admin";

/** A roster row as the handlers see it. Mirrors public.students. */
export interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  aliases: string[];
  grade: string | null;
  class_group: string | null;
  status: StudentStatus;
  arrived_at: string | null;
  updated_at: string;
}

/** Narrows the roster to one class, keeping the keyterm list small. */
export interface RosterFilter {
  grade?: string | null;
  classGroup?: string | null;
}

export interface StatusEventInput {
  studentId: string;
  changedTo: StudentStatus;
  source: StatusEventSource;
  /** The resolver's score, or null for a hand-picked student. */
  matchConfidence: number | null;
  /** What Deepgram heard. Never the audio itself. */
  rawTranscript: string | null;
}

export interface RosterStore {
  list(filter: RosterFilter): Promise<StudentRow[]>;
  get(id: string): Promise<StudentRow | null>;
  /**
   * Move a student to `status` only if they are not already there, and return
   * the updated row -- or null when nothing changed.
   *
   * The conditional part is the point: two announcers confirming the same child
   * at the same moment both reach this, and the database decides which one wins.
   * The loser gets null, logs no duplicate event, and triggers no second flash
   * on the display.
   */
  setStatus(id: string, status: StudentStatus): Promise<StudentRow | null>;
  /** Resolves false when the audit row could not be written. Never throws. */
  logEvent(event: StatusEventInput): Promise<boolean>;
}
