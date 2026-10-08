const URL_RE = /(https?:\/\/[^\s]+[^\s.,;:!?)\]'"])/g;

/** Intro text with its web addresses as links. */
function Linkified({ text }: { text: string }) {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all font-medium text-emerald-700 underline hover:text-emerald-900"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

/** The page frame for candidate-facing recruiting pages (no app chrome). */
export function PublicShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string | null;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50 to-white px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-sm font-bold uppercase tracking-wider text-emerald-700">Green Dog</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{title}</h1>
        {intro && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
            <Linkified text={intro} />
          </p>
        )}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}

export function PublicNotice({ icon, title, body }: { icon: string; title: string; body?: string | null }) {
  return (
    <div className="py-6 text-center">
      <div className="text-4xl">{icon}</div>
      <p className="mt-3 text-lg font-semibold text-slate-900">{title}</p>
      {body && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{body}</p>}
    </div>
  );
}
