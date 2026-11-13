import type { ReactNode } from "react";

import { BrandBar } from "@/components/auth/brand-bar";

/**
 * The frame for sign-up, sign-in, forgot-password, reset-password and welcome:
 * base ground, the brand bar, then one floating card holding the form. Sharing
 * it is what makes five separately built pages read as one flow.
 */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  /** One short line under the title. Never small print. */
  description?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col bg-curb-50">
      <BrandBar />

      <div className="flex flex-1 items-start justify-center px-4 py-8 sm:py-12">
        <section className="w-full max-w-md rounded-2xl border border-curb-200 bg-white p-6 shadow-float">
          <h1 className="font-display text-2xl font-extrabold tracking-display text-curb-900 sm:text-3xl">
            {title}
          </h1>
          {description && <p className="mt-2 text-curb-600">{description}</p>}
          <div className="mt-6">{children}</div>
        </section>
      </div>
    </main>
  );
}
