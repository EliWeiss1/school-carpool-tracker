/**
 * Shown on `/display` when a viewer picks a class that has nobody in it.
 * Without it that choice is a blank ink screen, indistinguishable from a
 * broken board. Sized for a wall, not a laptop: a teacher glancing up from
 * across the room should read which class is empty and that nothing is wrong.
 *
 * Sits on the board's ink ground, so it uses the dashed outline and white
 * type the rest of `/display` uses -- the light `EmptyState` card is for the
 * light-surface screens.
 */
export function EmptyClassState({ classLabel }: { classLabel: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
      <div
        role="status"
        className="flex w-full max-w-5xl flex-col items-center gap-4 rounded-2xl border border-dashed border-white/20 px-6 py-16 text-center sm:py-24"
      >
        <h2 className="font-display text-3xl font-bold text-white sm:text-5xl sm:tracking-display">
          No students in {classLabel} yet
        </h2>
        <p className="max-w-2xl text-lg text-white/70 sm:text-xl">
          Ask the office to add students to this class.
        </p>
      </div>
    </div>
  );
}
