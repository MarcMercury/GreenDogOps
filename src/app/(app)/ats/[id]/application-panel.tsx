"use client";

import {
  APPLICATION_LISTS,
  APPLICATION_SECTIONS,
  FLUENCY_OPTIONS,
  LANGUAGE_OPTIONS,
  LANGUAGES_LABEL,
  LANGUAGES_MAX,
  SKILL_GRIDS,
  SKILL_LEVELS,
  answerText,
  appInputName,
  appLanguageInputName,
  appListInputName,
  appOtherInputName,
  appSkillInputName,
  applicationHasData,
  hasAnswer,
  rolesMatch,
  type AppAnswer,
  type AppField,
  type AppListDef,
  type AppSection,
  type AppTab,
  type ApplicationDetails,
  type RoleGroup,
  type SkillGrid,
} from "@/lib/ats/application";

const INPUT =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const LABEL = "text-xs font-medium text-slate-500";

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return d;
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function Card({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Chips({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <span
          key={v}
          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
        >
          {v}
        </span>
      ))}
    </div>
  );
}

function YesNoBadge({ value, good }: { value: string; good?: "Yes" | "No" }) {
  const known = value === "Yes" || value === "No";
  const tone = !known || !good
    ? "bg-slate-100 text-slate-700"
    : value === good
      ? "bg-emerald-100 text-emerald-800"
      : "bg-rose-100 text-rose-700";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{value}</span>
  );
}

const SKILL_TONE: Record<string, string> = {
  None: "bg-slate-100 text-slate-500",
  Learning: "bg-amber-100 text-amber-800",
  Competent: "bg-emerald-100 text-emerald-800",
  "Can Train Others": "bg-violet-100 text-violet-800",
};

// ---------------------------------------------------------------------------
// Read-only rendering
// ---------------------------------------------------------------------------

function AnswerValue({ field, value }: { field: AppField; value: AppAnswer }) {
  if (Array.isArray(value)) return <Chips values={value} />;
  switch (field.type) {
    case "yesno":
      return <YesNoBadge value={value} good={field.good} />;
    case "ack":
      return (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
          ✓ Agreed
        </span>
      );
    case "date":
      return <span>{fmtDate(value)}</span>;
    case "url": {
      const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-emerald-700 hover:text-emerald-900"
        >
          {value}
        </a>
      );
    }
    case "longtext":
      return <p className="whitespace-pre-wrap">{value}</p>;
    default:
      return <span>{value}</span>;
  }
}

/** Question-style sections (eligibility, acknowledgements) read best as rows. */
const ROW_SECTIONS = new Set(["eligibility", "acknowledgements"]);

