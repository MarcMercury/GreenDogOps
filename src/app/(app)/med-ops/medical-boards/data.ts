import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface BoardLocation {
  id: string;
  name: string;
  display_name: string | null;
  short_code: string | null;
  color: string | null;
}

/** Active physical clinic locations that host medical boards. */
export async function getBoardLocations(): Promise<BoardLocation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("location")
    .select("id, name, display_name, short_code, color")
    .eq("is_active", true)
    .eq("kind", "clinic")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as BoardLocation[];
}

/** Resolve a location by its URL slug (short_code, case-insensitive) or id. */
export async function getBoardLocationBySlug(
  slug: string,
): Promise<BoardLocation | null> {
  const locations = await getBoardLocations();
  const target = slug.toLowerCase();
  return (
    locations.find(
      (l) => (l.short_code ?? "").toLowerCase() === target || l.id === slug,
    ) ?? null
  );
}
