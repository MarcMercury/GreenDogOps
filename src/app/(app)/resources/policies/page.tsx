import { redirect } from "next/navigation";

// The library used to live on a "Policies" tab; it is now the Resources page.
export default function PoliciesRedirect() {
  redirect("/resources");
}
