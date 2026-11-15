/**
 * The "Getting started" checklist for a new school. Derived from live counts,
 * never stored, so it cannot disagree with what the office has actually done.
 * It is an ordered list: each step is worth doing after the one above.
 */

export interface ChecklistInput {
  classes: number;
  students: number;
  announceCodeSet: boolean;
  displayCodeSet: boolean;
  devices: number;
}

export interface ChecklistItem {
  id: "classes" | "students" | "code" | "device";
  title: string;
  /** What to do next, in one short sentence. */
  hint: string;
  done: boolean;
}

export function deriveChecklist(input: ChecklistInput): ChecklistItem[] {
  return [
    {
      id: "classes",
      title: "Add your classes",
      hint: "Use Classes below to add each class, such as K1 or 3rd.",
      done: input.classes > 0,
    },
    {
      id: "students",
      title: "Add or import your students",
      hint: "Add them one at a time, or import a CSV file.",
      done: input.students > 0,
    },
    {
      id: "code",
      title: "Set a code for your devices",
      hint: "Choose a code for curb phones and one for screens under Devices.",
      done: input.announceCodeSet || input.displayCodeSet,
    },
    {
      id: "device",
      title: "Connect a phone or a screen",
      hint: "Open your school's link on the device and enter the code.",
      done: input.devices > 0,
    },
  ];
}

export function checklistComplete(items: readonly ChecklistItem[]): boolean {
  return items.every((item) => item.done);
}
