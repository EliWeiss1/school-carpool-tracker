import type { Metadata } from "next";

import { AnnounceScreen } from "@/components/announce/announce-screen";
import { SchoolGate } from "@/components/school/school-gate";

import { findOfficeSchool } from "../office-school";

export const metadata: Metadata = {
  title: "Announce | CarpoolCaller",
  robots: { index: false },
};

/** Lane 01 for one school: an office login, or a device with the announce code. */
export default async function SchoolAnnouncePage({
  params,
}: {
  params: { school: string };
}) {
  const office = await findOfficeSchool(params.school);
  return (
    <SchoolGate slug={params.school} need="announce" office={office}>
      <AnnounceScreen />
    </SchoolGate>
  );
}
