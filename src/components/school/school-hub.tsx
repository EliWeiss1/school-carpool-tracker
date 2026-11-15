"use client";

import { AuthLink } from "@/components/auth/auth-link";
import { BrandBar } from "@/components/auth/brand-bar";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { InstallCard } from "@/components/home/install-card";
import { LaneCard } from "@/components/school/lane-card";
import { useSchoolAccess } from "@/components/school/school-gate";
import { officeLoginHref } from "@/lib/school-access";

/**
 * The school's home, under a `SchoolGate`: an office login sees all three
 * lanes; a paired device sees only the lanes its code opened, with a quiet way
 * to the office sign-in. The school's name is shown here and only here, after
 * access is established.
 */
export function SchoolHub() {
  const { kind, canAnnounce, canDisplay, school } = useSchoolAccess();
  const base = `/s/${school.slug}`;
  const isOffice = kind === "office";

  return (
    <main className="flex min-h-screen flex-col bg-curb-50">
      <BrandBar action={isOffice ? <SignOutButton /> : undefined} />

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-12">
        <h1 className="font-display text-3xl font-extrabold tracking-display text-curb-900">
          {school.name}
        </h1>
        <p className="mt-2 text-lg text-curb-600">
          Pick the screen for where you are standing.
        </p>

        <ul className="mt-8 flex flex-col gap-4">
          {canAnnounce && (
            <li>
              <LaneCard
                href={`${base}/announce`}
                lane="01"
                title="Announce"
                who="Outside, at the curb"
                blurb="Say or type a last name, then tap to confirm the child."
              />
            </li>
          )}
          {canDisplay && (
            <li>
              <LaneCard
                href={`${base}/display`}
                lane="02"
                title="Display"
                who="Inside, on the big screen"
                blurb="Who is still waiting, and who has been called."
              />
            </li>
          )}
          {isOffice && (
            <li>
              <LaneCard
                href={`${base}/admin`}
                lane="03"
                title="Office"
                who="In the office"
                blurb="Manage the roster, devices and codes, and reset the board."
              />
            </li>
          )}
        </ul>

        {!isOffice && (
          <p className="mt-8">
            <AuthLink href={officeLoginHref(`${base}/admin`)}>
              Office sign in
            </AuthLink>
          </p>
        )}
      </div>

      <InstallCard />
    </main>
  );
}
