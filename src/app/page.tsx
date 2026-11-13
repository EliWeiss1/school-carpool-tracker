import type { Metadata } from "next";

import { LandingHero } from "@/components/landing/landing-hero";
import {
  ClosingBand,
  ConfirmSection,
  LanesSection,
  PrivacySection,
  SetupSection,
} from "@/components/landing/landing-sections";
import { HazardRule } from "@/components/ui";

export const metadata: Metadata = {
  title: "CarpoolCaller: the school pickup line, called from the curb",
  description:
    "Staff say or type a family's name at the curb, tap to confirm, and that child lights up on the screen inside. Set up your school in an afternoon.",
};

/**
 * The public front door, for a school that does not use CarpoolCaller yet.
 * Staff who already do never need it: an installed app opens at /app, and the
 * screen picker that used to live here is at /screens.
 *
 * A Server Component with no data: the only client code on the page is the
 * hero's demo loop.
 */
export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <LandingHero />
      {/* The one hazard rule, in its usual place: directly under the header. */}
      <HazardRule />
      <LanesSection />
      <ConfirmSection />
      <SetupSection />
      <PrivacySection />
      <ClosingBand />
    </main>
  );
}
