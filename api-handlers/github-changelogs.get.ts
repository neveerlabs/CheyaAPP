import { createError, defineEventHandler, getQuery, setResponseHeader } from "nitro/h3";
import { getServerEnvironmentVariable } from "../src/lib/server-supabase";

const REPOSITORY_API = "https://api.github.com/repos/neveerlabs/CheyaAPP";
const PAGE_SIZE = 100;
const HISTORY_CACHE_MS = 10 * 60 * 1000;
const SUMMARY_CACHE_MS = 24 * 60 * 60 * 1000;
const PATCH_CACHE_MS = 60 * 60 * 1000;
const RELEASE_CACHE_MS = 60 * 60 * 1000;
const MAX_CACHED_DETAILS = 500;

type CacheEntry<T> = { expiresAt: number; value: T };
type GithubReleaseResponse = { release: unknown | null };
type CommitHistoryResponse = {
  commits: unknown[];
  remaining: string | null;
};

const historyCache = new Map<string, CacheEntry<CommitHistoryResponse>>();
const commitDetailCache = new Map<string, CacheEntry<unknown>>();
const historyRequests = new Map<string, Promise<CommitHistoryResponse>>();
const releaseCache = new Map<string, CacheEntry<GithubReleaseResponse>>();

function pruneExpiredCache<T>(cache: Map<string, CacheEntry<T>>): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > MAX_CACHED_DETAILS) {
    const firstKey = cache.keys().next().value;
    if (firstKey === undefined) break;
    cache.delete(firstKey);
  }
}

function cacheValue<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttl: number,
): T {
  cache.set(key, { expiresAt: Date.now() + ttl, value });
  pruneExpiredCache(cache);
  return value;
}

async function fetchGitHubJson(
  url: string,
  allowNotFound = false,
): Promise<{ payload: unknown; remaining: string | null }> {
  const token = getServerEnvironmentVariable("GITHUB_TOKEN");
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (allowNotFound && response.status === 404) {
    return { payload: null, remaining: response.headers.get("X-RateLimit-Remaining") };
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : "GitHub could not return repository history.";
    const resetHeader = response.headers.get("X-RateLimit-Reset");
    const resetAt = resetHeader ? Number(resetHeader) : NaN;
    const resetMessage =
      response.status === 403 && Number.isFinite(resetAt)
        ? ` The API quota resets at ${new Date(resetAt * 1000).toISOString()}.`
        : "";
    throw createError({
      statusCode: response.status === 403 ? 503 : 502,
      statusMessage: `${message}${resetMessage}`,
    });
  }
  return {
    payload,
    remaining: response.headers.get("X-RateLimit-Remaining"),
  };
}

async function loadLatestRelease(): Promise<GithubReleaseResponse> {
  const cacheKey = getServerEnvironmentVariable("GITHUB_TOKEN")
    ? "release:authenticated"
    : "release:public";
  const cached = releaseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const { payload } = await fetchGitHubJson(`${REPOSITORY_API}/releases/latest`, true);
  return cacheValue(releaseCache, cacheKey, { release: payload }, RELEASE_CACHE_MS);
}

async function loadCommitHistory(): Promise<CommitHistoryResponse> {
  const cacheKey = getServerEnvironmentVariable("GITHUB_TOKEN")
    ? "history:authenticated"
    : "history:public";
  const cached = historyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pendingRequest = historyRequests.get(cacheKey);
  if (pendingRequest) return pendingRequest;

  const request = (async () => {
    const commits: unknown[] = [];
    let remaining: string | null = null;
    for (let page = 1; ; page += 1) {
      const { payload, remaining: pageRemaining } = await fetchGitHubJson(
        `${REPOSITORY_API}/commits?sha=main&per_page=${PAGE_SIZE}&page=${page}`,
      );
      if (!Array.isArray(payload)) {
        throw createError({ statusCode: 502, statusMessage: "GitHub returned an invalid commit list." });
      }
      commits.push(...payload);
      remaining = pageRemaining;
      if (payload.length < PAGE_SIZE) break;
    }
    return cacheValue(historyCache, cacheKey, { commits, remaining }, HISTORY_CACHE_MS);
  })();
  historyRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (historyRequests.get(cacheKey) === request) historyRequests.delete(cacheKey);
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  setResponseHeader(event, "Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
  if (query.release === "latest") return loadLatestRelease();
  const sha = typeof query.sha === "string" ? query.sha : "";

  if (sha) {
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      throw createError({ statusCode: 400, statusMessage: "A valid commit SHA is required." });
    }
    const history = await loadCommitHistory();
    const belongsToRepository = history.commits.some(
      (commit) =>
        typeof commit === "object" &&
        commit !== null &&
        "sha" in commit &&
        commit.sha === sha,
    );
    if (!belongsToRepository) {
      throw createError({ statusCode: 404, statusMessage: "Commit not found in this repository's public history." });
    }
    const includePatch = query.patch === "true";
    const cacheKey = `${sha}:${includePatch ? "patch" : "summary"}`;
    const cached = commitDetailCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const { payload, remaining } = await fetchGitHubJson(
      `${REPOSITORY_API}/commits/${encodeURIComponent(sha)}`,
    );
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("stats" in payload) ||
      !("files" in payload) ||
      !Array.isArray(payload.files)
    ) {
      throw createError({ statusCode: 502, statusMessage: "GitHub returned invalid commit details." });
    }

    const value = includePatch
      ? payload
      : {
          stats: payload.stats,
          files: payload.files.map((file) => {
            if (typeof file !== "object" || file === null) return file;
            const { patch: _patch, ...summary } = file;
            return summary;
          }),
        };
    const result = { detail: value, remaining };
    return cacheValue(commitDetailCache, cacheKey, result, includePatch ? PATCH_CACHE_MS : SUMMARY_CACHE_MS);
  }

  return loadCommitHistory();
});
