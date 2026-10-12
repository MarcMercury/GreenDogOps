"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import type { DocNode } from "@/lib/resources/content";
import { documentExtensions } from "./extensions";

/** Read-only rendering of a native document. */
export function DocumentViewer({ content }: { content: DocNode }) {
  const editor = useEditor({
    editable: false,
    immediatelyRender: false,
    extensions: documentExtensions({ editable: false }),
    content,
  });

  if (!editor) {
    return (
      <div className="space-y-3" aria-busy>
        {[90, 75, 85, 60].map((w) => (
          <div key={w} className="h-3 animate-pulse rounded bg-slate-100" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  return (
    <div className="gdo-doc">
      <EditorContent editor={editor} />
    </div>
  );
}
