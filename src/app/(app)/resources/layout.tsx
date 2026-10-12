import Link from "next/link";
import { PageHeader } from "../_components/ui";

export default function ResourcesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Resources"
        title="Resources"
        description="Company policies, protocols and documents."
        actions={
          <Link
            href="/ask-ziggy"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
          >
            Have a question? Ask Ziggy →
          </Link>
        }
      />
      {children}
    </div>
  );
}