function ReadSection({ section, answers }: { section: AppSection; answers: Record<string, AppAnswer> }) {
  const fields = section.fields.filter((f) => hasAnswer(answers[f.key]));
  if (fields.length === 0) return null;

  if (ROW_SECTIONS.has(section.key)) {
    return (
      <Card title={section.title}>
        <dl className="divide-y divide-slate-100">
          {fields.map((f) => (
            <div key={f.key} className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
              <dt className="text-sm text-slate-600">{f.label}</dt>
              <dd className="shrink-0 text-sm text-slate-900">
                <AnswerValue field={f} value={answers[f.key]} />
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    );
  }

  const short = fields.filter((f) => f.type !== "longtext");
  const long = fields.filter((f) => f.type === "longtext");
  return (
    <Card title={section.title}>
      {short.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {short.map((f) => (
            <div key={f.key}>
              <dt className={LABEL}>{f.label}</dt>
              <dd className="mt-1 text-sm text-slate-900">
                <AnswerValue field={f} value={answers[f.key]} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {long.length > 0 && (
        <dl className={`space-y-4 ${short.length > 0 ? "mt-5 border-t border-slate-100 pt-4" : ""}`}>
          {long.map((f) => (
            <div key={f.key}>
              <dt className="text-sm font-medium text-slate-700">{f.label}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-slate-900">
                <AnswerValue field={f} value={answers[f.key]} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function ReadEmployment({ entries }: { entries: Record<string, string>[] }) {
  return (
    <Card title="Employment history">
      <ol className="space-y-3">
        {entries.map((e, i) => (
          <li key={i} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">
                {[e.title, e.employer].filter(Boolean).join(" — ") || "—"}
              </p>
              <p className="text-xs tabular-nums text-slate-500">
                {[e.start, e.end].filter(Boolean).join(" – ")}
              </p>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
              {e.city && <span>📍 {e.city}</span>}
              {e.may_contact && (
                <span className="flex items-center gap-1">
                  May contact: <YesNoBadge value={e.may_contact} good="Yes" />
                </span>
              )}
              {e.reason && <span>Left: {e.reason}</span>}
            </div>
            {e.duties && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{e.duties}</p>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function ReadReferences({ entries }: { entries: Record<string, string>[] }) {
  return (
    <Card title="References">
      <ul className="divide-y divide-slate-100">
        {entries.map((r, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm first:pt-0 last:pb-0">
            <span className="font-medium text-slate-900">{r.name || "—"}</span>
            {r.relationship && <span className="text-xs text-slate-500">{r.relationship}</span>}
            {r.company && <span className="text-slate-600">{r.company}</span>}
            <span className="ml-auto flex flex-wrap gap-x-3 text-slate-700">
              {r.phone && <a href={`tel:${r.phone}`} className="hover:text-emerald-700">{r.phone}</a>}
              {r.email && (
                <a href={`mailto:${r.email}`} className="hover:text-emerald-700">{r.email}</a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReadSkills({ grid, skills }: { grid: SkillGrid; skills: Record<string, string> }) {
  const rated = grid.skills.filter((s) => skills[s.key]);
  if (rated.length === 0) return null;
  return (
    <Card title={grid.title}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {rated.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-sm text-slate-700">{s.label}</dt>
            <dd
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                SKILL_TONE[skills[s.key]] ?? "bg-slate-100 text-slate-700"
              }`}
            >
              {skills[s.key]}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Edit inputs
// ---------------------------------------------------------------------------

function EditField({ field, value }: { field: AppField; value: AppAnswer | undefined }) {
  const name = appInputName(field.key);
  const current = answerText(value);
  const wide = field.type === "longtext" || field.type === "multi";
  const span = wide ? "sm:col-span-2 lg:col-span-3" : "";

  if (field.type === "ack") {
    return (
      <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2 lg:col-span-3">
        <input
          type="checkbox"
          name={name}
          defaultChecked={hasAnswer(value)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        {field.label}
      </label>
    );
  }

  if (field.type === "multi") {
    const selected = Array.isArray(value) ? value : value ? [value] : [];
    const options = field.options ?? [];
    const others = selected.filter((v) => !options.includes(v));
    return (
      <fieldset className={`flex flex-col gap-1.5 ${span}`}>
        <legend className={`${LABEL} mb-1.5`}>{field.label}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                name={name}
                value={o}
                defaultChecked={selected.includes(o)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              {o}
            </label>
          ))}
        </div>
        <input
          name={appOtherInputName(field.key)}
          defaultValue={others.join(", ")}
          placeholder="Other (comma-separated)"
          className={`${INPUT} mt-1 max-w-md`}
        />
      </fieldset>
    );
  }

  let control: React.ReactNode;
  if (field.type === "longtext") {
    control = <textarea name={name} rows={3} defaultValue={current} className={INPUT} />;
  } else if (field.type === "select" || field.type === "yesno") {
    const options = field.type === "yesno" ? ["Yes", "No"] : (field.options ?? []);
    control = (
      <select name={name} defaultValue={current} className={INPUT}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {current && !options.includes(current) && <option value={current}>{current}</option>}
      </select>
    );
  } else {
    const type =
      field.type === "date"
        ? current && !/^\d{4}-\d{2}-\d{2}$/.test(current)
          ? "text"
          : "date"
        : field.type === "number"
          ? "number"
          : field.type === "url"
            ? "url"
            : "text";
    control = <input name={name} type={type} defaultValue={current} className={INPUT} />;
  }
  return (
    <label className={`flex flex-col gap-1 ${span}`}>
      <span className={LABEL}>{field.label}</span>
      {control}
    </label>
  );
}

function EditSection({
  section,
  answers,
  groups,
}: {
  section: AppSection;
  answers: Record<string, AppAnswer>;
  groups: Set<RoleGroup>;
}) {
  const fields = section.fields.filter(
    (f) => rolesMatch(f.roles, groups) || hasAnswer(answers[f.key]),
  );
  return (
    <Card title={section.title}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <EditField key={f.key} field={f} value={answers[f.key]} />
        ))}
      </div>
    </Card>
  );
}

function EditList({ list, entries }: { list: AppListDef; entries: Record<string, string>[] }) {
  const rows = Math.max(list.max, entries.length + 1);
  return (
    <Card title={list.title}>
      <div className="space-y-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-400">#{i + 1}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {list.fields.map((f) => {
                const name = appListInputName(list.key, i, f.key);
                const v = entries[i]?.[f.key] ?? "";
                const options = f.type === "yesno" ? ["Yes", "No"] : f.options;
                return (
                  <label
                    key={f.key}
                    className={`flex flex-col gap-1 ${f.type === "longtext" ? "sm:col-span-2 lg:col-span-4" : ""}`}
                  >
                    <span className={LABEL}>{f.label}</span>
                    {f.type === "longtext" ? (
                      <textarea name={name} rows={2} defaultValue={v} className={`${INPUT} bg-white`} />
                    ) : options ? (
                      <select name={name} defaultValue={v} className={`${INPUT} bg-white`}>
                        <option value="">—</option>
                        {options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                        {v && !options.includes(v) && <option value={v}>{v}</option>}
                      </select>
                    ) : (
                      <input name={name} defaultValue={v} className={`${INPUT} bg-white`} />
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function EditSkills({ grid, skills }: { grid: SkillGrid; skills: Record<string, string> }) {
  return (
    <Card title={grid.title}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {grid.skills.map((s) => (
          <label key={s.key} className="flex flex-col gap-1">
            <span className={LABEL}>{s.label}</span>
            <select name={appSkillInputName(s.key)} defaultValue={skills[s.key] ?? ""} className={INPUT}>
              <option value="">—</option>
              {SKILL_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </Card>
  );
}

function EditLanguages({ languages }: { languages: ApplicationDetails["languages"] }) {
  const list = languages ?? [];
  const rows = Math.max(LANGUAGES_MAX, list.length + 1);
  return (
    <Card title={LANGUAGES_LABEL}>
      <datalist id="app-language-options">
        {LANGUAGE_OPTIONS.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex gap-2">
            <input
              name={appLanguageInputName(i, "language")}
              list="app-language-options"
              defaultValue={list[i]?.language ?? ""}
              placeholder="Language"
              className={`${INPUT} flex-1`}
            />
            <select
              name={appLanguageInputName(i, "fluency")}
              defaultValue={list[i]?.fluency ?? ""}
              className={INPUT}
            >
              <option value="">Fluency</option>
              {FLUENCY_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tab panel
// ---------------------------------------------------------------------------

const TAB_INTRO: Record<AppTab, { empty: string }> = {
  application: {
    empty:
      "No website application on file. Candidates who apply through the greendog careers form show their availability, eligibility and written answers here.",
  },
  experience: {
    empty:
      "No experience details yet. Work history, credentials, skills, languages and references from the careers form show here.",
  },
};

/**
 * The Application or Experience & Skills tab. Read-only by default; while
 * `editing`, renders inputs that post with the profile form's Save.
 */
export function ApplicationTabPanel({
  tab,
  app,
  groups,
  editing,
  canEdit,
  onEdit,
  onCancel,
}: {
  tab: AppTab;
  app: ApplicationDetails | null | undefined;
  groups: Set<RoleGroup>;
  editing: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const answers = app?.answers ?? {};
  const skills = app?.skills ?? {};
  const sections = APPLICATION_SECTIONS.filter((s) => s.tab === tab);
  const lists = APPLICATION_LISTS.filter((l) => l.tab === tab);
  const sectionHasData = (s: AppSection) => s.fields.some((f) => hasAnswer(answers[f.key]));
  const gridHasData = (g: SkillGrid) => g.skills.some((s) => skills[s.key]);
  const listEntries = (l: AppListDef) => (app?.[l.key] ?? []) as Record<string, string>[];
  const languages = app?.languages ?? [];
  const extra = tab === "application" ? (app?.extra ?? []) : [];

  const tabHasData =
    sections.some(sectionHasData) ||
    lists.some((l) => listEntries(l).length > 0) ||
    (tab === "experience" && (languages.length > 0 || SKILL_GRIDS.some(gridHasData))) ||
    extra.length > 0;

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-500">
        {app?.received_at
          ? `Submitted on the website application · ${fmtDate(app.received_at)}`
          : applicationHasData(app)
            ? "Application details"
            : ""}
      </p>
      {canEdit &&
        (editing ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-amber-700">Editing — click “Save changes” to keep edits.</span>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            ✎ Edit details
          </button>
        ))}
    </div>
  );

  if (editing) {
    const editable = sections.filter((s) => rolesMatch(s.roles, groups) || sectionHasData(s));
    const renderSections = (list: AppSection[]) =>
      list.map((s) => <EditSection key={s.key} section={s} answers={answers} groups={groups} />);
    const listEditor = (key: AppListDef["key"]) =>
      lists
        .filter((l) => l.key === key)
        .map((l) => <EditList key={l.key} list={l} entries={listEntries(l)} />);
    return (
      <div className="space-y-5">
        {header}
        {tab === "experience" ? (
          <>
            {renderSections(editable.filter((s) => s.key === "experience"))}
            {listEditor("employment")}
            {renderSections(editable.filter((s) => s.key !== "experience"))}
            {SKILL_GRIDS.filter((g) => rolesMatch(g.roles, groups) || gridHasData(g)).map((g) => (
              <EditSkills key={g.key} grid={g} skills={skills} />
            ))}
            <EditLanguages languages={languages} />
            {listEditor("references")}
          </>
        ) : (
          renderSections(editable)
        )}
      </div>
    );
  }

  if (!tabHasData) {
    return (
      <div className="space-y-5">
        {header}
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          {TAB_INTRO[tab].empty}
        </p>
      </div>
    );
  }

  const employment = APPLICATION_LISTS.find((l) => l.key === "employment");
  const references = APPLICATION_LISTS.find((l) => l.key === "references");

  return (
    <div className="space-y-5">
      {header}
      {tab === "experience" ? (
        <>
          {sections
            .filter((s) => s.key === "experience")
            .map((s) => (
              <ReadSection key={s.key} section={s} answers={answers} />
            ))}
          {employment && listEntries(employment).length > 0 && (
            <ReadEmployment entries={listEntries(employment)} />
          )}
          {sections
            .filter((s) => s.key !== "experience")
            .map((s) => (
              <ReadSection key={s.key} section={s} answers={answers} />
            ))}
          {SKILL_GRIDS.map((g) => (
            <ReadSkills key={g.key} grid={g} skills={skills} />
          ))}
          {languages.length > 0 && (
            <Card title={LANGUAGES_LABEL}>
              <Chips
                values={languages.map((l) => (l.fluency ? `${l.language} · ${l.fluency}` : l.language))}
              />
            </Card>
          )}
          {references && listEntries(references).length > 0 && (
            <ReadReferences entries={listEntries(references)} />
          )}
        </>
      ) : (
        <>
          {sections.map((s) => (
            <ReadSection key={s.key} section={s} answers={answers} />
          ))}
          {extra.length > 0 && (
            <Card title="Other answers">
              <dl className="space-y-3">
                {extra.map((e, i) => (
                  <div key={i}>
                    <dt className={LABEL}>{e.label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{e.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview snapshot
// ---------------------------------------------------------------------------

/** Eligibility answers that need a recruiter's attention, phrased as flags. */
const ELIGIBILITY_FLAGS: Record<string, string> = {
  age_18: "Under 18",
  work_authorized: "Not authorized to work in the U.S.",
  needs_sponsorship: "Needs visa sponsorship",
  reliable_transport: "No reliable transportation",
  can_lift: "Can't meet lifting / restraint requirement",
  exposure_ok: "Not comfortable with clinical exposure",
  drivers_license: "No valid driver's license",
};

const ELIGIBILITY_FIELDS = APPLICATION_SECTIONS.find((s) => s.key === "eligibility")?.fields ?? [];

export function ApplicationSnapshot({
  app,
  onOpen,
}: {
  app: ApplicationDetails | null | undefined;
  onOpen: (tab: AppTab) => void;
}) {
  if (!applicationHasData(app)) return null;
  const a = app?.answers ?? {};
  const pay = [answerText(a.desired_pay), answerText(a.pay_basis)].filter(Boolean).join(" ");
  const dvmLicense = answerText(a.dvm_license);
  const rvtLicense = answerText(a.rvt_license);
  const rvtStatus = answerText(a.rvt_status);
  const license = dvmLicense
    ? `CA DVM #${dvmLicense}`
    : rvtLicense
      ? `RVT #${rvtLicense}`
      : rvtStatus
        ? `RVT: ${rvtStatus}`
        : null;
  const facts: Array<[string, string | null | undefined]> = [
    ["Available to start", fmtDate(answerText(a.start_date))],
    ["Employment type", answerText(a.employment_types)],
    ["Locations", answerText(a.locations)],
    ["Days", answerText(a.days_available)],
    ["Shifts", answerText(a.shifts)],
    ["Hours / week", answerText(a.hours_per_week)],
    ["Desired pay", pay],
    ["Veterinary experience", answerText(a.years_vet) && `${answerText(a.years_vet)} yrs`],
    ["Highest education", answerText(a.highest_education)],
    ["License", license],
    [
      "Languages",
      (app?.languages ?? []).map((l) => l.language).join(", "),
    ],
    ["Software", answerText(a.software)],
  ];
  const shown = facts.filter(([, v]) => v && v.trim() !== "");

  const answeredEligibility = ELIGIBILITY_FIELDS.filter(
    (f) => f.good && (a[f.key] === "Yes" || a[f.key] === "No"),
  );
  const flags = answeredEligibility
    .filter((f) => a[f.key] !== f.good)
    .map((f) => ELIGIBILITY_FLAGS[f.key] ?? f.label);

  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
          Application snapshot
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onOpen("application")}
            className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            Full application →
          </button>
          <button
            type="button"
            onClick={() => onOpen("experience")}
            className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            Experience & skills →
          </button>
        </div>
      </div>
      {(flags.length > 0 || answeredEligibility.length > 0) && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {flags.length > 0 ? (
            flags.map((f) => (
              <span
                key={f}
                className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700"
              >
                ⚠ {f}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              ✓ Eligibility checks passed
            </span>
          )}
        </div>
      )}
      {shown.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(([label, value]) => (
            <div key={label}>
              <dt className={LABEL}>{label}</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
