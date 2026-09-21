"use client";

/**
 * Launch tile for the lobby Welcome Board. It opens in its own window (named
 * per location, so relaunching reuses the same one) because the team drags
 * that window onto the waiting-room TV.
 */
export function WelcomeBoardTile({
  slug,
  date,
  locationName,
}: {
  slug: string;
  date: string;
  locationName: string;
}) {
  const open = () =>
    window.open(
      `/welcome/${slug}?date=${date}`,
      `gdo-welcome-${slug}`,
      "noopener,noreferrer,width=1600,height=1000",
    );

  return (
    <button
      type="button"
      onClick={open}
      title={`Open the ${locationName} Daily Welcome Board in a new window`}
      className="group flex flex-col justify-between rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-lg text-lg"
          style={{ backgroundColor: "#a7ce7333", color: "#1b4332" }}
          aria-hidden
        >
          👋
        </span>
        <span
          className="text-emerald-400 transition group-hover:translate-x-0.5 group-hover:text-emerald-600"
          aria-hidden
        >
          ↗
        </span>
      </div>
      <div className="mt-3">
        <p className="text-sm font-semibold text-emerald-900">
          Daily Welcome Board
        </p>
        <p className="mt-0.5 text-xs text-emerald-700/80">
          Opens in a new window for the lobby TV
        </p>
      </div>
    </button>
  );
}
