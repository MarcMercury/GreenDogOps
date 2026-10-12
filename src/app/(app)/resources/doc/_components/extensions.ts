import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { isSafeHref } from "@/lib/resources/content";

/**
 * One extension set for the editor and the viewer, matching the allow-list in
 * src/lib/resources/content.ts (sanitizeDocument) — add a node type in both.
 */
export function documentExtensions({ editable }: { editable: boolean }) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: !editable,
        autolink: editable,
        defaultProtocol: "https",
        isAllowedUri: (url) => isSafeHref(url),
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" },
      },
    }),
    Image.configure({ allowBase64: true, inline: false }),
    TableKit.configure({ table: { resizable: false } }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
  ];
}
