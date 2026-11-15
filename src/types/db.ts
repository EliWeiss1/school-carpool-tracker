export type StudentStatus = "waiting" | "arrived";
export type StatusEventSource = "voice" | "manual" | "admin";

// Type aliases rather than interfaces on purpose: supabase-js constrains its
// generics to `Record<string, unknown>`, and only type aliases get the implicit
// index signature that satisfies it. As interfaces, every query below silently
// degrades to `never`.

export type Student = {
  id: string;
  /**
   * The owning school. Optional only because the board's mock rosters and the
   * landing demo build Student rows with no school; every real row has one.
   */
  school_id?: string;
  first_name: string;
  last_name: string;
  aliases: string[];
  status: StudentStatus;
  /** Derived by a trigger from the status transition — never set by a caller. */
  arrived_at: string | null;
  updated_at: string;
  /** Nulled, not cascaded, when the carpool is deleted. Never set through roster-write. */
  carpool_id: string | null;
};

export type Carpool = {
  id: string;
  school_id: string;
  name: string;
  aliases: string[];
  created_at: string;
  updated_at: string;
};

/**
 * A student as the app uses them: the DB row plus the names of the classes
 * they belong to, in class order. A student can be in several classes, so the
 * row itself carries none -- `student_classes` holds the links, and
 * `withClassNames` (lib/student-classes.ts) flattens them onto this shape.
 */
export type StudentWithClasses = Student & { class_groups: string[] };

/** A class students can be assigned to. Publicly readable, like students --
 *  see the class_groups migration. Membership lives in `student_classes`. */
export type ClassGroup = {
  id: string;
  school_id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

/** One student-in-one-class link. Deleting either side cascades the link. */
export type StudentClass = {
  student_id: string;
  school_id: string;
  class_group_id: string;
  created_at: string;
};

export type StatusEvent = {
  id: string;
  school_id: string;
  /** Nulled rather than deleted when a student leaves the roster. */
  student_id: string | null;
  changed_to: StudentStatus;
  source: StatusEventSource;
  match_confidence: number | null;
  raw_transcript: string | null;
  created_at: string;
  /** Set when this change came from confirming a whole carpool at once. */
  carpool_id: string | null;
};

export type StudentInsert = Pick<Student, "first_name" | "last_name"> &
  Partial<Omit<Student, "first_name" | "last_name">>;

export type CarpoolInsert = Pick<Carpool, "name"> &
  Partial<Omit<Carpool, "name">>;

export type ClassGroupInsert = Pick<ClassGroup, "name" | "sort_order"> &
  Partial<Omit<ClassGroup, "name" | "sort_order">>;

export type StudentClassInsert = Pick<
  StudentClass,
  "student_id" | "class_group_id"
> &
  Partial<Omit<StudentClass, "student_id" | "class_group_id">>;

export type StatusEventInsert = Pick<StatusEvent, "changed_to" | "source"> &
  Partial<Omit<StatusEvent, "changed_to" | "source">>;

/**
 * A school (tenant). Read-only from the browser: RLS lets a signed-in user
 * select only the schools they belong to, and every write goes through the
 * `school-write` Edge Function.
 */
export type School = {
  id: string;
  name: string;
  /** The web address segment: /s/<slug>. 3 to 48 chars of a-z, 0-9, hyphen. */
  slug: string;
  timezone: string;
  reset_hour: number;
  /** Days of the week the nightly reset runs, 0 = Sunday. */
  reset_days: number[];
  last_reset_on: string | null;
  voice_enabled: boolean;
  voice_monthly_limit: number | null;
  created_at: string;
};

export type SchoolMemberRole = "owner" | "admin";

export type SchoolMember = {
  school_id: string;
  user_id: string;
  role: SchoolMemberRole;
};

/** A paired screen or phone. Code versions let a code change disconnect it. */
export type SchoolDevice = {
  id: string;
  school_id: string;
  user_id: string;
  can_announce: boolean;
  can_display: boolean;
  announce_code_version: number;
  display_code_version: number;
  label: string | null;
  created_at: string;
  last_seen_at: string | null;
};

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
      carpools: {
        Row: Carpool;
        Insert: CarpoolInsert;
        Update: Partial<Carpool>;
        Relationships: [];
      };
      class_groups: {
        Row: ClassGroup;
        Insert: ClassGroupInsert;
        Update: Partial<ClassGroup>;
        Relationships: [];
      };
      student_classes: {
        Row: StudentClass;
        Insert: StudentClassInsert;
        Update: Partial<StudentClass>;
        Relationships: [];
      };
      schools: {
        Row: School;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      school_members: {
        Row: SchoolMember;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      school_devices: {
        Row: SchoolDevice;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
