import type { ReactNode } from "react";

import { CarpoolDemo } from "@/components/landing/carpool-demo";
import { ButtonLink } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * The landing page below the hero: colour bands, one idea each, a picture of
 * the product and very few words. A school office decides on this page in the
 * time it takes to scroll it, so nothing here is a paragraph.
 *
 * The colours are the product's own, used at full strength: school-bus
 * marigold, the board's waiting blue, and ink. Red and green never appear:
 * those two mean waiting and arrived on the staff screens and nothing else,
 * including on the front door.
 */

function Section({
  labelledBy,
  className,
  children,
}: {
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={cn("mx-auto w-full max-w-6xl px-6 sm:px-12", className)}
    >
      {children}
    </section>
  );
}

/** A 24px line icon. Decorative: always paired with the words it stands for. */
function Icon({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

const micPath = (
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </>
);

/* -------------------------------------------------------------- screens */

/** Announce: the push-to-talk button mid-press, and the name it heard. */
function AnnouncePicture() {
  return (
    <div className="flex items-center gap-4">
      <span className="relative flex h-24 w-24 shrink-0 items-center justify-center">
        <span className="absolute inset-0 animate-listen-pulse rounded-full bg-curb-900" />
        <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-curb-900 text-marigold-400 shadow-float">
          <Icon className="h-12 w-12">{micPath}</Icon>
        </span>
      </span>
      <span className="rounded-2xl bg-white px-6 py-4 font-display text-3xl font-extrabold text-curb-900 shadow-float">
        &ldquo;Cohen&rdquo;
      </span>
    </div>
  );
}

const boardTiles = [
  { name: "Cohen", tone: "called" },
  { name: "Adler", tone: "arrived" },
  { name: "Shapiro", tone: "waiting" },
  { name: "Stern", tone: "waiting" },
  { name: "Rosen", tone: "arrived" },
  { name: "Gold", tone: "waiting" },
] as const;

/** Display: the board in miniature, in the board's own three tile colours. */
function DisplayPicture() {
  return (
    <ul className="grid w-full grid-cols-3 gap-2">
      {boardTiles.map((tile) => (
        <li
          key={tile.name}
          className={cn(
            "flex h-16 items-center justify-center rounded-xl font-display text-lg font-bold",
            tile.tone === "waiting" &&
              "bg-waiting-screen text-white shadow-tile-waiting",
            tile.tone === "arrived" &&
              "bg-arrived-screen text-curb-900 shadow-tile-arrived",
            tile.tone === "called" && "bg-marigold-400 text-curb-900",
          )}
        >
          {tile.name}
        </li>
      ))}
    </ul>
  );
}

const rosterRows = [
  { name: "Maya Cohen", classGroup: "K2" },
  { name: "Noam Shapiro", classGroup: "3rd" },
  { name: "Talia Stern", classGroup: "2nd" },
];

/** Office: three roster rows, the way /admin lists them. */
function OfficePicture() {
  return (
    <ul className="w-full overflow-hidden rounded-2xl bg-white text-curb-900 shadow-float">
      {rosterRows.map((row, index) => (
        <li
          key={row.name}
          className={cn(
            "flex items-center justify-between gap-4 px-4 py-3",
            index > 0 && "border-t border-curb-200",
          )}
        >
          <span className="font-display text-lg font-bold">{row.name}</span>
          <span className="rounded-lg bg-marigold-100 px-2 py-1 font-mono text-base text-curb-800">
            {row.classGroup}
          </span>
        </li>
      ))}
    </ul>
  );
}

const screens = [
  {
    title: "Announce",
    line: "Say or type a name at the curb.",
    picture: <AnnouncePicture />,
    ground: "bg-marigold-500 bg-marigold-noon text-curb-900",
  },
  {
    title: "Display",
    line: "The child lights up inside, with a chime.",
    picture: <DisplayPicture />,
    ground: "bg-curb-900 bg-curb-dusk text-white",
  },
  {
    title: "Office",
    line: "Roster, classes and carpools in one place.",
    picture: <OfficePicture />,
    ground: "bg-waiting-screen bg-board-sky text-white",
  },
];

/**
 * The three screens as three panels, each in its own colour with a picture of
 * the screen itself. Not numbered: they are places, not steps.
 */
export function ScreensSection() {
  return (
    <Section labelledBy="screens-heading" className="py-16 lg:py-24">
      <h2
        id="screens-heading"
        className="max-w-3xl font-display text-5xl font-extrabold tracking-display text-curb-900"
      >
        Three screens, one pickup line.
      </h2>
      <ul className="mt-12 grid gap-4 lg:grid-cols-3">
        {screens.map((screen) => (
          <li
            key={screen.title}
            className={cn(
              "grain relative isolate flex flex-col overflow-hidden rounded-2xl p-6 shadow-float sm:p-8",
              screen.ground,
            )}
          >
            <div
              aria-hidden="true"
              className="flex h-48 items-center justify-center"
            >
              {screen.picture}
            </div>
            <h3 className="mt-6 font-display text-3xl font-extrabold">
              {screen.title}
            </h3>
            <p className="mt-2 text-xl">{screen.line}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* -------------------------------------------------------------- carpool */

/**
 * The carpool band, on ink so the demo's board sits on the ground the real
 * board does. The picture is the argument here: the visitor calls a carpool
 * themselves, so the copy is one headline and one line.
 */
export function CarpoolSection() {
  return (
    <div className="grain relative isolate overflow-hidden bg-curb-900 bg-curb-dusk text-white">
      <Section
        labelledBy="carpool-heading"
        className="grid gap-12 py-16 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-center lg:gap-16 lg:py-24"
      >
        <div>
          <h2
            id="carpool-heading"
            className="font-display text-5xl font-extrabold tracking-display"
          >
            Say one name. Call the whole carpool.
          </h2>
          <p className="mt-6 text-xl text-curb-300">
            Untick anyone staying late, then tap once.
          </p>
          <p className="mt-6 font-display text-xl font-bold text-marigold-400">
            Try it.
          </p>
        </div>
        <CarpoolDemo />
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------- confirm */

const lookalikes = [
  { name: "Maya Cohen", classGroup: "K2" },
  { name: "Asher Kohen", classGroup: "3rd" },
  { name: "Tamar Koen", classGroup: "1st" },
];

/**
 * The trust band, on a pale marigold wash: warm enough to read as the brand,
 * quiet enough to sit between the ink band above it and the blue one below.
 * (It was full marigold once; a whole screen of it was too loud.) The picture
 * is the product's ambiguous
 * case exactly as /announce shows it: three names that sound alike, equal
 * weight, nothing chosen for you.
 */
export function ConfirmSection() {
  return (
    <div className="border-y border-marigold-100 bg-marigold-50 text-curb-900">
      <Section
        labelledBy="confirm-heading"
        className="grid gap-12 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center lg:gap-16 lg:py-24"
      >
        <div>
          <h2
            id="confirm-heading"
            className="max-w-xl font-display text-5xl font-extrabold tracking-display sm:text-6xl"
          >
            A person always taps.
          </h2>
          <p className="mt-6 max-w-md text-xl text-curb-700">
            Names that sound alike are shown side by side. Nothing reaches the
            board by itself.
          </p>
        </div>

        <div>
          <p className="sr-only">
            Example: after hearing &ldquo;Cohen&rdquo;, the phone lists Maya
            Cohen, Asher Kohen and Tamar Koen as three equal choices.
          </p>
          <div
            aria-hidden="true"
            className="rounded-2xl bg-white p-4 shadow-float sm:p-6"
          >
            <p className="flex items-center gap-3 font-display text-3xl font-extrabold text-curb-900">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-curb-900 text-marigold-400">
                <Icon className="h-6 w-6">{micPath}</Icon>
              </span>
              &ldquo;Cohen&rdquo;
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {lookalikes.map((candidate) => (
                <li
                  key={candidate.name}
                  className="flex min-h-tap-lg items-center justify-between gap-4 rounded-xl border border-curb-300 bg-curb-50 px-4 shadow-card"
                >
                  <span className="font-display text-xl font-bold text-curb-900">
                    {candidate.name}
                  </span>
                  <span className="font-mono text-base text-curb-600">
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

const steps: { title: string; hint?: string }[] = [
  { title: "Create your account" },
  { title: "Drop in your spreadsheet", hint: "Any format. We sort it out." },
  { title: "Set a device code" },
  { title: "Open your link" },
];

/** Where a roster can come from. Plain text, not controls, so a plain list. */
const rosterSources = ["Excel", "Google Sheets", "CSV", "Copy & paste"];

/**
 * A real sequence, so it is numbered. Each step sits under a dashed lane
 * marking; together the four dashes read as one painted line across the band.
 */
export function SetupSection() {
  return (
    <div className="grain relative isolate overflow-hidden bg-waiting-screen bg-board-sky text-white">
      <Section labelledBy="setup-heading" className="py-16 lg:py-24">
        <h2
          id="setup-heading"
          className="max-w-3xl font-display text-5xl font-extrabold tracking-display"
        >
          Ready by this afternoon&rsquo;s pickup.
        </h2>
        <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="border-t-4 border-dashed border-white/50 pt-6"
            >
              <p
                aria-hidden="true"
                className="font-display text-6xl font-extrabold tracking-display text-marigold-400"
              >
                {index + 1}
              </p>
              <h3 className="mt-3 font-display text-2xl font-bold">
                {step.title}
              </h3>
              {step.hint ? (
                <p className="mt-2 text-lg text-white/90">{step.hint}</p>
              ) : null}
            </li>
          ))}
        </ol>
        <ul className="mt-12 flex flex-wrap gap-3">
          {rosterSources.map((source) => (
            <li
              key={source}
              className="rounded-xl bg-white px-4 py-2 font-display text-lg font-bold text-curb-900"
            >
              {source}
            </li>
          ))}
          <li className="rounded-xl bg-marigold-400 px-4 py-2 font-display text-lg font-bold text-curb-900">
            Messy is fine
          </li>
        </ul>
      </Section>
    </div>
  );
}

/* --------------------------------------------------------- testimonials */

/**
 * STAND-INS. These three quotes are placeholders written to size the section,
 * not things anyone said. The attribution says "Name to come" so the page
 * cannot be mistaken for carrying real endorsements. Replace all three with
 * real quotes, names and positions before the page is shown to the public.
 */
const testimonials = [
  {
    quote:
      "Teachers hear the chime and send the child out. Nobody watches the door any more.",
    name: "Name to come",
    position: "Front office manager",
    bar: "bg-marigold-500",
  },
  {
    quote: "One name calls the whole carpool. That alone was worth the switch.",
    name: "Name to come",
    position: "Dismissal coordinator",
    bar: "bg-waiting-screen",
  },
  {
    quote: "We set it up at lunch and used it at pickup the same day.",
    name: "Name to come",
    position: "Head of school",
    bar: "bg-curb-900",
  },
];

/** Three voices from the pickup line, each under its own lane colour. */
export function TestimonialsSection() {
  return (
    <Section labelledBy="testimonials-heading" className="py-16 lg:py-24">
      <h2
        id="testimonials-heading"
        className="max-w-3xl font-display text-5xl font-extrabold tracking-display text-curb-900"
      >
        Heard at pickup.
      </h2>
      <ul className="mt-12 grid gap-4 lg:grid-cols-3">
        {testimonials.map((testimonial) => (
          <li
            key={testimonial.quote}
            className="flex flex-col overflow-hidden rounded-2xl border border-curb-200 bg-white shadow-card"
          >
            <span
              aria-hidden="true"
              className={cn("h-3 w-full", testimonial.bar)}
            />
            <figure className="flex flex-1 flex-col p-6 sm:p-8">
              <blockquote className="flex-1 font-display text-2xl font-bold text-curb-900">
                &ldquo;{testimonial.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-8">
                <p className="font-display text-lg font-bold text-curb-900">
                  {testimonial.name}
                </p>
                <p className="text-curb-600">{testimonial.position}</p>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* -------------------------------------------------------------- privacy */

const promises = [
  {
    statement: "Every school's data is separate.",
    badge: "bg-marigold-500 text-curb-900",
    icon: <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />,
  },
  {
    statement: "Voice is never recorded.",
    badge: "bg-waiting-screen text-white",
    icon: (
      <>
        {micPath}
        <path d="M4 3l16 18" />
      </>
    ),
  },
  {
    statement: "You control every device.",
    badge: "bg-curb-900 text-marigold-400",
    icon: (
      <>
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
      </>
    ),
  },
];

export function PrivacySection() {
  return (
    <div className="bg-white">
      <Section labelledBy="privacy-heading" className="py-16 lg:py-24">
        <h2
          id="privacy-heading"
          className="max-w-3xl font-display text-5xl font-extrabold tracking-display text-curb-900"
        >
          Your roster stays yours.
        </h2>
        <ul className="mt-12 grid gap-8 lg:grid-cols-3">
          {promises.map((promise) => (
            <li key={promise.statement} className="flex items-center gap-4">
              <span
                className={cn(
                  "flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl shadow-card",
                  promise.badge,
                )}
              >
                <Icon className="h-8 w-8">{promise.icon}</Icon>
              </span>
              <p className="font-display text-2xl font-bold text-curb-900">
                {promise.statement}
              </p>
            </li>
          ))}
        </ul>
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
          className="max-w-2xl font-display text-5xl font-extrabold tracking-display sm:text-6xl"
        >
          Set up your school before the next pickup.
        </h2>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <ButtonLink href="/signup" size="tap">
            Get started
          </ButtonLink>
          <p className="text-lg text-curb-300">Free during early access.</p>
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
