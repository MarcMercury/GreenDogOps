/**
 * Hand the browser a CSV file to save. BOM-prefixed so Excel opens it as UTF-8.
 * Browser-only (Blob + anchor click); call from a client component.
 */
export function downloadCsvFile(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
