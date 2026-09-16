import { redirect } from "next/navigation";

// Marketing Vendors moved into Marketing Management → Resources; this route is
// kept so older links and bookmarks land in the right place.
export default function MarketingVendorCrmPage() {
  redirect("/marketing?tab=resources");
}
