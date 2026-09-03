import Link from "next/link";

const destinations = [
  {
    href: "/announce",
    title: "Announce",
    who: "Outside, on a phone or tablet",
    blurb: "Speak or search a last name, then confirm the match.",
  },
  {
    href: "/display",
    title: "Display",
    who: "Inside, on the big screen",
    blurb: "Live board of who is still waiting and who has arrived.",
  },
  {
    href: "/admin",
    title: "Admin",
    who: "Office staff",
    blurb: "Manage the roster, import a CSV, reset the board for a new day.",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          Carpool Pickup Board
        </h1>
        <p className="mt-2 text-slate-600">
          Pick the screen for where you are.
        </p>
      </header>

      <nav className="grid gap-4">
        {destinations.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            className="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-slate-400 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            <span className="text-xl font-semibold">{d.title}</span>
            <span className="ml-2 text-sm text-slate-500">{d.who}</span>
            <p className="mt-1 text-slate-600">{d.blurb}</p>
          </Link>
        ))}
      </nav>
    </main>
  );
}
