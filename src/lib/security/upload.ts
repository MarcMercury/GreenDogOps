/**
 * Content types for stored uploads are derived from the file extension against
 * an allow-list — never from the browser-supplied MIME type, which an attacker
 * controls. Anything not on the list (including .html, .svg, .xml, .js) is
 * stored as application/octet-stream, so a signed URL downloads it instead of
 * rendering it.
 */
const SAFE_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  rtf: "application/rtf",
  txt: "text/plain",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  zip: "application/zip",
  eml: "message/rfc822",
};

export const FALLBACK_CONTENT_TYPE = "application/octet-stream";

/** Lower-case extension without the dot, or "" when there is none. */
export function fileExtension(fileName: string | null | undefined): string {
  const name = (fileName ?? "").trim().toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1);
}

/** The Content-Type to store an uploaded file under. */
export function safeUploadContentType(
  fileName: string | null | undefined,
  suppliedType?: string | null,
): string {
  const byExtension = SAFE_CONTENT_TYPES[fileExtension(fileName)];
  if (byExtension) return byExtension;
  // No recognised extension: keep the supplied type only if it is one of the
  // safe types above (e.g. a Gmail attachment named "resume" sent as PDF).
  const supplied = (suppliedType ?? "").split(";")[0].trim().toLowerCase();
  if (supplied && SAFE_TYPE_VALUES.has(supplied)) return supplied;
  return FALLBACK_CONTENT_TYPE;
}

const SAFE_TYPE_VALUES = new Set(Object.values(SAFE_CONTENT_TYPES));

/** True when the stored type would be an image (used for public banner uploads). */
export function isSafeImageUpload(
  fileName: string | null | undefined,
  suppliedType?: string | null,
): boolean {
  return safeUploadContentType(fileName, suppliedType).startsWith("image/");
}
