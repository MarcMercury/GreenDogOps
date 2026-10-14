import { getCurrentUser } from "@/lib/auth/session";
import { canApproveTime, canReviewTimeClock } from "@/lib/auth/permissions";
import { getLocationNames } from "@/lib/timeclock/server";
import { getMissingPunches, getPendingCorrections, getPendingOffsite } from "@/lib/timeclock/review";
import { RestrictedNotice } from "@/features/scheduling/shared/components/restricted-notice";
import { CorrectionQueue } from "@/features/scheduling/time-clock/components/correction-queue";
import { MissingPunchQueue } from "@/features/scheduling/time-clock/components/missing-punch-queue";
import { OffsiteQueue } from "@/features/scheduling/time-clock/components/offsite-queue";
import { PageHeader } from "../../_components/ui";

export const dynamic = "force-dynamic";

export default async function TimeClockQueuesPage() {
  const current = await getCurrentUser({ allowPreview: true });
  if (!current || !canReviewTimeClock(current.appUser)) {
    return (
      <RestrictedNotice>
        The time-clock queues are for timecard approvers (Owner, Admin, Executive, HR / Manager) and Schedule Admins.
      </RestrictedNotice>
    );
  }
  const approver = canApproveTime(current.appUser);
  const [offsite, corrections, missing, locationNames] = await Promise.all([
    getPendingOffsite(),
    getPendingCorrections(),
    getMissingPunches(),
    getLocationNames(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Scheduling"
        title="Time Clock"
        description={
          approver
            ? "Approve off-site punches and correction requests, and fix missing punches. Punches are never edited — every change is recorded alongside the original."
            : "Exceptions that need an approver. Schedule Admins can see them but only Owners, Admins, Executives and HR / Managers can change hours."
        }
      />

      <OffsiteQueue items={offsite} approver={approver} locationNames={locationNames} />
      <CorrectionQueue items={corrections} approver={approver} />
      <MissingPunchQueue items={missing} approver={approver} />
    </div>
  );
}
