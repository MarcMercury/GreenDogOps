"use client";

import { useRef, useState } from "react";
import { Panel } from "../../admin/_components";
import {
  REFERRAL_TEMPLATE_VARIABLES,
  RESCUE_TEMPLATE_VARIABLES,
  TEMPLATE_CATEGORIES,
  templateCategoryLabel,
  type TemplateVariable,
  type EmailTemplate,
} from "@/lib/crm/email-templates";
import {
  saveEmailTemplate,
  deleteEmailTemplate,
  setEmailTemplateActive,
} from "../actions";

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100";

const CATEGORY_OPTIONS = TEMPLATE_CATEGORIES;

/** Variable reference depends on which partner type the template targets. */
function variablesForCategory(category: string): TemplateVariable[] {
  if (category === "rescue") return RESCUE_TEMPLATE_VARIABLES;
  return REFERRAL_TEMPLATE_VARIABLES;
}

function VariableReference({
  category,
  onInsert,
}: {
  category: string;
  onInsert: (token: string) => void;
}) {
  const vars = variablesForCategory(category);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Available variables — {templateCategoryLabel(category)}
      </p>
      <p className="mb-2 text-xs text-slate-500">
        Click a variable to insert it at your cursor in the subject or body.
        They are filled from the account when the email is sent.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {vars.map((v) => (
          <button
            key={v.token}
            type="button"
            title={v.description}
            onClick={() => onInsert(`{{${v.token}}}`)}
            className="rounded-md bg-white px-2 py-1 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200 transition hover:bg-emerald-50 hover:text-emerald-700 hover:ring-emerald-300"
          >
            {`{{${v.token}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

function TemplateForm({
  template,
  onClose,
}: {
  template: EmailTemplate | null;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<string>(template?.category ?? "referral");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Which field to insert a clicked variable into — the last one focused.
  const lastFocused = useRef<"subject" | "body">("body");

  function insertVariable(token: string) {
    const el = lastFocused.current === "subject" ? subjectRef.current : bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + token + el.value.slice(end);
    const caret = start + token.length;
    el.focus();
    el.setSelectionRange(caret, caret);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            {template ? "Edit template" : "Add template"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <form action={saveEmailTemplate} className="space-y-4 p-5">
          {template ? (
            <input type="hidden" name="id" value={template.id} />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Name *
              </span>
              <input
                name="name"
                defaultValue={template?.name ?? ""}
                placeholder="Thank you for your referrals"
                className={inputCls}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Partner type
              </span>
              <select
                name="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputCls}
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Description
            </span>
            <input
              name="description"
              defaultValue={template?.description ?? ""}
              placeholder="Short note about when to use this template"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Subject *
            </span>
            <input
              ref={subjectRef}
              onFocus={() => (lastFocused.current = "subject")}
              name="subject"
              defaultValue={template?.subject ?? ""}
              placeholder="Thank you from Green Dog Dental, {{contact_first_name}}"
              className={`${inputCls} font-mono`}
              required
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Body *
            </span>
            <textarea
              ref={bodyRef}
              onFocus={() => (lastFocused.current = "body")}
              name="body"
              defaultValue={template?.body ?? ""}
              rows={12}
              placeholder={"Hi {{contact_first_name}},\n\n…\n\n{{sender_name}}"}
              className={`${inputCls} font-mono`}
              required
            />
          </label>

          <VariableReference category={category} onInsert={insertVariable} />

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={template?.is_active ?? true}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            Active (available in the Send Email dropdown)
          </label>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              {template ? "Save changes" : "Create template"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function TemplatesView({ templates }: { templates: EmailTemplate[] }) {
  const [editing, setEditing] = useState<EmailTemplate | "new" | null>(null);

  // Group by partner type, preserving the catalog order and appending any
  // unknown categories at the end so nothing is ever hidden.
  const known = new Set(TEMPLATE_CATEGORIES.map((c) => c.value));
  const extraCategories = [
    ...new Set(templates.map((t) => t.category).filter((c) => !known.has(c))),
  ];
  const orderedCategories = [
    ...TEMPLATE_CATEGORIES.map((c) => c.value),
    ...extraCategories,
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Email templates</h1>
          <p className="text-sm text-slate-500">
            Reusable templates for CRM “Send Email”, grouped by the partner type
            they target. Use {"{{variables}}"} to personalize each message.
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          + Add template
        </button>
      </div>

      {orderedCategories.map((cat) => {
        const rows = templates.filter((t) => t.category === cat);
        return (
          <Panel
            key={cat}
            title={templateCategoryLabel(cat)}
            description={`${rows.length} template${rows.length === 1 ? "" : "s"}`}
          >
            {rows.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-400">
                No {templateCategoryLabel(cat).toLowerCase()} templates yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((t) => (
                  <TemplateRow key={t.id} t={t} onEdit={() => setEditing(t)} />
                ))}
              </ul>
            )}
          </Panel>
        );
      })}

      {editing && (
        <TemplateForm
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TemplateRow({ t, onEdit }: { t: EmailTemplate; onEdit: () => void }) {
  return (
    <li className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900">{t.name}</span>
          {!t.is_active && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
              Inactive
            </span>
          )}
        </div>
        {t.description && (
          <p className="mt-0.5 text-xs text-slate-500">{t.description}</p>
        )}
        <p className="mt-1 truncate text-sm text-slate-600">
          <span className="text-slate-400">Subject:</span> {t.subject}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onEdit}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Edit
        </button>
        <form action={setEmailTemplateActive}>
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="is_active" value={(!t.is_active).toString()} />
          <button
            type="submit"
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {t.is_active ? "Deactivate" : "Activate"}
          </button>
        </form>
        <form
          action={deleteEmailTemplate}
          onSubmit={(e) => {
            if (!confirm(`Delete template “${t.name}”?`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={t.id} />
          <button
            type="submit"
            className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </form>
      </div>
    </li>
  );
}
