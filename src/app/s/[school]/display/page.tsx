import type { Metadata } from "next";

import { DisplayBoard } from "@/components/display/display-board";
import { SchoolGate } from "@/components/school/school-gate";

import { findOfficeSchool } from "../office-school";

export const metadata: Metadata = {
  title: "Display | CarpoolCaller",
  robots: { index: false },
};

/**
 * The wall board for one school. Unlike the legacy route there are no
 * `?mock` preview modes here; `?class=` is a real feature and is kept.
 */
export default async function SchoolDisplayPage({
  params,
  searchParams,
}: {
  params: { school: string };
  searchParams: { class?: string };
}) {
  const office = await findOfficeSchool(params.school);
  return (
    <SchoolGate slug={params.school} need="display" office={office}>
      <DisplayBoard initialClassParam={searchParams.class ?? null} />
    </SchoolGate>
  );
}
