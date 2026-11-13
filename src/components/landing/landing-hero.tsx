import Image from "next/image";
import Link from "next/link";

import { PickupDemo } from "@/components/landing/pickup-demo";
import { ButtonLink } from "@/components/ui";

/**
 * The top of the public page: who this is, what it does, and the product
 * doing it. One ink band holds both the navigation and the hero so the board
 * demo sits on the same ground the real board does.
 */
export function LandingHero() {
  return (
    <div className="grain relative isolate overflow-hidden bg-curb-900 bg-curb-dusk text-white">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4 sm:px-12">
        <Link
          href="/"
          className="focus-ring flex items-center gap-3 rounded-lg transition-opacity hover:opacity-80 active:opacity-60"
        >
          <Image
            src="/icons/icon-192.png"
            alt=""
            width={32}
            height={32}
            className="hidden rounded-lg sm:block"
            priority
          />
          <span className="font-display text-xl font-extrabold">
            CarpoolCaller
          </span>
        </Link>

        <nav aria-label="Account" className="flex items-center gap-2">
          <ButtonLink
            href="/login"
            variant="quiet-ink"
            size="sm"
            className="min-h-12 whitespace-nowrap px-4"
          >
            Sign in
          </ButtonLink>
          {/* Below sm the hero button directly underneath says the same thing,
              and three items do not fit a phone-width bar on one line. */}
          <ButtonLink
            href="/signup"
            size="sm"
            className="hidden min-h-12 px-4 sm:inline-flex"
          >
            Get started
          </ButtonLink>
        </nav>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 pb-16 pt-8 sm:px-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center lg:gap-16 lg:pb-24 lg:pt-12">
        <div>
          <h1 className="max-w-xl font-display text-5xl font-extrabold tracking-display sm:text-6xl">
            The pickup line, called from the curb.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-curb-300">
            A staff member outside says or types a family&rsquo;s name. One tap
            to confirm, and that child lights up on the screen inside with a
            chime. No radios, no shouting down the hall.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <ButtonLink href="/signup" size="tap">
              Get started
            </ButtonLink>
            <p className="text-curb-300">Free during early access.</p>
          </div>
        </div>

        <PickupDemo />
      </div>
    </div>
  );
}
