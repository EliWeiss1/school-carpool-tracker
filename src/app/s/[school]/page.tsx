import type { Metadata } from "next";

import { SchoolGate } from "@/components/school/school-gate";
import { SchoolHub } from "@/components/school/school-hub";

import { findOfficeSchool } from "./office-school";

export const metadata: Metadata = {
  title: "CarpoolCaller",
  robots: { index: false },
};

/**
 * A school's home. The office sees all three lanes; a paired phone or board
 * sees what its code opened; anyone else gets the code prompt, which does not
 * say whether the school exists.
 */
export default async function SchoolHubPage({
  params,
}: {
  params: { school: string };
}) {
  const office = await findOfficeSchool(params.school);
  return (
    <SchoolGate slug={params.school} need="hub" office={office}>
      <SchoolHub />
    </SchoolGate>
  );
}
