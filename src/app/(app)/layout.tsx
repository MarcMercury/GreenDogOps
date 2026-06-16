import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "./_components/sidebar-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <SidebarNav email={user.email ?? null} />
      <main className="flex-1 overflow-auto px-6 py-8 sm:px-8 lg:px-10">
        {children}
      </main>
    </div>
  );
}
