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

const WEB_SEARCH_SYSTEM_PROMPT =
  "You are a research assistant for Green Dog, a veterinary business in the Los Angeles area. Answer the user's query concisely using current information from the web. If the query looks like a person or business name, surface useful public details. Always cite your sources.";

type Source = { title: string; url: string };

/** Thrown by a provider when it is rate-limited or unavailable so the chain
 *  falls through to the next provider. */
class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
  ) {
    super(message);
  }
}

function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    if (!s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ title: s.title || s.url, url: s.url });
  }
  return out;
}

// --- Provider: OpenAI (gpt-4o-mini-search-preview) --------------------------
async function searchOpenAI(query: string): Promise<{
  answer: string;
  sources: Source[];
}> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ProviderError("OpenAI", "no API key configured");

  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1")
    .replace(/\/+$/, "");

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_SEARCH_MODEL || "gpt-4o-mini-search-preview",
      web_search_options: {},
      messages: [
        { role: "system", content: WEB_SEARCH_SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
    }),
  });

  if (!res.ok) {
    throw new ProviderError("OpenAI", `HTTP ${res.status}`);
  }

  const data = await res.json();
  const message = data?.choices?.[0]?.message;
  const answer: string = message?.content ?? "";
  const annotations: Array<{
    type?: string;
    url_citation?: { url?: string; title?: string };
  }> = message?.annotations ?? [];

  const sources: Source[] = [];
  for (const a of annotations) {
    const url = a?.url_citation?.url;
    if (a?.type !== "url_citation" || !url) continue;
    sources.push({ title: a.url_citation?.title || url, url });
  }

  if (!answer.trim()) throw new ProviderError("OpenAI", "empty response");
  return { answer, sources };
}

// --- Provider: Anthropic Claude (web_search tool) ---------------------------
async function searchClaude(query: string): Promise<{
  answer: string;
  sources: Source[];
}> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ProviderError("Claude", "no API key configured");

  const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com")
    .replace(/\/+$/, "");

  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
      max_tokens: 1024,
      system: WEB_SEARCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: query }],
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 5 },
      ],
    }),
  });

  if (!res.ok) {
    throw new ProviderError("Claude", `HTTP ${res.status}`);
  }

  const data = await res.json();
  const content: Array<{
    type?: string;
    text?: string;
    citations?: Array<{ url?: string; title?: string }>;
  }> = data?.content ?? [];

  let answer = "";
  const sources: Source[] = [];
  for (const block of content) {
    if (block?.type === "text" && block.text) {
      answer += block.text;
      for (const c of block.citations ?? []) {
        if (c?.url) sources.push({ title: c.title || c.url, url: c.url });
      }
    }
  }

  if (!answer.trim()) throw new ProviderError("Claude", "empty response");
  return { answer, sources };
}

// --- Provider: Google Gemini (google_search grounding) ----------------------
async function searchGemini(query: string): Promise<{
  answer: string;
  sources: Source[];
}> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new ProviderError("Google", "no API key configured");

  const base = (
    process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"
  ).replace(/\/+$/, "");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const res = await fetch(
    `${base}/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: WEB_SEARCH_SYSTEM_PROMPT }],
        },
        contents: [{ role: "user", parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
      }),
    },
  );

  if (!res.ok) {
    throw new ProviderError("Google", `HTTP ${res.status}`);
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const parts: Array<{ text?: string }> = candidate?.content?.parts ?? [];
  const answer = parts
    .map((p) => p?.text ?? "")
    .join("")
    .trim();

  const chunks: Array<{ web?: { uri?: string; title?: string } }> =
    candidate?.groundingMetadata?.groundingChunks ?? [];
  const sources: Source[] = [];
  for (const c of chunks) {
    const url = c?.web?.uri;
    if (url) sources.push({ title: c.web?.title || url, url });
  }

  if (!answer) throw new ProviderError("Google", "empty response");
  return { answer, sources };
}

// --- Provider: Tavily (native web search, LLM-quota independent) ------------
async function searchTavily(query: string): Promise<{
  answer: string;
  sources: Source[];
}> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new ProviderError("Tavily", "no API key configured");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: "advanced",
      include_answer: "advanced",
      max_results: 6,
    }),
  });

  if (!res.ok) {
    throw new ProviderError("Tavily", `HTTP ${res.status}`);
  }

  const data = await res.json();
  const answer: string = (data?.answer ?? "").trim();
  const results: Array<{ url?: string; title?: string }> = data?.results ?? [];
  const sources: Source[] = [];
  for (const r of results) {
    if (r?.url) sources.push({ title: r.title || r.url, url: r.url });
  }

  if (!answer) throw new ProviderError("Tavily", "empty response");
  return { answer, sources };
}

/**
 * Runs web search across providers, falling through to the next whenever one
 * is rate-limited, unconfigured, or fails. The default order leads with free
 * grounding (Google) and a quota-independent search API (Tavily) so paid
 * OpenAI / Claude tokens are only spent as a last resort; override the order
 * with WEB_SEARCH_PROVIDER_ORDER. Returns the first working result, or a
 * combined error if all fail.
 */
async function searchWeb(query: string): Promise<WebSearchResult> {
  const registry: Record<
    string,
    (q: string) => Promise<{ answer: string; sources: Source[] }>
  > = {
    google: searchGemini,
    tavily: searchTavily,
    openai: searchOpenAI,
    claude: searchClaude,
  };
  const label: Record<string, string> = {
    google: "Google",
    tavily: "Tavily",
    openai: "OpenAI",
    claude: "Claude",
  };
  // Free grounding (Google) and quota-independent search (Tavily) lead so paid
  // OpenAI / Claude tokens are only spent when the free tiers are unavailable.
  // Override with WEB_SEARCH_PROVIDER_ORDER (comma-separated, e.g.
  // "openai,claude,google,tavily").
  const defaultOrder = ["google", "tavily", "openai", "claude"];
  const raw = process.env.WEB_SEARCH_PROVIDER_ORDER;
  const wanted = raw
    ? raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((n) => n in registry)
    : [];
  const order = [
    ...wanted,
    ...defaultOrder.filter((n) => !wanted.includes(n)),
  ];
  const providers = order.map((name) => ({
    name: label[name],
    run: registry[name],
  }));

  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const { answer, sources } = await provider.run(query);
      return {
        ok: true,
        answer,
        sources: dedupeSources(sources),
        provider: provider.name,
      };
    } catch (err) {
      const reason =
        err instanceof ProviderError
          ? err.message
          : err instanceof Error
            ? err.message
            : "request failed";
      failures.push(`${provider.name}: ${reason}`);
      // Fall through to the next provider.
    }
  }

  return {
    ok: false,
    error:
      failures.length > 0
        ? `Web search unavailable. Tried ${failures.join("; ")}.`
        : "Web search is unavailable (no provider configured).",
  };
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
