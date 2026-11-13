import Link from "next/link";
import type { ReactNode } from "react";

import { HazardRule } from "@/components/ui/hazard-rule";

/**
 * The ink bar every office-account page opens with: the wordmark (a link home)
 * and room for one control on the right, with the app's single hazard rule
 * underneath. `PageHeader` is for the kerb screens and points its back arrow at
 * `/screens`; these pages belong to a signed-out visitor or an office user, so
 * the wordmark goes to the landing page instead.
 */
export function BrandBar({ action }: { action?: ReactNode }) {
  return (
    <header>
      <div className="flex items-center justify-between gap-4 bg-curb-900 px-4 py-1 text-white sm:px-6">
        <Link
          href="/"
          className="focus-ring flex min-h-tap items-center rounded-lg font-display text-xl font-extrabold text-white transition-opacity duration-150 hover:opacity-80 active:opacity-60"
        >
          CarpoolCaller
        </Link>
        {action}
      </div>
      <HazardRule />
    </header>
  );
}
