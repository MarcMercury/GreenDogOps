import type { Metadata } from "next";
import { ApplicationPage } from "../application-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Apply — Green Dog" };

export default async function ApplySlugPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  return <ApplicationPage slug={slug} searchParams={await searchParams} />;
}
