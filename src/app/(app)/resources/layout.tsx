import { PageHeader } from "../_components/ui";
import { ResourcesTabs } from "./resources-tabs";

export default function ResourcesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Resources"
        title="Resources"
        description="Search everything in Green Dog Ops — and the web — and browse company policies."
      />
      <ResourcesTabs />
      {children}
    </div>
  );
}
