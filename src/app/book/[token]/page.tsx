import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatWhen, loadInterviewer, slotsForInvite, type InviteRow } from "@/lib/ats/booking";
import { DEFAULT_TIMEZONE, candidateInterviewTitle, groupSlotsByDay, zoneAbbreviation } from "@/lib/ats/scheduling";
import { PublicNotice, PublicShell } from "@/lib/ats/public-shell";
import { SlotPicker } from "./slot-picker";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Schedule your interview — Green Dog", robots: { index: false } };

export default async function BookPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data } = await admin.from("interview_invite").select("*").eq("token", token).maybeSingle();
  const invite = data as InviteRow | null;

  if (!invite || invite.status === "cancelled") {
    return (
      <PublicShell title="Schedule your interview">
        <PublicNotice icon="🔗" title="This link is no longer active" body="Reply to the email you received and we'll send a new one." />
      </PublicShell>
    );
  }

  const title = candidateInterviewTitle(invite.interview_type);
  const headline = `Green Dog would like to schedule a ${invite.duration_minutes}-minute ${title.toLowerCase()} with you.`;

  if (invite.status === "booked") {
    const tz = (await loadInterviewer(invite.host_user_id, admin))?.timezone ?? DEFAULT_TIMEZONE;
    return (
      <PublicShell title="You're booked">
        <PublicNotice
          icon="✅"
          title={`${title} confirmed`}
          body={`${invite.booked_start ? formatWhen(new Date(invite.booked_start), tz) : ""}${invite.host_name ? `\nWith ${invite.host_name}` : ""}\n\nNeed to change it? Reply to your confirmation email.`}
        />
      </PublicShell>
    );
  }

  const result = await slotsForInvite(invite);
  if (!result.ok) {
    return (
      <PublicShell title="Schedule your interview" intro={headline}>
        <PublicNotice icon="🗓️" title="We couldn't load available times right now" body="Please try again in a few minutes, or reply to the email you received." />
      </PublicShell>
    );
  }
  const days = groupSlotsByDay(result.slots, result.timeZone);
  const intro = [headline, invite.message?.trim(), invite.location ? `Where: ${invite.location}` : null]
    .filter(Boolean)
    .join("\n\n");

  return (
    <PublicShell title="Schedule your interview" intro={intro}>
      {days.length === 0 ? (
        <PublicNotice icon="🗓️" title="No times are open right now" body="Reply to the email you received and we'll find a time that works." />
      ) : (
        <SlotPicker token={token} days={days} zone={zoneAbbreviation(new Date(), result.timeZone)} />
      )}
    </PublicShell>
  );
}
