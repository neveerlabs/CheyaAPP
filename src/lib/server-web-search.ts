import type { GeminiApiKey } from "./supabase";
import { getServerEnvironmentVariable } from "./server-supabase";
import { getPageMetadata } from "./server-page";
import { refineGeminiWebQuery, searchGeminiWeb } from "./gemini";

export interface WebSearchSource {
  title: string;
  url: string;
  excerpt: string;
}

export interface WebSearchResult {
  query: string;
  providers: string[];
  refinementPasses: number;
  sources: WebSearchSource[];
  findings: string[];
}

type SearchResponse = {
  sources: WebSearchSource[];
  findings: string[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueSources(sources: WebSearchSource[]): WebSearchSource[] {
  const unique = new Map<string, WebSearchSource>();
  for (const source of sources) {
    if (!/^https?:\/\//i.test(source.url)) continue;
    const current = unique.get(source.url);
    if (!current || current.excerpt.length < source.excerpt.length) {
      unique.set(source.url, {
        title: source.title.slice(0, 300),
        url: source.url,
        excerpt: source.excerpt.slice(0, 6000),
      });
    }
  }
  return [...unique.values()];
}

async function retryProvider<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable =
        !(error instanceof Error) ||
        /HTTP (408|425|429|5\d\d)|network|timeout|fetch failed|aborted/i.test(error.message);
      if (!retryable || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw new Error(
    `${label} search failed after retries: ${
      lastError instanceof Error ? lastError.message : "Unknown provider error."
    }`,
  );
}

async function tavilySearch(query: string): Promise<SearchResponse> {
  const apiKey = getServerEnvironmentVariable("TAVILY_API_KEY");
  if (!apiKey) throw new Error("Tavily is not configured.");
  return retryProvider("Tavily", async () => {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "advanced",
        max_results: 10,
        include_raw_content: true,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Tavily returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    if (!isObject(payload) || !Array.isArray(payload.results)) {
      throw new Error("Tavily returned an invalid search response.");
    }
    const sources: WebSearchSource[] = payload.results.flatMap((result) => {
      if (!isObject(result) || typeof result.url !== "string") return [];
      const excerpt =
        (typeof result.raw_content === "string" && result.raw_content) ||
        (typeof result.content === "string" && result.content) ||
        "";
      return [
        {
          title: typeof result.title === "string" ? result.title : result.url,
          url: result.url,
          excerpt,
        },
      ];
    });
    return {
      sources: uniqueSources(sources),
      findings: sources.map((source) => `${source.title}: ${source.excerpt}`).filter(Boolean),
    };
  });
}

async function braveSearch(query: string): Promise<SearchResponse> {
  const apiKey = getServerEnvironmentVariable("BRAVE_SEARCH_API_KEY");
  if (!apiKey) throw new Error("Brave Search is not configured.");
  return retryProvider("Brave Search", async () => {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "10");
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Brave Search returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    const web = isObject(payload) && isObject(payload.web) ? payload.web : null;
    if (!web || !Array.isArray(web.results)) {
      throw new Error("Brave Search returned an invalid search response.");
    }

    const rawSources: WebSearchSource[] = web.results.flatMap((result) => {
      if (!isObject(result) || typeof result.url !== "string") return [];
      return [
        {
          title: typeof result.title === "string" ? result.title : result.url,
          url: result.url,
          excerpt: typeof result.description === "string" ? result.description : "",
        },
      ];
    });
    const inspected = await Promise.allSettled(
      rawSources.slice(0, 5).map(async (source) => {
        const page = await getPageMetadata(source.url);
        return {
          ...source,
          title: page.title || source.title,
          excerpt: page.content || source.excerpt,
        };
      }),
    );
    const sources = uniqueSources([
      ...inspected.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
      ...rawSources,
    ]);
    return {
      sources,
      findings: sources.map((source) => `${source.title}: ${source.excerpt}`).filter(Boolean),
    };
  });
}

async function googleGroundedSearch(
  query: string,
  keys: GeminiApiKey[],
): Promise<SearchResponse> {
  const errors: string[] = [];
  for (const key of keys) {
    try {
      const result = await retryProvider("Google Search grounding", () =>
        searchGeminiWeb(key, query),
      );
      return {
        sources: result.sources.map((source) => ({
          ...source,
          excerpt: result.findings.join("\n\n"),
        })),
        findings: result.findings,
      };
    } catch (error) {
      errors.push(
        `${key.id}: ${error instanceof Error ? error.message : "Unknown provider error."}`,
      );
    }
  }
  throw new Error(
    errors.length > 0
      ? `Google Search grounding failed for every configured Gemini key. ${errors.join(" ")}`
      : "Google Search grounding has no configured Gemini keys.",
  );
}

async function searchAlternativeProviders(
  query: string,
  keys: GeminiApiKey[],
): Promise<{ providers: string[]; sources: WebSearchSource[]; findings: string[] }> {
  const providers: Array<{ name: string; search: (query: string) => Promise<SearchResponse> }> = [
    ...(getServerEnvironmentVariable("TAVILY_API_KEY")
      ? [{ name: "Tavily", search: tavilySearch }]
      : []),
    ...(getServerEnvironmentVariable("BRAVE_SEARCH_API_KEY")
      ? [{ name: "Brave Search", search: braveSearch }]
      : []),
  ];
  if (providers.length === 0) {
    throw new Error("Configure TAVILY_API_KEY or BRAVE_SEARCH_API_KEY for search failover.");
  }

  const usedProviders = new Set<string>();
  const sources: WebSearchSource[] = [];
  const findings: string[] = [];
  const providerErrors: string[] = [];
  const fallbackModifiers = [
    "official documentation and primary sources",
    "latest verified details and dates",
    "independent authoritative sources",
    "recent changes and source comparisons",
  ];
  let refinedQuery = query;

  for (let pass = 1; pass <= 5; pass += 1) {
    let passCompleted = false;
    for (const provider of providers) {
      try {
        const result = await provider.search(refinedQuery);
        if (result.sources.length === 0) {
          throw new Error("The provider returned no usable results.");
        }
        usedProviders.add(provider.name);
        sources.push(...result.sources);
        findings.push(...result.findings.slice(0, 6));
        passCompleted = true;
        break;
      } catch (error) {
        providerErrors.push(
          `${provider.name} pass ${pass}: ${
            error instanceof Error ? error.message : "Unknown provider error."
          }`,
        );
        continue;
      }
    }
    if (!passCompleted) continue;
    if (pass < 5) {
      try {
        refinedQuery = await retryProvider("Gemini query refinement", () =>
          refineGeminiWebQuery(keys, query, refinedQuery, findings),
        );
      } catch {
        refinedQuery = `${query} ${fallbackModifiers[pass - 1]}`.slice(0, 1200);
      }
    }
  }

  const unique = uniqueSources(sources);
  if (unique.length < 3) {
    throw new Error(
      `Alternative providers returned only ${unique.length} distinct source(s) across five refinement passes. ${providerErrors.slice(-6).join(" ")}`,
    );
  }
  return {
    providers: [...usedProviders],
    sources: unique,
    findings,
  };
}

export async function searchWebWithFallback(
  query: string,
  keys: GeminiApiKey[],
): Promise<WebSearchResult> {
  const normalizedQuery = query.trim().slice(0, 1200);
  if (!normalizedQuery) throw new Error("Provide a non-empty web search query.");

  const providers: Array<{ name: string; search: () => Promise<SearchResponse> }> = [
    { name: "Google Search", search: () => googleGroundedSearch(normalizedQuery, keys) },
  ];
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      const result = await provider.search();
      const sources = uniqueSources(result.sources);
      if (sources.length < 3) {
        errors.push(`${provider.name} returned fewer than three distinct sources.`);
        continue;
      }
      return {
        query: normalizedQuery,
        providers: [provider.name],
        refinementPasses: 5,
        sources: sources.slice(0, 15),
        findings: result.findings.slice(0, 15),
      };
    } catch (error) {
      errors.push(
        `${provider.name}: ${
          error instanceof Error ? error.message : "Unknown provider error."
        }`,
      );
    }
  }

  try {
    const result = await searchAlternativeProviders(normalizedQuery, keys);
    return {
      query: normalizedQuery,
      providers: result.providers,
      refinementPasses: 5,
      sources: result.sources.slice(0, 15),
      findings: result.findings.slice(0, 15),
    };
  } catch (error) {
    errors.push(
      `Backup providers: ${error instanceof Error ? error.message : "Unknown provider error."}`,
    );
  }

  throw new Error(
    `Web search could not return at least three sources. ${errors.join(" ")}` ||
      "Web search providers returned no usable results.",
  );
}
