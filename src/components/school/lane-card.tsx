import Link from "next/link";

/**
 * One lane on the school hub: the same card as the legacy screen picker, so the
 * hub reads as the same place. The lane number is not decoration; the three
 * screens really are used in order, kerb then display then office.
 */
export function LaneCard({
  href,
  lane,
  title,
  who,
  blurb,
}: {
  href: string;
  lane: string;
  title: string;
  who: string;
  blurb: string;
}) {
  return (
    <Link
      href={href}
      className="focus-ring group flex items-start gap-6 rounded-2xl border border-curb-200 bg-white p-6 shadow-card transition-[transform,box-shadow,border-color] duration-200 ease-spring hover:-translate-y-0.5 hover:border-curb-300 hover:shadow-float active:translate-y-0 active:shadow-press"
    >
      <span
        aria-hidden="true"
        className="mt-1 font-mono text-sm text-curb-400 transition-colors duration-200 group-hover:text-marigold-600"
      >
        {lane}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-display text-2xl font-bold tracking-display text-curb-900">
            {title}
          </span>
          <span className="text-sm text-curb-500">{who}</span>
        </span>
        <span className="mt-1 block text-curb-600">{blurb}</span>
      </span>
    </Link>
  );
}
