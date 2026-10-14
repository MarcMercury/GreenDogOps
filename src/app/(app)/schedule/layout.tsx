import { requireUser } from "@/lib/auth/session";
import { ScheduleTabs } from "@/features/scheduling/shared/components/schedule-tabs";

export default async function ScheduleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ScheduleTabs />
      {children}
    </div>
  );
}
