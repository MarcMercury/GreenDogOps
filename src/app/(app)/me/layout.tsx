import { PageHeader } from "../_components/ui";
import { MeTabs } from "./me-tabs";

export default function MeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageHeader eyebrow="My Time" title="My Time" description="Clock in and out, see your schedule and check your hours." />
      <MeTabs />
      {children}
    </div>
  );
}
