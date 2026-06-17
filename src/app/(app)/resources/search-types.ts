// Shared types for the Resources global search (internal data + AI web search).

export interface SearchHit {
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
}

export interface SearchGroup {
  key: string;
  label: string;
  icon: string;
  hits: SearchHit[];
}

export type WebSearchResult =
  | { ok: true; answer: string; sources: { title: string; url: string }[] }
  | { ok: false; error: string };

export interface GlobalSearchResult {
  query: string;
  internal: SearchGroup[];
  internalCount: number;
  web: WebSearchResult | null;
}
