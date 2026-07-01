import { redirect } from "next/navigation";

// The Business CRM has been merged into the unified Vendor & Partner CRM.
export default function BusinessCrmPage() {
  redirect("/crm/vendor");
}
