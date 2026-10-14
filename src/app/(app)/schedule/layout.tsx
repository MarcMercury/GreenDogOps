import { requireUser } from "@/lib/auth/session";
import { ScheduleProviders } from "@/features/scheduling/shared/components/schedule-providers";
import { ScheduleTabs } from "@/features/scheduling/shared/components/schedule-tabs";

export default async function ScheduleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return (
    <ScheduleProviders>
      <div className="mx-auto max-w-[1600px] space-y-4">
        <ScheduleTabs />
        {children}
      </div>
    </ScheduleProviders>
  );
}
