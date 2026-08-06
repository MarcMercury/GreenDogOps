import {
  BOARD_COLUMNS,
  fasTone,
  statusTone,
  type BoardTypeDef,
  type MedicalBoardRow,
} from "@/lib/med-ops/types";
import {
  BOARD_TEMPLATES,
  hydrateCard,
  type CardDoc,
  type CardTemplate,
} from "@/lib/med-ops/templates";

/** A past board, rendered read-only exactly as it stood at the end of the day. */
export function ArchivedBoard({
  rows,
  board,
  locationName,
  date,
  status,
}: {
  rows: MedicalBoardRow[];
  board: BoardTypeDef;
  locationName: string;
  date: string;
  status: "open" | "archived" | null;
}) {
  const template = BOARD_TEMPLATES[board.key];
  const pretty = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">
          {locationName} · {board.label}
        </h2>
        <span className="text-sm text-slate-500">{pretty}</span>
        <span
          className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-medium ${
            status === "archived"
              ? "bg-slate-100 text-slate-600"
              : status === "open"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-slate-500"
          }`}
        >
          {status === "archived"
            ? "Archived — read only"
            : status === "open"
              ? "Still open"
              : "No board"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-10 text-center">
          <p className="text-sm text-slate-600">
            No patients were on this board.
          </p>
        </div>
      ) : template.layout === "card" && template.card ? (
        <div className="grid gap-3 2xl:grid-cols-2">
          {rows.map((row) => (
            <ArchivedCard key={row.id} row={row} tpl={template.card!} />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full border-collapse text-xs">
            <thead className="bg-slate-50">
              <tr>
                {BOARD_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`${col.width} whitespace-nowrap border-b border-slate-200 px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  {BOARD_COLUMNS.map((col) => {
                    const value = row[col.key] as string | boolean | null;
                    if (col.kind === "check") {
                      return (
                        <td key={col.key} className="px-2 py-1.5 text-center">
                          {value ? "✓" : ""}
                        </td>
                      );
                    }
                    const tone =
                      col.key === "fas_score"
                        ? fasTone(value as string | null)
                        : col.key === "status"
                          ? statusTone(value as string | null)
                          : "";
                    return (
                      <td key={col.key} className="px-2 py-1.5">
                        <span className={`rounded px-1 ${tone}`}>
                          {(value as string | null) ?? ""}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ArchivedCard({ row, tpl }: { row: MedicalBoardRow; tpl: CardTemplate }) {
  const card = hydrateCard(row.card as CardDoc | null, tpl);
  const meds = (card.meds ?? []).filter((m) => m.drug || m.dose || m.dose2);
  const list = (card.list ?? []).filter((l) => l.text);

  return (
    <article className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2">
        <span className="text-sm font-semibold text-slate-900">
          {card.signalment || row.patient || "Patient"}
        </span>
        {row.appt_time ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
            {row.appt_time}
          </span>
        ) : null}
        {card.status ? (
          <span className={`ml-auto rounded px-2 py-0.5 text-[11px] font-medium ${statusTone(card.status)}`}>
            {card.status}
          </span>
        ) : null}
      </header>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4">
        <Fact label="WT (kg)" value={card.weight_kg} />
        <Fact label="IVC" value={card.ivc} />
        <Fact label="BW" value={card.bw_type} />
        <Fact label="BW results" value={card.bw_results} />
      </dl>

      {card.alerts ? (
        <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          {card.alerts}
        </p>
      ) : null}

      {list.length > 0 ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {tpl.listLabel}
          </p>
          <ol className="ml-4 list-decimal text-[11px] text-slate-700">
            {list.map((l, i) => (
              <li key={i}>
                {l.text}
                {tpl.listHasCheck && l.done ? " ✓" : ""}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {meds.length > 0 ? (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-slate-500">
              <th className="px-1 py-0.5 text-left">Drug</th>
              <th className="w-16 px-1 py-0.5 text-left">Dose</th>
              <th className="w-12 px-1 py-0.5">Given</th>
              <th className="w-16 px-1 py-0.5 text-left">Titrated</th>
              <th className="w-12 px-1 py-0.5 text-left">Route</th>
            </tr>
          </thead>
          <tbody>
            {meds.map((m, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-1 py-0.5">{m.drug}</td>
                <td className="px-1 py-0.5">{m.dose}</td>
                <td className="px-1 py-0.5 text-center">{m.given ? "✓" : ""}</td>
                <td className="px-1 py-0.5">{m.dose2}</td>
                <td className="px-1 py-0.5">{m.route2}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className="flex flex-wrap gap-2 text-[11px] text-slate-600">
        {tpl.statusFields.map((f) =>
          card.fields?.[f.key] ? (
            <span key={f.key} className="rounded bg-slate-100 px-1.5 py-0.5">
              {f.label}: {card.fields[f.key]}
            </span>
          ) : null,
        )}
        {tpl.checklist.map((c) =>
          card.checklist?.[c.key] ? (
            <span key={c.key} className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
              ✓ {c.label}
              {card.checklist_text?.[c.key] ? ` ${card.checklist_text[c.key]}` : ""}
            </span>
          ) : null,
        )}
      </div>

      {tpl.notes.map((n) =>
        card.notes?.[n.key] ? (
          <p key={n.key} className="text-[11px] text-slate-700">
            <span className="font-semibold">{n.label}: </span>
            {card.notes[n.key]}
          </p>
        ) : null,
      )}
    </article>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}
