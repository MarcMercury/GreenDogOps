import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
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
  const current = await getCurrentUser();
  if (!current) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    return <NoAccess email={user.email ?? null} />;
  }
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}
