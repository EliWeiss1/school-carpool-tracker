import type { ReactNode } from "react";

import { ButtonLink } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * The landing page below the hero. Each section answers one question a school
 * office asks before trying something new, in the order they ask it: what is
 * it, can I trust it with names, how long does it take, and whose data is it.
 *
 * Nothing here moves and nothing is red or green: those two colours mean
 * waiting and arrived everywhere in the app, including on its front door.
 */

function Section({
  id,
  labelledBy,
  className,
  children,
}: {
  id?: string;
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("mx-auto w-full max-w-6xl px-6 sm:px-12", className)}
    >
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------- lanes */

const lanes = [
  {
    lane: "01",
    title: "Announce",
    where: "Outside, at the curb",
    blurb:
      "Hold the button and say a last name, or type a few letters. CarpoolCaller offers the closest matches and waits for your tap.",
  },
  {
    lane: "02",
    title: "Display",
    where: "Inside, on any screen",
    blurb:
      "Every child, waiting or called, grouped by class. A new arrival flashes and chimes, so a teacher hears it without watching the screen.",
  },
  {
    lane: "03",
    title: "Office",
    where: "At the front desk",
    blurb:
      "Add students and classes, import the roster from a spreadsheet, link siblings and carpools. The board resets itself every evening.",
  },
];

/**
 * The three screens, drawn as lanes on one surface with dashed lane markings
 * between them. The numbers are real: the screens are used in this order,
 * outside, then inside, then the office.
 */
export function LanesSection() {
  return (
    <Section labelledBy="lanes-heading" className="py-16 lg:py-24">
      <h2
        id="lanes-heading"
        className="max-w-2xl font-display text-3xl font-bold"
      >
        Three screens, one pickup line
      </h2>
      <ol className="mt-8 grid rounded-2xl border border-curb-200 bg-white shadow-card lg:grid-cols-3">
        {lanes.map((lane, index) => (
          <li
            key={lane.lane}
            className={cn(
              "p-6 sm:p-8",
              index > 0 &&
                "border-t-2 border-dashed border-curb-300 lg:border-l-2 lg:border-t-0",
            )}
          >
            <p aria-hidden="true" className="font-mono text-sm text-curb-400">
              {lane.lane}
            </p>
            <h3 className="mt-3 font-display text-2xl font-bold text-curb-900">
              {lane.title}
            </h3>
            <p className="mt-1 text-sm text-curb-500">{lane.where}</p>
            <p className="mt-4 text-curb-600">{lane.blurb}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* -------------------------------------------------------------- confirm */

const lookalikes = [
  { name: "Maya Cohen", classGroup: "K2" },
  { name: "Elias Kohen", classGroup: "3rd" },
  { name: "Zoe Koen", classGroup: "1st" },
];

const assurances = [
  {
    title: "One tap for a carpool",
    body: "Siblings and ride-shares are linked once in the office, then arrive together.",
  },
  {
    title: "Easy to take back",
    body: "Tapped the wrong child? Tap the name again and it returns to waiting.",
  },
  {
    title: "Works without the microphone",
    body: "Typing a few letters finds the same matches, in a noisy line or a quiet one.",
  },
];

/**
 * The trust section. The picture is the product's ambiguous case exactly as
 * /announce shows it: three names that sound alike, equal weight, nothing
 * chosen for you.
 */
export function ConfirmSection() {
  return (
    <div className="border-y border-curb-200 bg-white">
      <Section
        labelledBy="confirm-heading"
        className="grid gap-12 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-center lg:gap-16 lg:py-24"
      >
        <div>
          <h2
            id="confirm-heading"
            className="max-w-xl font-display text-3xl font-bold"
          >
            It never puts a name on the board by itself
          </h2>
          <p className="mt-4 max-w-xl text-lg text-curb-600">
            Cohen, Kohen and Koen sound the same through a phone in the wind.
            When names are close, you see each one and choose. Nothing reaches
            the board until a person taps.
          </p>
          <dl className="mt-8 grid max-w-xl gap-4">
            {assurances.map((item) => (
              <div key={item.title}>
                <dt className="font-display font-semibold text-curb-900">
                  {item.title}
                </dt>
                <dd className="text-curb-600">{item.body}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <p className="sr-only">
            Example: after hearing &ldquo;Cohen&rdquo;, the phone lists Maya
            Cohen, Elias Kohen and Zoe Koen as three equal choices.
          </p>
          <div
            aria-hidden="true"
            className="rounded-2xl border border-curb-200 bg-curb-50 p-4 shadow-float sm:p-6"
          >
            <p className="text-sm text-curb-500">Heard</p>
            <p className="font-display text-2xl font-bold text-curb-900">
              &ldquo;Cohen&rdquo;
            </p>
            <p className="mt-1 text-sm text-curb-600">
              Three close matches. Tap the right one.
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {lookalikes.map((candidate) => (
                <li
                  key={candidate.name}
                  className="flex min-h-tap-lg items-center justify-between gap-4 rounded-xl border border-curb-300 bg-white px-4 shadow-card"
                >
                  <span className="font-display text-xl font-bold text-curb-900">
                    {candidate.name}
                  </span>
                  <span className="font-mono text-sm text-curb-500">
                    {candidate.classGroup}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- setup */

const steps = [
  {
    title: "Create your school's account",
    body: "An email address and a password. It takes about a minute.",
  },
  {
    title: "Add classes and the roster",
    body: "Type students in, or import the spreadsheet you already keep.",
  },
  {
    title: "Set a code for your devices",
    body: "One short code for the curb phones, and one for the screens if you want them separate.",
  },
  {
    title: "Open your school's link",
    body: "On a phone outside and a screen inside. Type the code once and each stays connected.",
  },
];

/** A real sequence, so it is a numbered list, each step under a painted line. */
export function SetupSection() {
  return (
    <Section labelledBy="setup-heading" className="py-16 lg:py-24">
      <h2
        id="setup-heading"
        className="max-w-2xl font-display text-3xl font-bold"
      >
        Ready by this afternoon&rsquo;s pickup
      </h2>
      <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.title} className="border-t-4 border-curb-900 pt-4">
            <p
              aria-hidden="true"
              className="font-display text-3xl font-extrabold text-marigold-600"
            >
              {index + 1}
            </p>
            <h3 className="mt-2 font-display text-xl font-bold text-curb-900">
              {step.title}
            </h3>
            <p className="mt-2 text-curb-600">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* -------------------------------------------------------------- privacy */

const promises = [
  {
    title: "Each school is separate",
    body: "Your students, classes, carpools and history are yours. No other school can see them.",
  },
  {
    title: "Voice is not kept",
    body: "What is said at the curb is turned into text to find the name, then discarded. Recordings are never stored.",
  },
  {
    title: "You control the devices",
    body: "Phones and screens join with a code you set. The office can disconnect any one of them, or change the code.",
  },
];

export function PrivacySection() {
  return (
    <div className="border-t border-curb-200 bg-white">
      <Section labelledBy="privacy-heading" className="py-16 lg:py-24">
        <h2
          id="privacy-heading"
          className="max-w-2xl font-display text-3xl font-bold"
        >
          Your roster stays your school&rsquo;s
        </h2>
        <dl className="mt-8 grid gap-8 lg:grid-cols-3">
          {promises.map((promise) => (
            <div key={promise.title}>
              <dt className="font-display text-xl font-bold text-curb-900">
                {promise.title}
              </dt>
              <dd className="mt-2 max-w-md text-curb-600">{promise.body}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------- closing */

/** The second ink band: the same offer as the hero, then the footer. */
export function ClosingBand() {
  return (
    <div className="grain relative isolate overflow-hidden bg-curb-900 bg-curb-dusk text-white">
      <Section labelledBy="closing-heading" className="py-16 lg:py-24">
        <h2
          id="closing-heading"
          className="max-w-2xl font-display text-5xl font-extrabold tracking-display"
        >
          Set up your school before the next pickup.
        </h2>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <ButtonLink href="/signup" size="tap">
            Get started
          </ButtonLink>
          <p className="text-curb-300">Free during early access.</p>
        </div>
      </Section>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6 sm:px-12">
          <p className="font-display font-bold">CarpoolCaller</p>
          <ButtonLink
            href="/login"
            variant="quiet-ink"
            size="sm"
            className="min-h-12 px-4"
          >
            Sign in
          </ButtonLink>
        </div>
      </footer>
    </div>
  );
}
