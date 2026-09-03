import Link from "next/link";

import { HazardRule } from "@/components/ui";

/**
 * The one screen nobody is meant to linger on. Its whole job is to get a person
 * to the right one of the three, so it is a lane picker: three positions, named
 * by where you are standing rather than by what the software does.
 */
const destinations = [
  {
    href: "/announce",
    lane: "01",
    title: "Announce",
    who: "Outside, at the kerb",
    blurb: "Say or type a last name, then tap to confirm the child.",
  },
  {
    href: "/display",
    lane: "02",
    title: "Display",
    who: "Inside, on the big screen",
    blurb: "Who is still waiting, and who has been called.",
  },
  {
    href: "/admin",
    lane: "03",
    title: "Admin",
    who: "In the office",
    blurb: "Manage the roster, import a CSV, reset the board for a new day.",
  },
];

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      <div className="bg-curb-900 pb-12 pt-16 text-white">
        {/* Padding lives inside the max-width box, so the title and the cards
            below share one left edge at every breakpoint. */}
        <div className="mx-auto max-w-3xl px-6 sm:px-12">
          <p className="font-mono text-xs uppercase tracking-eyebrow text-marigold-400">
            Pickup line
          </p>
          <h1 className="mt-3 font-display text-5xl font-extrabold tracking-display sm:text-6xl">
            Carpool
            <br />
            Pickup Board
          </h1>
          <p className="mt-4 max-w-md text-lg text-curb-300">
            Pick the screen for where you are standing.
          </p>
        </div>
      </div>
      <HazardRule />

      <nav className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 sm:px-12">
        <ul className="flex flex-col gap-4">
          {destinations.map((destination) => (
            <li key={destination.href}>
              <Link
                href={destination.href}
                // The lane number is the only decoration on the page, and it is
                // not decoration: these three screens really are used in order,
                // outside then inside then office.
                className="focus-ring group flex items-start gap-5 rounded-2xl border border-curb-200 bg-white p-6 shadow-card transition-[transform,box-shadow,border-color] duration-200 ease-spring hover:-translate-y-0.5 hover:border-curb-300 hover:shadow-float active:translate-y-0 active:shadow-press"
              >
                <span
                  aria-hidden="true"
                  className="mt-1 font-mono text-sm text-curb-400 transition-colors duration-200 group-hover:text-marigold-600"
                >
                  {destination.lane}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-display text-2xl font-bold tracking-display text-curb-900">
                      {destination.title}
                    </span>
                    <span className="text-sm text-curb-500">
                      {destination.who}
                    </span>
                  </span>
                  <span className="mt-1 block text-curb-600">
                    {destination.blurb}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
