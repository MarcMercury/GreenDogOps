import type { Metadata } from "next";
import { PublicShell } from "@/lib/ats/public-shell";
import { OptInForm } from "./opt-in-form";

export const metadata: Metadata = { title: "Text messages — Green Dog Dental" };

export default function TextsOptInPage() {
  return (
    <PublicShell
      title="Get texts from Green Dog Dental"
      intro={
        "Green Dog Dental Recruiting & HR sends job candidates and team members texts about interviews, schedules and HR notices. " +
        "Signing up is completely optional. You'll get the same information by email or phone either way, and saying no never affects your application or your job."
      }
    >
      <OptInForm />
    </PublicShell>
  );
}
