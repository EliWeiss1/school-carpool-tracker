export type StudentStatus = "waiting" | "arrived";
export type StatusEventSource = "voice" | "manual" | "admin";

// Type aliases rather than interfaces on purpose: supabase-js constrains its
// generics to `Record<string, unknown>`, and only type aliases get the implicit
// index signature that satisfies it. As interfaces, every query below silently
// degrades to `never`.

export type Student = {
  id: string;
  first_name: string;
  last_name: string;
  aliases: string[];
  grade: string | null;
  class_group: string | null;
  status: StudentStatus;
  /** Derived by a trigger from the status transition — never set by a caller. */
  arrived_at: string | null;
  updated_at: string;
};

export type StatusEvent = {
  id: string;
  /** Nulled rather than deleted when a student leaves the roster. */
  student_id: string | null;
  changed_to: StudentStatus;
  source: StatusEventSource;
  match_confidence: number | null;
  raw_transcript: string | null;
  created_at: string;
};

export type StudentInsert = Pick<Student, "first_name" | "last_name"> &
  Partial<Omit<Student, "first_name" | "last_name">>;

export type StatusEventInsert = Pick<StatusEvent, "changed_to" | "source"> &
  Partial<Omit<StatusEvent, "changed_to" | "source">>;

export type Database = {
  public: {
    Tables: {
      students: {
        Row: Student;
        Insert: StudentInsert;
        Update: Partial<Student>;
        Relationships: [];
      };
      status_events: {
        Row: StatusEvent;
        Insert: StatusEventInsert;
        Update: Partial<StatusEvent>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
