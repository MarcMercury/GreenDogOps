import "server-only";

// ---------------------------------------------------------------------------
// Text-only LLM caller with provider fallback.
//
// Mirrors the fallback chain used by the ATS resume parser (src/lib/ats/import.ts)
// but for plain text prompts: try each configured provider in order until one
// answers, so a single provider's quota never breaks the feature. Providers with
// no API key are skipped silently. Order override: LLM_PROVIDER_ORDER.
// ---------------------------------------------------------------------------

export type LlmTextResult =
  | { ok: true; content: string; provider: string }
  | { ok: false; error: string };

type ProviderCall = { ok: true; content: string } | { ok: false; error: string };

export interface LlmTextOptions {
  /** Ask the provider for a JSON object response. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

interface Provider {
  name: string;
  isConfigured: () => boolean;
  call: (system: string, user: string, opts: LlmTextOptions) => Promise<ProviderCall>;
}

async function callOpenAICompatible(
  cfg: { baseUrl: string; apiKey: string; model: string; extraHeaders?: Record<string, string> },
  system: string,
  user: string,
  opts: LlmTextOptions,
): Promise<ProviderCall> {
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        ...(cfg.extraHeaders ?? {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxTokens ?? 2048,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}` };
    }
    const data = await res.json();
    const out: string = data?.choices?.[0]?.message?.content ?? "";
    return out.trim() ? { ok: true, content: out } : { ok: false, error: "empty response" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

async function callGemini(system: string, user: string, opts: LlmTextOptions): Promise<ProviderCall> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            temperature: opts.temperature ?? 0,
            maxOutputTokens: opts.maxTokens ?? 2048,
            ...(opts.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}` };
    }
    const data = await res.json();
    const out: string =
      data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    return out.trim() ? { ok: true, content: out } : { ok: false, error: "empty response" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

async function callAnthropic(system: string, user: string, opts: LlmTextOptions): Promise<ProviderCall> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0,
        system: opts.json ? `${system}\nRespond with a single JSON object and nothing else.` : system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}` };
    }
    const data = await res.json();
    const out: string = data?.content?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    return out.trim() ? { ok: true, content: out } : { ok: false, error: "empty response" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

const PROVIDERS: Record<string, Provider> = {
  gemini: {
    name: "Gemini",
    isConfigured: () => Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    call: callGemini,
  },
  groq: {
    name: "Groq",
    isConfigured: () => Boolean(process.env.GROQ_API_KEY),
    call: (s, u, o) =>
      callOpenAICompatible(
        {
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: process.env.GROQ_API_KEY || "",
          model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        },
        s,
        u,
        o,
      ),
  },
  openrouter: {
    name: "OpenRouter",
    isConfigured: () => Boolean(process.env.OPENROUTER_API_KEY),
    call: (s, u, o) =>
      callOpenAICompatible(
        {
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: process.env.OPENROUTER_API_KEY || "",
          model: process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-exp:free",
          extraHeaders: {
            "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://greendogops.app",
            "X-Title": "GreenDogOps",
          },
        },
        s,
        u,
        o,
      ),
  },
  openai: {
    name: "OpenAI",
    isConfigured: () => Boolean(process.env.OPENAI_API_KEY),
    call: (s, u, o) =>
      callOpenAICompatible(
        {
          baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
          apiKey: process.env.OPENAI_API_KEY || "",
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          extraHeaders: process.env.OPENAI_PROJECT_ID
            ? { "OpenAI-Project": process.env.OPENAI_PROJECT_ID }
            : undefined,
        },
        s,
        u,
        o,
      ),
  },
  anthropic: {
    name: "Anthropic",
    isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
    call: callAnthropic,
  },
};

const DEFAULT_ORDER = ["gemini", "groq", "openrouter", "openai", "anthropic"];

function providerOrder(): string[] {
  const raw = process.env.LLM_PROVIDER_ORDER;
  if (!raw) return DEFAULT_ORDER;
  const wanted = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((n) => n in PROVIDERS);
  return [...wanted, ...DEFAULT_ORDER.filter((n) => !wanted.includes(n))];
}

/** True when at least one provider has an API key configured. */
export function hasLlmProvider(): boolean {
  return providerOrder().some((n) => PROVIDERS[n]?.isConfigured());
}

/** Strip ```json fences some models wrap around JSON output. */
export function unwrapJson(s: string): string {
  const fenced = s.match(/```(?:json|sql)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : s).trim();
}

export async function callTextLLM(
  system: string,
  user: string,
  opts: LlmTextOptions = {},
): Promise<LlmTextResult> {
  const configured = providerOrder()
    .map((n) => PROVIDERS[n])
    .filter((p): p is Provider => Boolean(p) && p.isConfigured());

  if (!configured.length) {
    return {
      ok: false,
      error:
        "No AI provider is configured. Set one of GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.",
    };
  }

  const failures: string[] = [];
  for (const provider of configured) {
    const res = await provider.call(system, user, opts);
    if (res.ok) return { ok: true, content: res.content, provider: provider.name };
    failures.push(`${provider.name} (${res.error})`);
  }
  return { ok: false, error: `All AI providers failed. Tried: ${failures.join("; ")}.` };
}
