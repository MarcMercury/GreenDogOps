import { redirect } from "next/navigation";
import { getAuthState, SELF_SERVICE_HOME } from "@/lib/auth/session";
import { NoAccess } from "../(app)/_components/no-access";
import { ViewAsBanner } from "../(app)/_components/view-as-switcher";

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
  if (state.kind === "self_service") redirect(SELF_SERVICE_HOME);
  const viewAs = state.current.viewAs;
  return (
    <div className="min-h-screen bg-slate-50">
      {/* No sidebar here, so the switch-back control must live in the page. */}
      {viewAs ? (
        <div className="p-3 pb-0">
          <ViewAsBanner
            viewAs={{
              kind: viewAs.kind,
              label: viewAs.label,
              email: viewAs.kind === "user" ? state.current.email : null,
              role: state.current.appUser.role,
            }}
          />
        </div>
      ) : null}
      {children}
    </div>
  );
}
