"use server";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type {
  GlobalSearchResult,
  SearchGroup,
  SearchHit,
  WebSearchResult,
} from "./search-types";

/** Strip characters that would break a PostgREST `.or()` filter. */
function sanitize(raw: string): string {
  return raw.replace(/[,()%*]/g, " ").replace(/\s+/g, " ").trim();
}

function ilikeOr(columns: string[], term: string): string {
  return columns.map((c) => `${c}.ilike.%${term}%`).join(",");
}

function personName(r: {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  grid_name: string | null;
}): string {
  const composed = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
  return (
    r.full_name?.trim() ||
    composed ||
    r.preferred_name?.trim() ||
    r.grid_name?.trim() ||
    "Unnamed"
  );
}

async function searchInternal(term: string): Promise<{
  groups: SearchGroup[];
  count: number;
}> {
  const supabase = await createClient();

  const [people, orgs, contacts, influencers, partners] = await Promise.all([
    supabase
      .from("person")
      .select(
        "id, status, first_name, last_name, full_name, preferred_name, grid_name, email",
      )
      .or(
        ilikeOr(
          [
            "first_name",
            "last_name",
            "full_name",
            "preferred_name",
            "grid_name",
            "email",
          ],
          term,
        ),
      )
      .limit(10),
    supabase
      .from("crm_organization")
      .select("id, name, org_type, contact_name, email, city, state")
      .or(ilikeOr(["name", "contact_name", "email", "city"], term))
      .limit(10),
    supabase
      .from("crm_contact")
      .select(
        "id, contact_type, first_name, last_name, full_name, email, organization, school",
      )
      .or(
        ilikeOr(
          ["first_name", "last_name", "full_name", "email", "organization"],
          term,
        ),
      )
      .limit(10),
    supabase
      .from("marketing_influencers")
      .select("id, contact_name, pet_name, email, instagram_handle, status")
      .or(
        ilikeOr(["contact_name", "pet_name", "email", "instagram_handle"], term),
      )
      .limit(10),
    supabase
      .from("referral_partners")
      .select("id, name, hospital_name, contact_name, email, zone")
      .or(ilikeOr(["name", "hospital_name", "contact_name", "email"], term))
      .limit(10),
  ]);

  const hr: SearchHit[] = [];
  const ats: SearchHit[] = [];
  for (const p of people.data ?? []) {
    const name = personName(p);
    // Employees, contractors, and former staff live in the HR roster; only
    // prospects/applicants are still in the recruiting pipeline.
    const inRoster =
      p.status === "employee" ||
      p.status === "contractor" ||
      p.status === "former";
    const hit: SearchHit = {
      id: p.id,
      label: name,
      sublabel: p.email || p.status,
      href: inRoster ? `/hr/${p.id}` : `/ats/${p.id}`,
    };
    (inRoster ? hr : ats).push(hit);
  }

  const orgHits: SearchHit[] = (orgs.data ?? []).map((o) => ({
    id: o.id,
    label: o.name,
    sublabel:
      [o.contact_name, [o.city, o.state].filter(Boolean).join(", ")]
        .filter(Boolean)
        .join(" · ") || o.email,
    href: `/crm/org/${o.id}`,
  }));

  const contactHits: SearchHit[] = (contacts.data ?? []).map((c) => {
    const name =
      c.full_name?.trim() ||
      [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
      "Unnamed";
    return {
      id: c.id,
      label: name,
      sublabel: c.organization || c.school || c.email,
      href: `/crm/contact/${c.id}`,
    };
  });

  const influencerHits: SearchHit[] = (influencers.data ?? []).map((i) => ({
    id: i.id,
    label: i.contact_name || i.pet_name || i.instagram_handle || "Unnamed",
    sublabel: i.instagram_handle
      ? `@${i.instagram_handle.replace(/^@/, "")}`
      : i.email,
    href: `/crm/influencer/${i.id}`,
  }));

  const partnerHits: SearchHit[] = (partners.data ?? []).map((p) => ({
    id: p.id,
    label: p.name || p.hospital_name || "Unnamed clinic",
    sublabel:
      [p.contact_name, p.zone].filter(Boolean).join(" · ") || p.email,
    href: "/crm/referral",
  }));

  const groups: SearchGroup[] = [
    { key: "hr", label: "HR / Roster", icon: "👥", hits: hr },
    { key: "ats", label: "Recruiting (ATS)", icon: "🎯", hits: ats },
    { key: "orgs", label: "CRM — Organizations", icon: "🏢", hits: orgHits },
    { key: "contacts", label: "CRM — Contacts", icon: "📇", hits: contactHits },
    {
      key: "referral",
      label: "Referral Partners",
      icon: "🩺",
      hits: partnerHits,
    },
    {
      key: "influencers",
      label: "Influencers",
      icon: "⭐",
      hits: influencerHits,
    },
  ].filter((g) => g.hits.length > 0);

  const count = groups.reduce((sum, g) => sum + g.hits.length, 0);
  return { groups, count };
}

async function searchWeb(query: string): Promise<WebSearchResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return {
      ok: false,
      error: "Web search is unavailable (no OpenAI API key configured).",
    };
  }
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1")
    .replace(/\/+$/, "");

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-search-preview",
        web_search_options: {},
        messages: [
          {
            role: "system",
            content:
              "You are a research assistant for Green Dog, a veterinary business in the Los Angeles area. Answer the user's query concisely using current information from the web. If the query looks like a person or business name, surface useful public details. Always cite your sources.",
          },
          { role: "user", content: query },
        ],
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `Web search failed (HTTP ${res.status}).` };
    }

    const data = await res.json();
    const message = data?.choices?.[0]?.message;
    const answer: string = message?.content ?? "";
    const annotations: Array<{
      type?: string;
      url_citation?: { url?: string; title?: string };
    }> = message?.annotations ?? [];

    const seen = new Set<string>();
    const sources: { title: string; url: string }[] = [];
    for (const a of annotations) {
      const url = a?.url_citation?.url;
      if (a?.type !== "url_citation" || !url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ title: a.url_citation?.title || url, url });
    }

    if (!answer.trim()) {
      return { ok: false, error: "Web search returned no results." };
    }
    return { ok: true, answer, sources };
  } catch {
    return { ok: false, error: "Web search request failed." };
  }
}

export async function globalSearch(
  rawQuery: string,
  includeWeb: boolean,
): Promise<GlobalSearchResult> {
  await requireUser();

  const query = rawQuery.trim();
  const term = sanitize(query);

  let internal: SearchGroup[] = [];
  let internalCount = 0;
  if (term.length > 0) {
    const result = await searchInternal(term);
    internal = result.groups;
    internalCount = result.count;
  }

  const web = includeWeb && query.length > 0 ? await searchWeb(query) : null;

  return { query, internal, internalCount, web };
}
