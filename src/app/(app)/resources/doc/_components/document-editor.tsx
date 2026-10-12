"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import type { AppRole } from "@/lib/auth/permissions";
import { MAX_IMAGE_BYTES, isSafeHref, type DocNode } from "@/lib/resources/content";
import { documentAudience } from "@/lib/resources/access";
import type { ResourceCategory } from "@/lib/resources/types";
import { saveNativeDocument } from "../actions";
import { AccessPicker, type AccessValue, type PickerPerson } from "./access-picker";
import { documentExtensions } from "./extensions";

export const NOTICE_KEY = "gdo-doc-notice";

export interface EditorInitial {
  id: string | null;
  title: string;
  category: string;
  description: string;
  content: DocNode | null;
  baseVersion: number;
  requireSignature: boolean;
}

export function DocumentEditor({
  initial,
  categories,
  audienceCount: existingAudience,
  people,
  selfId,
}: {
  initial: EditorInitial;
  categories: ResourceCategory[];
  /** People (other than the editor) who can view an existing document. */
  audienceCount: number;
  /** New documents: everyone who could be given access, for the access picker. */
  people?: PickerPerson[];
  selfId?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [category, setCategory] = useState(initial.category);
  const [description, setDescription] = useState(initial.description);
  const [dirty, setDirty] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [access, setAccess] = useState<AccessValue>({ everyone: true, roles: new Set(), viewers: new Set() });
  const isNew = !initial.id;
  const audienceCount =
    isNew && people
      ? documentAudience(
          { visible_roles: access.everyone ? null : [...access.roles] },
          people.map((p) => ({ id: p.id, role: p.role as AppRole, is_active: true })),
          access.viewers,
        ).filter((p) => p.id !== selfId).length
      : existingAudience;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: documentExtensions({ editable: true }),
    content: initial.content ?? { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: { attributes: { class: "min-h-[50vh] px-1 py-2", "aria-label": "Document body" } },
    onUpdate: () => setDirty(true),
  });

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = (opts: { changeNote: string; notify: boolean; requireSignature: boolean }) => {
    if (!editor) return;
    setError(null);
    startTransition(async () => {
      const res = await saveNativeDocument({
        id: initial.id,
        title,
        category,
        description,
        content: editor.getJSON(),
        changeNote: opts.changeNote,
        notify: opts.notify,
        requireSignature: opts.requireSignature,
        baseVersion: initial.id ? initial.baseVersion : undefined,
        access: isNew
          ? { everyone: access.everyone, roles: [...access.roles], viewerIds: [...access.viewers] }
          : null,
      });
      if (!res.ok) {
        setError(res.error);
        setSaveOpen(false);
        return;
      }
      setDirty(false);
      if (res.message) sessionStorage.setItem(NOTICE_KEY, res.message);
      router.push(`/resources/doc/${res.id}`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-medium text-slate-500">Title</span>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            maxLength={200}
            placeholder="e.g. Attendance Policy"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Category</span>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setDirty(true);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 sm:col-span-3">
          <span className="text-xs font-medium text-slate-500">
            Description <span className="text-slate-400">(optional, shown in the library)</span>
          </span>
          <input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
            maxLength={500}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
      </div>

      {isNew && people ? (
        <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" open={!access.everyone}>
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Who can view{" "}
            <span className="font-normal text-slate-500">
              — {access.everyone ? "everyone" : `${audienceCount} ${audienceCount === 1 ? "person" : "people"} besides you`}
            </span>
          </summary>
          <div className="mt-3">
            <AccessPicker value={access} people={people} onChange={setAccess} />
          </div>
        </details>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {editor ? <Toolbar editor={editor} /> : null}
        <div className="gdo-doc px-5 py-4 sm:px-8">
          {editor ? <EditorContent editor={editor} /> : <p className="text-sm text-slate-400">Loading editor…</p>}
        </div>
      </div>

      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm backdrop-blur">
        <span className="mr-auto text-xs text-slate-500">
          {dirty ? "Unsaved changes" : initial.id ? `Editing version ${initial.baseVersion}` : "New document"}
        </span>
        <button
          type="button"
          onClick={() => router.push(initial.id ? `/resources/doc/${initial.id}` : "/resources")}
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!editor || pending || !title.trim()}
          onClick={() => setSaveOpen(true)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save…"}
        </button>
      </div>

      {saveOpen ? (
        <SaveDialog
          isNew={!initial.id}
          audienceCount={audienceCount}
          alreadyRequiresSignature={initial.requireSignature}
          pending={pending}
          onCancel={() => setSaveOpen(false)}
          onSave={save}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save dialog: change note + Notify access group + Require signature
// ---------------------------------------------------------------------------

export function SaveDialog({
  isNew,
  audienceCount,
  alreadyRequiresSignature,
  pending,
  onCancel,
  onSave,
  title = "Save document",
  submitLabel = "Save",
  sendOnly = false,
  children,
}: {
  isNew: boolean;
  audienceCount: number;
  alreadyRequiresSignature: boolean;
  pending: boolean;
  onCancel: () => void;
  onSave: (opts: { changeNote: string; notify: boolean; requireSignature: boolean }) => void;
  title?: string;
  submitLabel?: string;
  /** "Send" without an edit: always notifies, the note is a message. */
  sendOnly?: boolean;
  children?: ReactNode;
}) {
  const [changeNote, setChangeNote] = useState("");
  const [notify, setNotify] = useState(false);
  const [requireSignature, setRequireSignature] = useState(false);
  const people = audienceCount === 1 ? "1 person" : `${audienceCount} people`;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={onCancel}>
      <div className="w-full rounded-t-2xl bg-white shadow-xl sm:max-w-md sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        </div>
        <div className="space-y-4 p-4">
          {children}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">
              {sendOnly ? "Message" : "What changed?"}{" "}
              <span className="text-slate-400">(optional — included in the notification)</span>
            </span>
            <textarea
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={isNew ? "e.g. New policy effective Nov 1" : "e.g. Updated the call-out deadline to 2 hours"}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>

          <label className={`flex items-start gap-2.5 ${sendOnly ? "hidden" : ""}`}>
            <input
              type="checkbox"
              checked={notify || requireSignature}
              disabled={requireSignature}
              onChange={(e) => setNotify(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-sm text-slate-700">
              <span className="font-medium">Notify access group</span>
              <span className="block text-xs text-slate-500">
                Sends an Ops notification to the {people} this document is addressed to.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={requireSignature}
              onChange={(e) => setRequireSignature(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-sm text-slate-700">
              <span className="font-medium">Require signature</span>
              <span className="block text-xs text-slate-500">
                {sendOnly ? `The ${people} with access must` : "Everyone with access must"} initial and date this
                version. It is recorded on their HR profile.
                {alreadyRequiresSignature
                  ? " Leave unchecked to keep existing signatures valid for a minor edit."
                  : ""}
              </span>
            </span>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Back
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onSave({ changeNote, notify: sendOnly || notify || requireSignature, requireSignature })}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? "Working…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({ editor }: { editor: Editor }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
      center: e.isActive({ textAlign: "center" }),
      right: e.isActive({ textAlign: "right" }),
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const setBlock = (v: string) => {
    const chain = editor.chain().focus();
    if (v === "p") chain.setParagraph().run();
    else chain.setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
  };

  const setLink = () => {
    const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt("Link address (https://…, mailto:…, or /resources/…). Leave empty to remove.", prev);
    if (url === null) return;
    const href = url.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const full = /^[a-z]+:|^\//i.test(href) ? href : `https://${href}`;
    if (!isSafeHref(full)) {
      window.alert("That link is not allowed. Use an https://, mailto:, tel: or /resources/ address.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: full }).run();
  };

  const addImage = async (file: File) => {
    setImageError(null);
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      setImageError("Use a PNG, JPEG, GIF or WebP image.");
      return;
    }
    try {
      const src = await imageToDataUrl(file);
      if (src.length > (MAX_IMAGE_BYTES * 4) / 3) {
        setImageError("That image is too large (3 MB max).");
        return;
      }
      editor.chain().focus().setImage({ src, alt: file.name.replace(/\.[^.]+$/, "") }).run();
    } catch {
      setImageError("Could not read that image.");
    }
  };

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50/95 px-2 py-1.5 backdrop-blur">
      <ToolButton label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!s.canUndo}>↶</ToolButton>
      <ToolButton label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!s.canRedo}>↷</ToolButton>
      <Divider />
      <select
        value={s.block}
        onChange={(e) => setBlock(e.target.value)}
        aria-label="Text style"
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
      >
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <Divider />
      <ToolButton label="Bold" active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <b>B</b>
      </ToolButton>
      <ToolButton label="Italic" active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <i>I</i>
      </ToolButton>
      <ToolButton label="Underline" active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <u>U</u>
      </ToolButton>
      <ToolButton label="Strikethrough" active={s.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <s>S</s>
      </ToolButton>
      <ToolButton label="Link" active={s.link} onClick={setLink}>🔗</ToolButton>
      <Divider />
      <ToolButton label="Bulleted list" active={s.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}>•≡</ToolButton>
      <ToolButton label="Numbered list" active={s.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1≡</ToolButton>
      <ToolButton label="Quote" active={s.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</ToolButton>
      <Divider />
      <ToolButton label="Align left" active={!s.center && !s.right} onClick={() => editor.chain().focus().unsetTextAlign().run()}>⇤</ToolButton>
      <ToolButton label="Align center" active={s.center} onClick={() => editor.chain().focus().setTextAlign("center").run()}>↔</ToolButton>
      <ToolButton label="Align right" active={s.right} onClick={() => editor.chain().focus().setTextAlign("right").run()}>⇥</ToolButton>
      <Divider />
      <ToolButton label="Insert image" onClick={() => fileRef.current?.click()}>🖼</ToolButton>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void addImage(f);
        }}
      />
      <ToolButton label="Horizontal line" onClick={() => editor.chain().focus().setHorizontalRule().run()}>―</ToolButton>
      <ToolButton
        label="Insert table"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        ▦
      </ToolButton>
      {s.table ? (
        <>
          <Divider />
          <ToolButton label="Add row below" onClick={() => editor.chain().focus().addRowAfter().run()}>+Row</ToolButton>
          <ToolButton label="Add column right" onClick={() => editor.chain().focus().addColumnAfter().run()}>+Col</ToolButton>
          <ToolButton label="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}>−Row</ToolButton>
          <ToolButton label="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()}>−Col</ToolButton>
          <ToolButton label="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}>✕▦</ToolButton>
        </>
      ) : null}
      <Divider />
      <ToolButton label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>⌫</ToolButton>
      {imageError ? <span className="ml-2 text-xs text-red-600">{imageError}</span> : null}
    </div>
  );
}

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`min-w-7 rounded-md px-1.5 py-1 text-xs font-medium transition disabled:opacity-40 ${
        active ? "bg-emerald-100 text-emerald-800" : "text-slate-600 hover:bg-slate-200/70"
      }`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />;

/** Read an image as a data URL, scaling anything wider than 1600px down. */
async function imageToDataUrl(file: File): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  if (file.type === "image/gif") return original;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = original;
  });
  const MAX_WIDTH = 1600;
  if (img.naturalWidth <= MAX_WIDTH && file.size <= 600 * 1024) return original;
  const scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return file.type === "image/png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85);
}
