"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  APPLICATION_CORE_FIELDS,
  FORM_FIELD_TYPES,
  FORM_KIND_LABELS,
  fieldHasOptions,
  fieldIsAnswerable,
  formFieldProblems,
  newField,
  newFieldId,
  slugify,
  type FormFieldType,
  type RecruitingForm,
  type RecruitingFormField,
} from "@/lib/ats/forms";
import { saveForm } from "@/app/(app)/ats/forms-actions";

export type BuilderForm = Omit<RecruitingForm, "id" | "created_at" | "updated_at"> & {
  id: string | null;
};

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const labelCls = "text-sm font-medium text-slate-700";
const cardCls = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";
const iconBtnCls =
  "rounded-md px-2 py-1 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";

function oneLine(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

function blankToNull(v: string | null): string | null {
  const s = v?.trim() ?? "";
  return s === "" ? null : s;
}

/** The form as the server will store it, so client checks match the save. */
function cleanForm(form: BuilderForm): BuilderForm {
  return {
    ...form,
    name: form.name.trim(),
    description: blankToNull(form.description),
    intro: blankToNull(form.intro),
    success_message: blankToNull(form.success_message),
    job_titles: [...new Set(form.job_titles.map(oneLine).filter(Boolean))],
    fields: form.fields.map((f) => ({
      ...f,
      label: oneLine(f.label),
      description: blankToNull(f.description),
      required: fieldIsAnswerable(f.type) && f.required,
      options: fieldHasOptions(f.type)
        ? [...new Set(f.options.map(oneLine).filter(Boolean))]
        : [],
    })),
  };
}

function nextOptionLabel(options: string[]): string {
  for (let n = options.length + 1; ; n++) {
    const label = `Option ${n}`;
    if (!options.includes(label)) return label;
  }
}

function focusInput(id: string, select = false) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    if (select) el?.select();
  });
}

