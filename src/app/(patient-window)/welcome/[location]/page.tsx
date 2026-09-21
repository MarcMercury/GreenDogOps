import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { canAccessModule } from "@/lib/auth/permissions";
import {
  getBoardLocationBySlug,
  getWelcomeGuests,
} from "../../../(app)/med-ops/medical-boards/data";
import { WelcomeBoard } from "./welcome-board";

export const dynamic = "force-dynamic";

function todayLA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function WelcomeBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ location: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const [{ location: slug }, { date: dateParam }] = await Promise.all([
    params,
    searchParams,
  ]);

  const current = await getCurrentUser();
  if (!current || !canAccessModule(current.appUser, "med_boards")) notFound();

  const location = await getBoardLocationBySlug(slug);
  if (!location) notFound();

  const date = dateParam && ISO_DATE.test(dateParam) ? dateParam : todayLA();
  const guests = await getWelcomeGuests(location.id, date);

  return (
    <WelcomeBoard
      guests={guests}
      locationId={location.id}
      locationName={location.display_name ?? location.name}
      date={date}
    />
  );
}
