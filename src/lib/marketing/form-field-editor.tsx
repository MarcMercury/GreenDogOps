"use client";

import {
  type QrForm,
  type QrFormField,
  QR_FIELD_TYPES,
  fieldHasOptions,
  newFormField,
  slugifyFieldKey,
} from "@/lib/marketing/qr";

const rowInput =
  "w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-emerald-400 focus:outline-none";
const tinyInput =
  "rounded-md border border-slate-200 px-2 py-1 text-xs focus:border-emerald-400 focus:outline-none";
const tinyLabel = "text-[11px] font-medium text-slate-500";

const GROUPS = [...new Set(QR_FIELD_TYPES.map((t) => t.group))];

/** Options are edited one per line — commas are legitimate inside an answer. */
const linesToOptions = (v: string) =>
  v.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 50);

function QuestionCard({
  field,
  index,
  count,
  onPatch,
  onMove,
  onDuplicate,
  onRemove,
}: {
  field: QrFormField;
  index: number;
  count: number;
  onPatch: (p: Partial<QrFormField>) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const isHeading = field.type === "heading";
  const hasOptions = fieldHasOptions(field.type);

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={field.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder={isHeading ? "Section heading…" : "Question…"}
          className="min-w-[10rem] flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-emerald-400 focus:outline-none"
        />
        <select
          value={field.type}
          onChange={(e) => {
            const type = e.target.value as QrFormField["type"];
            // Dropping to a type that cannot hold options must not strand them.
            onPatch({
              type,
              options: fieldHasOptions(type) ? field.options : [],
              allowOther: fieldHasOptions(type) ? field.allowOther : false,
              required: type === "heading" ? false : field.required,
            });
          }}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs"
        >
          {GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {QR_FIELD_TYPES.filter((t) => t.group === g).map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {!isHeading && (
          <label className="flex items-center gap-1 text-[11px] text-slate-500">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => onPatch({ required: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
            />
            Required
          </label>
        )}
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="Move up"
            className="px-1 text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-300"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            title="Move down"
            className="px-1 text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-300"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            title="Duplicate"
            className="px-1 text-slate-300 hover:text-slate-600"
          >
            ⧉
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Delete"
            className="px-1 text-slate-300 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      </div>

      <input
        value={field.description ?? ""}
        onChange={(e) => onPatch({ description: e.target.value || null })}
        placeholder={isHeading ? "Section description (optional)" : "Help text (optional)"}
        className={`mt-1.5 ${rowInput} text-xs`}
      />

      {hasOptions && (
        <div className="mt-1.5">
          <label className={tinyLabel}>Options — one per line</label>
          <textarea
            value={field.options.join("\n")}
            onChange={(e) => onPatch({ options: linesToOptions(e.target.value) })}
            rows={Math.min(8, Math.max(3, field.options.length + 1))}
            placeholder={"First option\nSecond option"}
            className={`mt-1 ${rowInput} text-xs`}
          />
          <label className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
            <input
              type="checkbox"
              checked={field.allowOther}
              onChange={(e) => onPatch({ allowOther: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
            />
            Add an “Other…” option with a write-in box
          </label>
        </div>
      )}

      {field.type === "scale" && (
        <div className="mt-1.5 flex flex-wrap items-end gap-2">
          <div>
            <label className={tinyLabel}>From</label>
            <input
              type="number"
              min={0}
              max={9}
              value={field.min ?? 1}
              onChange={(e) => onPatch({ min: Number(e.target.value) })}
              className={`mt-1 w-16 ${tinyInput}`}
            />
          </div>
          <div>
            <label className={tinyLabel}>To</label>
            <input
              type="number"
              min={1}
              max={10}
              value={field.max ?? 5}
              onChange={(e) => onPatch({ max: Number(e.target.value) })}
              className={`mt-1 w-16 ${tinyInput}`}
            />
          </div>
          <div className="min-w-[8rem] flex-1">
            <label className={tinyLabel}>Low caption</label>
            <input
              value={field.minLabel ?? ""}
              onChange={(e) => onPatch({ minLabel: e.target.value || null })}
              placeholder="Not at all"
              className={`mt-1 w-full ${tinyInput}`}
            />
          </div>
          <div className="min-w-[8rem] flex-1">
            <label className={tinyLabel}>High caption</label>
            <input
              value={field.maxLabel ?? ""}
              onChange={(e) => onPatch({ maxLabel: e.target.value || null })}
              placeholder="Extremely"
              className={`mt-1 w-full ${tinyInput}`}
            />
          </div>
        </div>
      )}

      {field.type === "number" && (
        <div className="mt-1.5 flex flex-wrap items-end gap-2">
          <div>
            <label className={tinyLabel}>Min (optional)</label>
            <input
              type="number"
              value={field.min ?? ""}
              onChange={(e) =>
                onPatch({ min: e.target.value === "" ? null : Number(e.target.value) })
              }
              className={`mt-1 w-24 ${tinyInput}`}
            />
          </div>
          <div>
            <label className={tinyLabel}>Max (optional)</label>
            <input
              type="number"
              value={field.max ?? ""}
              onChange={(e) =>
                onPatch({ max: e.target.value === "" ? null : Number(e.target.value) })
              }
              className={`mt-1 w-24 ${tinyInput}`}
            />
          </div>
        </div>
      )}

      {["text", "textarea", "email", "number"].includes(field.type) && (
        <input
          value={field.placeholder ?? ""}
          onChange={(e) => onPatch({ placeholder: e.target.value || null })}
          placeholder="Placeholder (optional)"
          className={`mt-1.5 ${rowInput} text-xs`}
        />
      )}
    </li>
  );
}

/**
 * The question builder shared by both capture-form editors (QR Code Mgmt →
 * Forms, and the inline form tab on a record's QR panel) so the two can never
 * drift apart on which field types they offer.
 */
export function FormFieldEditor({
  fields,
  onChange,
  canEdit = true,
}: {
  fields: QrFormField[];
  onChange: (next: QrFormField[]) => void;
  canEdit?: boolean;
}) {
  const patch = (idx: number, p: Partial<QrFormField>) =>
    onChange(fields.map((f, i) => (i === idx ? { ...f, ...p } : f)));

  const move = (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (to < 0 || to >= fields.length) return;
    const next = [...fields];
    [next[idx], next[to]] = [next[to], next[idx]];
    onChange(next);
  };

  const duplicate = (idx: number) => {
    const next = [...fields];
    // Blank the key so parseFormFields mints a fresh, non-colliding one.
    next.splice(idx + 1, 0, { ...fields[idx], key: "" });
    onChange(next);
  };

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Questions
      </p>
      <ul className="space-y-2">
        {fields.map((f, idx) => (
          <QuestionCard
            key={idx}
            field={f}
            index={idx}
            count={fields.length}
            onPatch={(p) => patch(idx, p)}
            onMove={(dir) => move(idx, dir)}
            onDuplicate={() => duplicate(idx)}
            onRemove={() => onChange(fields.filter((_, i) => i !== idx))}
          />
        ))}
        {fields.length === 0 && (
          <li className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-[11px] text-slate-400">
            No extra questions — the form just collects contact details.
          </li>
        )}
      </ul>
      {canEdit && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onChange([...fields, newFormField()])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            ＋ Add question
          </button>
          <button
            type="button"
            onClick={() => onChange([...fields, newFormField({ type: "heading" })])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            ＋ Add section
          </button>
        </div>
      )}
    </div>
  );
}

/** Drop unlabelled questions and mint keys — what both editors post. */
export function serializeFields(fields: QrFormField[]): string {
  return JSON.stringify(
    fields
      .filter((f) => f.label.trim())
      .map((f) => ({ ...f, key: f.key || slugifyFieldKey(f.label) })),
  );
}

/** The after-submission block of a form, as the editors hold it. */
export interface AfterSubmission {
  post_submit_heading: string;
  success_message: string;
  show_confirmation: boolean;
  confirmation_note: string;
}

export const afterSubmissionFrom = (form: QrForm | null): AfterSubmission => ({
  post_submit_heading: form?.post_submit_heading ?? "",
  success_message: form?.success_message ?? "",
  show_confirmation: form?.show_confirmation ?? false,
  confirmation_note: form?.confirmation_note ?? "",
});

/**
 * Everything the scanner sees once they submit, in one place — a form has a
 * single confirmation screen, so it gets a single section here. The inputs
 * carry real `name` attributes so a host dialog that posts
 * `new FormData(form)` picks them up without wiring anything; the controlled
 * values are for hosts that build their FormData by hand.
 */
export function AfterSubmissionFields({
  value,
  onChange,
}: {
  value: AfterSubmission;
  onChange: (next: AfterSubmission) => void;
}) {
  const patch = (p: Partial<AfterSubmission>) => onChange({ ...value, ...p });

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        After submission
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400">
        The confirmation screen shown on the scanner&apos;s phone the moment they submit.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={tinyLabel}>Heading</label>
          <input
            name="post_submit_heading"
            value={value.post_submit_heading}
            onChange={(e) => patch({ post_submit_heading: e.target.value })}
            placeholder="Thanks — you're all set!"
            className={`mt-1 w-full ${rowInput}`}
          />
        </div>
        <div>
          <label className={tinyLabel}>Message</label>
          <input
            name="success_message"
            value={value.success_message}
            onChange={(e) => patch({ success_message: e.target.value })}
            placeholder="Show this screen to spin the prize wheel!"
            className={`mt-1 w-full ${rowInput}`}
          />
        </div>
      </div>

      <label className="mt-3 flex items-start gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          name="show_confirmation"
          checked={value.show_confirmation}
          onChange={(e) => patch({ show_confirmation: e.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
        />
        <span>
          Show a verification ticket
          <span className="block text-[11px] text-slate-400">
            A confirmation code, the person&apos;s name and a live “submitted Ns ago”
            timer — so staff can hand out a prize without waiting for the leads list.
          </span>
        </span>
      </label>

      {value.show_confirmation && (
        <div className="mt-3">
          <label className={tinyLabel}>Small print under the ticket</label>
          <input
            name="confirmation_note"
            value={value.confirmation_note}
            onChange={(e) => patch({ confirmation_note: e.target.value })}
            placeholder="One spin per household."
            className={`mt-1 w-full ${rowInput}`}
          />
        </div>
      )}
    </div>
  );
}
