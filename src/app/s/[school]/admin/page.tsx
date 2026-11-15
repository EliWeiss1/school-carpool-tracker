import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminContent } from "@/components/admin/admin-dashboard";
import { SchoolGate } from "@/components/school/school-gate";
import { officeLoginHref } from "@/lib/school-access";

import { findOfficeSchool } from "../office-school";

export const metadata: Metadata = {
  title: "Office | CarpoolCaller",
  robots: { index: false },
};

/** Office only: no code opens this, so anyone else is sent to sign in. */
export default async function SchoolAdminPage({
  params,
}: {
  params: { school: string };
}) {
  const office = await findOfficeSchool(params.school);
  if (!office) redirect(officeLoginHref(`/s/${params.school}/admin`));
  return (
    <SchoolGate slug={params.school} need="office" office={office}>
      <AdminContent />
    </SchoolGate>
  );
}
