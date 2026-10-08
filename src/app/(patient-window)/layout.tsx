import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth/session";
import { NoAccess } from "../(app)/_components/no-access";

/**
 * Chromeless layout for the launched patient window. These tabs get dragged
 * onto the treatment-room TVs, so there is no sidebar or app header competing
 * with the patient record.
 */
export default async function PatientWindowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = await getAuthState();
  if (state.kind === "anon") redirect("/login");
  if (state.kind === "mfa_challenge" || state.kind === "mfa_enroll") {
    redirect("/login/mfa");
  }
  if (state.kind === "not_gdo") return <NoAccess email={state.email} />;
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}
