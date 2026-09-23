import { redirect } from "next/navigation";

// QR codes are managed as a tab on Marketing Management now; this keeps old
// bookmarks and in-app links working.
export default function QrCodeManagementRedirect() {
  redirect("/marketing?tab=qr_codes");
}
