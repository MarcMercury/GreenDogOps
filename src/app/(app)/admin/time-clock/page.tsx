import { redirect } from "next/navigation";

// Time-clock settings live on each clinic's card under Admin ▸ Locations.
export default function AdminTimeClockRedirect() {
  redirect("/admin/locations");
}
