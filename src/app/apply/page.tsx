import type { Metadata } from "next";
import { ApplicationPage } from "./application-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Apply — Green Dog" };

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ApplicationPage slug={null} searchParams={await searchParams} />;
}