function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? "bg-emerald-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {hint && <span className="ml-2 text-xs text-slate-400">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function FormBuilder({
  initial,
  titleSuggestions,
}: {
  initial: BuilderForm;
  titleSuggestions: string[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<BuilderForm>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [showProblems, setShowProblems] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const isApplication = form.kind === "application";
  const dirty = useMemo(() => JSON.stringify(form) !== baseline, [form, baseline]);
  const linkSlug = slugify(form.slug || form.name);

  const problems = useMemo(() => {
    if (!showProblems) return [];
    const cleaned = cleanForm(form);
    const out: string[] = [];
    if (!cleaned.name) out.push("Give the form a name.");
    if (cleaned.kind === "application" && !slugify(cleaned.slug || cleaned.name)) {
      out.push("Give the application a link name.");
    }
    return [...out, ...formFieldProblems(cleaned.fields)];
  }, [form, showProblems]);

  // Warn before a reload/close, and before following an in-app link, while
  // there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  function set<K extends keyof BuilderForm>(key: K, value: BuilderForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setFields(fn: (fields: RecruitingFormField[]) => RecruitingFormField[]) {
    setForm((f) => ({ ...f, fields: fn(f.fields) }));
  }

  function updateField(id: string, patch: Partial<RecruitingFormField>) {
    setFields((fields) => fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function changeType(id: string, type: FormFieldType) {
    setFields((fields) =>
      fields.map((f) => {
        if (f.id !== id) return f;
        const options = fieldHasOptions(type)
          ? f.options.length
            ? f.options
            : ["Option 1"]
          : [];
        return { ...f, type, options, required: fieldIsAnswerable(type) && f.required };
      }),
    );
  }

  function moveField(index: number, dir: -1 | 1) {
    setFields((fields) => {
      const to = index + dir;
      if (to < 0 || to >= fields.length) return fields;
      const next = [...fields];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  function duplicateField(index: number) {
    const src = form.fields[index];
    if (!src) return;
    const copy: RecruitingFormField = {
      ...src,
      id: newFieldId(form.fields.map((f) => f.id)),
      options: [...src.options],
    };
    setFields((fields) => [...fields.slice(0, index + 1), copy, ...fields.slice(index + 1)]);
    setActiveId(copy.id);
    focusInput(`label-${copy.id}`, true);
  }

  function removeField(id: string) {
    setFields((fields) => fields.filter((f) => f.id !== id));
  }

  function addField(type: FormFieldType) {
    const field = newField(type, form.fields.map((f) => f.id));
    setFields((fields) => [...fields, field]);
    setActiveId(field.id);
    setAddMenuOpen(false);
    focusInput(`label-${field.id}`);
  }

  function addOption(field: RecruitingFormField, after: number) {
    const label = nextOptionLabel(field.options);
    const options = [...field.options];
    options.splice(after + 1, 0, label);
    updateField(field.id, { options });
    focusInput(`opt-${field.id}-${after + 1}`, true);
  }

  function removeOption(field: RecruitingFormField, index: number) {
    if (field.options.length <= 1) return;
    updateField(field.id, { options: field.options.filter((_, i) => i !== index) });
  }

  function hasTitle(t: string): boolean {
    const k = t.trim().toLowerCase();
    return form.job_titles.some((j) => j.trim().toLowerCase() === k);
  }

  function toggleTitle(t: string) {
    const k = t.trim().toLowerCase();
    set(
      "job_titles",
      hasTitle(t)
        ? form.job_titles.filter((j) => j.trim().toLowerCase() !== k)
        : [...form.job_titles, t.trim()],
    );
  }

  function addCustomTitle() {
    const t = oneLine(newTitle).slice(0, 80);
    if (t && !hasTitle(t)) set("job_titles", [...form.job_titles, t]);
    setNewTitle("");
  }

  const titleChips = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...titleSuggestions, ...form.job_titles]) {
      const k = t.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(t.trim());
    }
    return out;
  }, [titleSuggestions, form.job_titles]);

  function save() {
    setError(null);
    setJustSaved(false);
    const cleaned = cleanForm(form);
    const slug = cleaned.kind === "application" ? slugify(cleaned.slug || cleaned.name) : null;
    if (
      !cleaned.name ||
      (cleaned.kind === "application" && !slug) ||
      formFieldProblems(cleaned.fields).length > 0
    ) {
      setShowProblems(true);
      return;
    }
    setShowProblems(false);
    startTransition(async () => {
      const res = await saveForm({
        id: cleaned.id,
        kind: cleaned.kind,
        name: cleaned.name,
        description: cleaned.description,
        intro: cleaned.intro,
        success_message: cleaned.success_message,
        fields: cleaned.fields,
        job_titles: cleaned.job_titles,
        slug,
        require_resume: cleaned.require_resume,
        active: cleaned.active,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const saved: BuilderForm = { ...cleaned, id: res.id, slug };
      setForm(saved);
      setBaseline(JSON.stringify(saved));
      setJustSaved(true);
      if (!cleaned.id) router.replace(`/ats/forms/${res.id}`);
      else router.refresh();
    });
  }

  function fieldHasProblem(f: RecruitingFormField): boolean {
    if (!showProblems) return false;
    if (!oneLine(f.label)) return true;
    return fieldHasOptions(f.type) && !f.options.some((o) => oneLine(o));
  }

  return (
    <div className="mt-4 space-y-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {form.id ? form.name || "Untitled form" : `New ${FORM_KIND_LABELS[form.kind]}`}
        </h1>
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
          {FORM_KIND_LABELS[form.kind]}
        </span>
        {form.is_default && (
          <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-200">
            Default at /apply
          </span>
        )}
        {!form.active && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
            Inactive
          </span>
        )}
      </div>

      {/* Name & description */}
      <section className={`${cardCls} border-t-8 border-t-emerald-600`}>
        <div className="space-y-4">
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              maxLength={120}
              placeholder={isApplication ? "e.g. Standard Application" : "e.g. CSR Screening"}
              className={`${inputCls} w-full text-base font-medium ${
                showProblems && !form.name.trim() ? "border-red-400" : ""
              }`}
            />
          </Field>
          <Field label="Internal description" hint="Only your team sees this">
            <input
              value={form.description ?? ""}
              onChange={(e) => set("description", e.target.value === "" ? null : e.target.value)}
              maxLength={1000}
              placeholder="What this form is for"
              className={`${inputCls} w-full`}
            />
          </Field>
        </div>
      </section>

      {/* Candidate-facing text */}
      <section className={cardCls}>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          What the candidate sees
        </h2>
        <div className="mt-3 space-y-4">
          <Field label="Intro" hint="Shown under the title">
            <textarea
              value={form.intro ?? ""}
              onChange={(e) => set("intro", e.target.value === "" ? null : e.target.value)}
              maxLength={4000}
              rows={3}
              placeholder="A short welcome or instructions"
              className={`${inputCls} w-full resize-y`}
            />
          </Field>
          <Field label="Success message" hint="Shown after they submit">
            <textarea
              value={form.success_message ?? ""}
              onChange={(e) =>
                set("success_message", e.target.value === "" ? null : e.target.value)
              }
              maxLength={2000}
              rows={2}
              placeholder={
                isApplication
                  ? "Thanks for applying! We'll be in touch."
                  : "Your answers are in. We'll be in touch about next steps."
              }
              className={`${inputCls} w-full resize-y`}
            />
          </Field>
        </div>
      </section>

      {/* Settings */}
      <section className={cardCls}>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Settings</h2>
        <div className="mt-3 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={labelCls}>Active</p>
              <p className="text-xs text-slate-500">
                {form.is_default && form.active
                  ? "This is the application at /apply, so it stays active. Make another application the default to turn it off."
                  : isApplication
                    ? "Inactive applications can't be opened by candidates."
                    : "Inactive forms can't be sent to candidates."}
              </p>
            </div>
            <Switch
              label="Active"
              checked={form.active}
              disabled={form.is_default && form.active}
              onChange={(v) => set("active", v)}
            />
          </div>

          <div>
            <p className={labelCls}>
              Used for job types
              <span className="ml-2 text-xs font-normal text-slate-400">
                Suggested first for candidates in these roles
              </span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {titleChips.map((t) => {
                const on = hasTitle(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleTitle(t)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      on
                        ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                        : "border-slate-300 bg-white text-slate-600 hover:border-emerald-400 hover:text-emerald-700"
                    }`}
                  >
                    {on ? "✓ " : ""}
                    {t}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomTitle();
                  }
                }}
                maxLength={80}
                placeholder="Add another job type"
                className={`${inputCls} w-full max-w-xs`}
              />
              <button
                type="button"
                onClick={addCustomTitle}
                disabled={!newTitle.trim()}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {isApplication && (
            <>
              <Field label="Link name">
                <input
                  value={form.slug ?? ""}
                  onChange={(e) => set("slug", e.target.value === "" ? null : e.target.value)}
                  onBlur={() => form.slug && set("slug", slugify(form.slug) || null)}
                  maxLength={60}
                  placeholder={slugify(form.name) || "standard-application"}
                  className={`${inputCls} w-full max-w-sm ${
                    showProblems && !linkSlug ? "border-red-400" : ""
                  }`}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Candidates apply at{" "}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                    /apply/{linkSlug || "…"}
                  </code>
                  {form.is_default && (
                    <>
                      {" "}and at <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">/apply</code>
                    </>
                  )}
                </p>
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.require_resume}
                  onChange={(e) => set("require_resume", e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                Require a resume
              </label>
            </>
          )}
        </div>
      </section>

      {isApplication && (
        <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-4">
          <p className="text-sm font-medium text-slate-700">Built-in fields</p>
          <p className="mt-0.5 text-xs text-slate-500">
            These always appear first and fill in the candidate&apos;s profile. Your questions
            follow them.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {APPLICATION_CORE_FIELDS.map((f) => (
              <span
                key={f.id}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-600"
              >
                {f.label}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Questions */}
      <div className="flex items-baseline justify-between pt-2">
        <h2 className="text-lg font-semibold text-slate-900">
          {isApplication ? "Application questions" : "Questions"}
        </h2>
        <span className="text-xs text-slate-400">
          {form.fields.length} {form.fields.length === 1 ? "item" : "items"}
        </span>
      </div>

      {form.fields.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No questions yet. Add one below.
        </p>
      )}

      {form.fields.map((f, i) => {
        const active = activeId === f.id;
        const problem = fieldHasProblem(f);
        const isSection = f.type === "section";
        return (
          <section
            key={f.id}
            onFocusCapture={() => setActiveId(f.id)}
            onClick={() => setActiveId(f.id)}
            className={`rounded-xl border shadow-sm transition ${isSection ? "bg-slate-50" : "bg-white"} ${
              problem ? "border-red-300" : "border-slate-200"
            } ${active ? "border-l-4 border-l-emerald-600" : ""}`}
          >
            <div className="space-y-3 p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {isSection ? "Section" : "Question"} {i + 1}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id={`label-${f.id}`}
                  value={f.label}
                  onChange={(e) => updateField(f.id, { label: e.target.value })}
                  maxLength={500}
                  placeholder={isSection ? "Section title" : "Question"}
                  aria-label={isSection ? "Section title" : "Question title"}
                  className={`${inputCls} min-w-0 flex-1 text-base ${
                    problem && !oneLine(f.label) ? "border-red-400" : ""
                  }`}
                />
                <select
                  value={f.type}
                  onChange={(e) => changeType(f.id, e.target.value as FormFieldType)}
                  aria-label="Question type"
                  className={`${inputCls} bg-white sm:w-52`}
                >
                  {FORM_FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.icon}  {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                value={f.description ?? ""}
                onChange={(e) =>
                  updateField(f.id, { description: e.target.value === "" ? null : e.target.value })
                }
                maxLength={1000}
                placeholder="Description (optional)"
                aria-label="Description"
                className="w-full rounded-md border border-transparent px-3 py-1 text-xs text-slate-600 placeholder:text-slate-400 hover:border-slate-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />

              {fieldHasOptions(f.type) && (
                <div className="space-y-1.5">
                  {f.options.map((o, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-center text-sm text-slate-400">
                        {f.type === "multiple_choice" ? "○" : f.type === "checkboxes" ? "☐" : `${oi + 1}.`}
                      </span>
                      <input
                        id={`opt-${f.id}-${oi}`}
                        value={o}
                        onChange={(e) =>
                          updateField(f.id, {
                            options: f.options.map((x, xi) => (xi === oi ? e.target.value : x)),
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addOption(f, oi);
                          } else if (e.key === "Backspace" && o === "" && f.options.length > 1) {
                            e.preventDefault();
                            removeOption(f, oi);
                            focusInput(`opt-${f.id}-${Math.max(0, oi - 1)}`);
                          }
                        }}
                        maxLength={200}
                        placeholder={`Option ${oi + 1}`}
                        aria-label={`Option ${oi + 1}`}
                        className="min-w-0 flex-1 border-b border-transparent px-1 py-1 text-sm text-slate-800 hover:border-slate-200 focus:border-emerald-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(f, oi)}
                        disabled={f.options.length <= 1}
                        aria-label={`Remove option ${oi + 1}`}
                        title="Remove option"
                        className={iconBtnCls}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addOption(f, f.options.length - 1)}
                    disabled={f.options.length >= 50}
                    className="ml-7 rounded-md px-1 py-1 text-sm font-medium text-emerald-700 hover:text-emerald-900 disabled:opacity-50"
                  >
                    + Add option
                  </button>
                </div>
              )}

              {f.type === "yes_no" && (
                <div className="flex gap-4 pl-1 text-sm text-slate-500">
                  <span>○ Yes</span>
                  <span>○ No</span>
                </div>
              )}
              {f.type === "file" && (
                <p className="pl-1 text-sm text-slate-500">
                  📎 Candidate uploads a file (PDF, Word, image; 15 MB max)
                </p>
              )}
              {(f.type === "short_text" ||
                f.type === "long_text" ||
                f.type === "number" ||
                f.type === "date") && (
                <p
                  className={`w-full max-w-sm border-b border-dotted border-slate-300 px-1 pb-1 text-sm text-slate-400 ${
                    f.type === "long_text" ? "max-w-full pt-4" : ""
                  }`}
                >
                  {f.type === "short_text"
                    ? "Short answer text"
                    : f.type === "long_text"
                      ? "Long answer text"
                      : f.type === "number"
                        ? "Number"
                        : "Date"}
                </p>
              )}
              {isSection && (
                <p className="pl-1 text-xs text-slate-400">
                  A heading that breaks the form into parts. It doesn&apos;t collect an answer.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-1 border-t border-slate-100 px-3 py-2">
              <button
                type="button"
                onClick={() => moveField(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                title="Move up"
                className={iconBtnCls}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveField(i, 1)}
                disabled={i === form.fields.length - 1}
                aria-label="Move down"
                title="Move down"
                className={iconBtnCls}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => duplicateField(i)}
                aria-label="Duplicate"
                title="Duplicate"
                className={iconBtnCls}
              >
                ⧉
              </button>
              <button
                type="button"
                onClick={() => removeField(f.id)}
                aria-label="Delete"
                title="Delete"
                className="rounded-md px-2 py-1 text-sm text-slate-500 transition hover:bg-red-50 hover:text-red-600"
              >
                🗑
              </button>
              {fieldIsAnswerable(f.type) && (
                <>
                  <span className="mx-2 h-5 w-px bg-slate-200" />
                  <span className="text-sm text-slate-600">Required</span>
                  <span className="ml-2">
                    <Switch
                      label="Required"
                      checked={f.required}
                      onChange={(v) => updateField(f.id, { required: v })}
                    />
                  </span>
                </>
              )}
            </div>
          </section>
        );
      })}

      <div>
        <button
          type="button"
          onClick={() => setAddMenuOpen((o) => !o)}
          aria-expanded={addMenuOpen}
          className="w-full rounded-xl border border-dashed border-emerald-300 bg-white px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:border-emerald-500 hover:bg-emerald-50"
        >
          + Add question
        </button>
        {addMenuOpen && (
          <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-5">
            {FORM_FIELD_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => addField(t.value)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-800"
              >
                <span className="w-5 shrink-0 text-center text-slate-400">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {problems.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Fix these before saving:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <div className="min-w-0 text-sm">
          {error ? (
            <span className="text-red-700">{error}</span>
          ) : pending ? (
            <span className="text-slate-500">Saving…</span>
          ) : dirty ? (
            <span className="text-amber-700">Unsaved changes</span>
          ) : justSaved ? (
            <span className="font-medium text-emerald-700">Saved ✓</span>
          ) : form.id ? (
            <span className="text-slate-400">All changes saved</span>
          ) : (
            <span className="text-slate-400">New form</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {form.id ? (
            <Link
              href={`/ats/forms/${form.id}/preview`}
              target="_blank"
              rel="noopener"
              title={dirty ? "Preview shows the last saved version" : undefined}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Preview ↗
            </Link>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Save to preview</span>
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-400"
              >
                Preview ↗
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={pending || (!dirty && !!form.id)}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving…" : form.id ? "Save" : "Create form"}
          </button>
        </div>
      </div>
    </div>
  );
}
