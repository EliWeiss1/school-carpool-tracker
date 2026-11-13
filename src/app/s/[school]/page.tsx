import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BrandBar } from "@/components/auth/brand-bar";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LaneCard } from "@/components/school/lane-card";
import { getOfficeContext } from "@/lib/supabase/office";

export const metadata: Metadata = { title: "Your school | CarpoolCaller" };

export default async function SchoolHubPage({
  params,
}: {
  params: { school: string };
}) {
  const { supabase, user } = await getOfficeContext();
  const here = `/s/${params.school}`;
  if (!user) redirect(`/login?next=${encodeURIComponent(here)}`);

  // RLS only returns schools this account belongs to, so someone else's school
  // and a made-up address are indistinguishable: both are a 404.
  const { data: school } = await supabase
    .from("schools")
    .select("id, name, slug")
    .eq("slug", params.school)
    .maybeSingle();
  if (!school) notFound();

  const base = `/s/${school.slug}`;

  return (
    <main className="flex min-h-screen flex-col bg-curb-50">
      <BrandBar action={<SignOutButton />} />

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-12">
        <h1 className="font-display text-3xl font-extrabold tracking-display text-curb-900">
          {school.name}
        </h1>
        <p className="mt-2 text-lg text-curb-600">
          Pick the screen for where you are standing.
        </p>

        <ul className="mt-8 flex flex-col gap-4">
          <li>
            <LaneCard
              href={`${base}/announce`}
              lane="01"
              title="Announce"
              who="Outside, at the curb"
              blurb="Say or type a last name, then tap to confirm the child."
            />
          </li>
          <li>
            <LaneCard
              href={`${base}/display`}
              lane="02"
              title="Display"
              who="Inside, on the big screen"
              blurb="Who is still waiting, and who has been called."
            />
          </li>
          <li>
            <LaneCard
              href={`${base}/admin`}
              lane="03"
              title="Office"
              who="In the office"
              blurb="Manage the roster, devices and codes, and reset the board."
            />
          </li>
        </ul>
      </div>
    </main>
  );
}
