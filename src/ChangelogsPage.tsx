import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ExternalLink,
  FileCode2,
  GitCommitHorizontal,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const REPOSITORY = "neveerlabs/CheyaAPP";
const LIST_CACHE_MS = 10 * 60 * 1000;
const DETAIL_CACHE_MS = 24 * 60 * 60 * 1000;
const DETAIL_BATCH_SIZE = 4;

type CommitSummary = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
    committer?: { name: string; date: string } | null;
  };
  author: { login: string; avatar_url: string; html_url: string } | null;
  parents: Array<{ sha: string }>;
};

type CommitFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string | null;
};

type CommitDetail = {
  stats: { total: number; additions: number; deletions: number };
  files: CommitFile[];
  patchDataLoaded?: boolean;
};

type CacheEntry<T> = { savedAt: number; value: T };
type CommitHistoryResponse = { commits: CommitSummary[]; remaining: string | null };
type CommitDetailResponse = { detail: CommitDetail; remaining: string | null };
type GithubRelease = {
  name: string | null;
  tag_name: string;
  html_url: string;
  published_at: string | null;
};
type GithubReleaseResponse = { release: GithubRelease | null };

let commitListCache: CacheEntry<CommitSummary[]> | null = null;
let commitListRemaining: string | null = null;
let commitListRequest: Promise<CommitHistoryResponse> | null = null;
let githubApiRemaining: string | null = null;
const commitDetailsCache = new Map<string, CacheEntry<CommitDetail>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCommitSummary(value: unknown): value is CommitSummary {
  if (!isRecord(value) || typeof value.sha !== "string" || typeof value.html_url !== "string") {
    return false;
  }
  const commit = value.commit;
  const isPerson = (person: unknown) =>
    person === null ||
    (isRecord(person) &&
      typeof person.name === "string" &&
      typeof person.date === "string");
  return (
    isRecord(commit) &&
    typeof commit.message === "string" &&
    isPerson(commit.author) &&
    (commit.committer === undefined || isPerson(commit.committer)) &&
    Array.isArray(value.parents) &&
    value.parents.every((parent) => isRecord(parent) && typeof parent.sha === "string")
  );
}

function isCommitDetail(value: unknown): value is CommitDetail {
  return (
    isRecord(value) &&
    isRecord(value.stats) &&
    typeof value.stats.total === "number" &&
    typeof value.stats.additions === "number" &&
    typeof value.stats.deletions === "number" &&
    Array.isArray(value.files) &&
    value.files.every(
      (file) =>
        isRecord(file) &&
        typeof file.filename === "string" &&
        typeof file.status === "string" &&
        typeof file.additions === "number" &&
        typeof file.deletions === "number" &&
        typeof file.changes === "number" &&
        (file.patch === undefined || file.patch === null || typeof file.patch === "string"),
    )
  );
}

function isGithubRelease(value: unknown): value is GithubRelease {
  return (
    isRecord(value) &&
    (value.name === null || typeof value.name === "string") &&
    typeof value.tag_name === "string" &&
    typeof value.html_url === "string" &&
    (value.published_at === null || typeof value.published_at === "string")
  );
}

async function readChangelogResponse<T>(
  url: string,
  isExpectedShape: (payload: unknown) => payload is T,
): Promise<T> {
  const response = await fetch(url);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const apiMessage =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : isRecord(payload) && typeof payload.statusMessage === "string"
          ? payload.statusMessage
          : "";
    throw new Error(apiMessage || `The changelog service returned HTTP ${response.status}.`);
  }
  if (!isExpectedShape(payload)) {
    throw new Error("The changelog service returned data in an unexpected format.");
  }
  return payload;
}

async function loadAllCommits(): Promise<CommitHistoryResponse> {
  const cached = commitListCache;
  if (cached && Date.now() - cached.savedAt < LIST_CACHE_MS) {
    return { commits: cached.value, remaining: commitListRemaining };
  }
  if (commitListRequest) return commitListRequest;

  commitListRequest = (async () => {
    const result = await readChangelogResponse(
      "/api/github-changelogs",
      (payload): payload is CommitHistoryResponse =>
        isRecord(payload) &&
        Array.isArray(payload.commits) &&
        payload.commits.every(isCommitSummary) &&
        (payload.remaining === null || typeof payload.remaining === "string"),
    );
    commitListRemaining = result.remaining;
    commitListCache = { savedAt: Date.now(), value: result.commits };
    return result;
  })();
  try {
    return await commitListRequest;
  } finally {
    commitListRequest = null;
  }
}

async function loadCommitDetail(sha: string, includePatch = false): Promise<CommitDetail> {
  const cacheKey = `${sha}:${includePatch ? "patch" : "summary"}`;
  const cached = commitDetailsCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < DETAIL_CACHE_MS) return cached.value;
  const result = await readChangelogResponse(
    `/api/github-changelogs?sha=${encodeURIComponent(sha)}${includePatch ? "&patch=true" : ""}`,
    (payload): payload is CommitDetailResponse =>
      isRecord(payload) &&
      isCommitDetail(payload.detail) &&
      (payload.remaining === null || typeof payload.remaining === "string"),
  );
  githubApiRemaining = result.remaining;
  const detail = { ...result.detail, patchDataLoaded: includePatch };
  commitDetailsCache.set(cacheKey, { savedAt: Date.now(), value: detail });
  return detail;
}

function commitDate(commit: CommitSummary): Date | null {
  const value = commit.commit.author?.date ?? commit.commit.committer?.date;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function formatCompactDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function commitAuthor(commit: CommitSummary): string {
  return commit.author?.login ?? commit.commit.author?.name ?? "Unknown author";
}

function commitSubject(commit: CommitSummary): string {
  return commit.commit.message.split("\n")[0] ?? "Commit";
}

function StatusBadge({ status }: { status: string }) {
  const style =
    status === "added"
      ? "bg-emerald-50 text-emerald-700"
      : status === "removed"
        ? "bg-red-50 text-red-700"
        : status === "renamed"
          ? "bg-violet-50 text-violet-700"
          : "bg-[#f1f2f4] text-[#666970]";
  return <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${style}`}>{status}</span>;
}

function ActivityChart({
  commits,
  details,
  progress,
  error,
}: {
  commits: CommitSummary[];
  details: Record<string, CommitDetail>;
  progress: { completed: number; total: number };
  error: string;
}) {
  const chronologicalCommits = [...commits].sort((left, right) => {
    const leftTime = commitDate(left)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightTime = commitDate(right)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return leftTime - rightTime;
  });
  const points = chronologicalCommits.map((commit, index) => ({
    index,
    detail: details[commit.sha],
  }));
  const maxLines = Math.max(
    1,
    ...points.flatMap(({ detail }) =>
      detail ? [detail.stats.additions, detail.stats.deletions] : [],
    ),
  );
  const toPolyline = (key: "additions" | "deletions") =>
    points
      .filter(({ detail }) => detail)
      .map(({ index, detail }) => {
        const x = chronologicalCommits.length <= 1 ? 50 : (index / (chronologicalCommits.length - 1)) * 100;
        const value = detail!.stats[key];
        const y = 34 - (value / maxLines) * 29;
        return `${x},${y}`;
      })
      .join(" ");
  const oldestDate = chronologicalCommits.length
    ? commitDate(chronologicalCommits[0])
    : null;
  const newestDate = chronologicalCommits.length
    ? commitDate(chronologicalCommits[chronologicalCommits.length - 1])
    : null;

  return (
    <section aria-label="Code changes across the full commit history" className="overflow-hidden rounded-xl border border-[#e5e6e9] bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#25262a]">
            Changes by commit
          </h2>
          <p className="mt-1 text-xs text-[#777a81]">
            {progress.completed.toLocaleString()} of {progress.total.toLocaleString()} commits
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-medium">
          <span className="inline-flex items-center gap-1.5 text-emerald-700"><span className="size-2 rounded-full bg-emerald-500" />Added</span>
          <span className="inline-flex items-center gap-1.5 text-rose-700"><span className="size-2 rounded-full bg-rose-500" />Removed</span>
        </div>
      </div>
      <div className="relative mt-4 h-32 overflow-hidden rounded-lg bg-[#fafafa] px-1 sm:h-36">
        {progress.completed ? (
          <svg
            aria-label="Insertions and deletions by commit, oldest to newest"
            className="size-full overflow-visible"
            preserveAspectRatio="none"
            role="img"
            viewBox="0 0 100 40"
          >
            {[8, 20, 34].map((y) => (
              <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="#e8e7ef" strokeDasharray="1 1" strokeWidth="0.35" />
            ))}
            <polyline fill="none" points={toPolyline("additions")} stroke="#10b981" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
            <polyline fill="none" points={toPolyline("deletions")} stroke="#f43f5e" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[#858890]">
            {progress.total ? "Loading commit-level code changes…" : "No commit statistics available."}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-[#858890]">
        <span>{oldestDate ? oldestDate.toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "Oldest commit"}</span>
        <span>{newestDate ? newestDate.toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "Newest commit"}</span>
      </div>
      {error && <p role="status" className="mt-2 text-xs text-amber-700">{error}</p>}
    </section>
  );
}

function CommitTraffic({ detail }: { detail?: CommitDetail }) {
  if (!detail || detail.files.length === 0) {
    return <span className="h-7 w-12 shrink-0 text-[9px] text-[#a0a2a8]">No stats</span>;
  }
  const files = detail.files;
  const max = Math.max(1, ...files.flatMap((file) => [file.additions, file.deletions]));
  const points = (key: "additions" | "deletions") =>
    files
      .map((file, index) => {
        const x = files.length <= 1 ? 50 : (index / (files.length - 1)) * 100;
        const y = 29 - (file[key] / max) * 23;
        return `${x},${y}`;
      })
      .join(" ");
  return (
    <svg aria-label="Per-file changes in this commit" className="h-7 w-12 shrink-0 sm:h-8 sm:w-16" role="img" viewBox="0 0 100 32">
      <polyline fill="none" points={points("additions")} stroke="#10b981" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <polyline fill="none" points={points("deletions")} stroke="#f43f5e" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function CommitDiff({ patch }: { patch: string }) {
  return (
    <pre className="max-h-[480px] overflow-auto rounded-xl bg-[#17181b] p-3 text-[11px] leading-5 text-[#e4e5e8]">
      <code>
        {patch.split("\n").map((line, index) => (
          <span
            key={`${index}-${line.slice(0, 16)}`}
            className={`block whitespace-pre ${
              line.startsWith("+") && !line.startsWith("+++")
                ? "bg-emerald-950/60 text-emerald-300"
                : line.startsWith("-") && !line.startsWith("---")
                  ? "bg-red-950/60 text-red-300"
                  : line.startsWith("@@")
                    ? "text-sky-300"
                    : ""
            }`}
          >
            {line || " "}
          </span>
        ))}
      </code>
    </pre>
  );
}

export function ChangelogsPage() {
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [latestRelease, setLatestRelease] = useState<GithubRelease | null>(null);
  const [releaseError, setReleaseError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [remainingRequests, setRemainingRequests] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
  const [detailBySha, setDetailBySha] = useState<Record<string, CommitDetail>>({});
  const [statsProgress, setStatsProgress] = useState({ completed: 0, total: 0 });
  const [statsError, setStatsError] = useState("");
  const [loadingSha, setLoadingSha] = useState<string | null>(null);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError("");
    void loadAllCommits()
      .then((result) => {
        if (isMounted) {
          setCommits(result.commits);
          setRemainingRequests(result.remaining);
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Could not load GitHub commits.");
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    void readChangelogResponse(
      "/api/github-changelogs?release=latest",
      (payload): payload is GithubReleaseResponse =>
        isRecord(payload) &&
        (payload.release === null || isGithubRelease(payload.release)),
    )
      .then(({ release }) => {
        if (isMounted) setLatestRelease(release);
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          setReleaseError(
            loadError instanceof Error ? loadError.message : "Could not load the latest release.",
          );
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (isLoading || commits.length === 0) {
      setStatsProgress({ completed: 0, total: commits.length });
      return;
    }
    let isCurrent = true;
    let completed = 0;
    setStatsError("");
    setStatsProgress({ completed: 0, total: commits.length });

    void (async () => {
      for (let offset = 0; offset < commits.length; offset += DETAIL_BATCH_SIZE) {
        const batch = commits.slice(offset, offset + DETAIL_BATCH_SIZE);
        try {
          const results = await Promise.all(
            batch.map(async (commit) => [commit.sha, await loadCommitDetail(commit.sha)] as const),
          );
          if (!isCurrent) return;
          setDetailBySha((current) => {
            const next = { ...current };
            for (const [sha, detail] of results) {
              if (!current[sha]?.patchDataLoaded) next[sha] = detail;
            }
            return next;
          });
          completed += batch.length;
          setStatsProgress({ completed, total: commits.length });
          setRemainingRequests(githubApiRemaining);
        } catch (loadError) {
          if (!isCurrent) return;
          setStatsError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load statistics for the full commit history.",
          );
          return;
        }
      }
    })();
    return () => {
      isCurrent = false;
    };
  }, [commits, isLoading]);

  useEffect(() => {
    if (!expandedSha) return;
    const expandedIndex = commits.findIndex(({ sha }) => sha === expandedSha);
    if (expandedIndex < 0) return;
    const previousCommit = commits[expandedIndex + 1];
    let isCurrent = true;
    setDetailError("");

    const currentCached = detailBySha[expandedSha];
    const previousCached = previousCommit ? detailBySha[previousCommit.sha] : undefined;
    if (
      currentCached?.patchDataLoaded &&
      (!previousCommit || previousCached?.patchDataLoaded)
    ) return;

    setLoadingSha(expandedSha);
    void Promise.all([
      currentCached?.patchDataLoaded
        ? Promise.resolve(currentCached)
        : loadCommitDetail(expandedSha, true),
      previousCommit
        ? previousCached?.patchDataLoaded
          ? Promise.resolve(previousCached)
          : loadCommitDetail(previousCommit.sha, true)
        : Promise.resolve(null),
    ])
      .then(([currentDetail, previousDetail]) => {
        if (!isCurrent) return;
        setDetailBySha((current) => {
          const next = { ...current, [expandedSha]: currentDetail };
          if (previousCommit && previousDetail) next[previousCommit.sha] = previousDetail;
          return next;
        });
        setRemainingRequests(githubApiRemaining);
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setDetailError(
            loadError instanceof Error ? loadError.message : "Could not load commit changes.",
          );
        }
      })
      .finally(() => {
        if (isCurrent) setLoadingSha(null);
      });

    return () => {
      isCurrent = false;
    };
  }, [commits, detailBySha, expandedSha]);

  const filteredCommits = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return commits;
    return commits.filter((commit) =>
      [
        commit.commit.message,
        commitAuthor(commit),
        commit.sha,
        shortSha(commit.sha),
      ].some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [commits, query]);

  const contributors = useMemo(
    () => new Set(commits.map(commitAuthor)).size,
    [commits],
  );
  const totalStats = useMemo(
    () =>
      Object.values(detailBySha).reduce(
        (totals, detail) => ({
          additions: totals.additions + detail.stats.additions,
          deletions: totals.deletions + detail.stats.deletions,
          files: totals.files + detail.files.length,
        }),
        { additions: 0, deletions: 0, files: 0 },
      ),
    [detailBySha],
  );
  const statsAreComplete = statsProgress.total > 0 && statsProgress.completed === statsProgress.total;
  const dates = commits
    .map(commitDate)
    .filter((date): date is Date => date !== null)
    .sort((left, right) => left.getTime() - right.getTime());
  const oldestDate = dates[0];
  const newestDate = dates[dates.length - 1];

  return (
    <section className="space-y-4 py-2 sm:py-3">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-[#e5e6e9] pb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-[#202126]">Commit history</h2>
          <a
            href={`https://github.com/${REPOSITORY}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-[#666970] hover:text-[#202126] hover:underline"
          >
            {REPOSITORY}
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        </div>
        <div className="ml-auto min-w-0 text-right">
          <span className="block text-[9px] font-medium uppercase tracking-wide text-[#858890]">
            Latest release
          </span>
          {latestRelease ? (
            <a
              href={latestRelease.html_url}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-flex max-w-full items-center justify-end gap-1 text-xs font-medium text-[#34363b] hover:underline"
              title={latestRelease.name || latestRelease.tag_name}
            >
              <span className="max-w-32 truncate sm:max-w-52">
                {latestRelease.name || latestRelease.tag_name}
              </span>
              <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
            </a>
          ) : (
            <span
              className="mt-0.5 block max-w-40 truncate text-xs text-[#777a81]"
              title={releaseError || (isLoading ? "Loading release…" : "No published release")}
            >
              {releaseError ? "Release unavailable" : isLoading ? "Loading…" : "No published release"}
            </span>
          )}
          {latestRelease?.published_at && (
            <span className="block text-[9px] text-[#96989e]">
              {new Date(latestRelease.published_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          )}
        </div>
      </header>

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-100 bg-white p-4 text-sm leading-6 text-red-800">
          <p className="font-medium">Could not load the public GitHub history.</p>
          <p className="mt-1 text-xs">{error}</p>
          <p className="mt-2 text-xs text-red-700/80">
            The public GitHub API may temporarily limit requests. Configure an optional server-side GITHUB_TOKEN to increase the available API quota.
          </p>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-[#e5e6e9] bg-white sm:grid-cols-4">
            {[
              { label: "Commits", value: isLoading ? "…" : commits.length.toLocaleString(), color: "text-[#25262a]" },
              { label: "Lines added", value: statsAreComplete ? `+${totalStats.additions.toLocaleString()}` : "…", color: "text-emerald-700" },
              { label: "Lines removed", value: statsAreComplete ? `−${totalStats.deletions.toLocaleString()}` : "…", color: "text-rose-700" },
              { label: "File records", value: statsAreComplete ? totalStats.files.toLocaleString() : "…", color: "text-[#25262a]" },
            ].map(({ label, value, color }, index) => (
              <div
                key={label}
                className={`min-w-0 px-3 py-3 sm:px-4 ${
                  index === 1 ? "border-l border-[#e5e6e9]" : ""
                } ${index >= 2 ? "border-t border-[#e5e6e9] sm:border-l sm:border-t-0" : ""}`}
              >
                <dt className="text-[10px] text-[#777a81]">{label}</dt>
                <dd className={`mt-1 truncate text-base font-semibold tabular-nums ${color}`}>{value}</dd>
              </div>
            ))}
          </dl>

          {!isLoading && (
            <>
              <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-0.5 text-[10px] text-[#858890]">
                <span>{contributors.toLocaleString()} contributors on main</span>
                <span>
                  {oldestDate && newestDate
                    ? `${oldestDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} — ${newestDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
                    : "Full repository history"}
                </span>
                {statsAreComplete && (
                  <span>Net line change: {totalStats.additions - totalStats.deletions > 0 ? "+" : ""}{(totalStats.additions - totalStats.deletions).toLocaleString()}</span>
                )}
              </p>
              {statsAreComplete && (
                <p className="text-[10px] leading-4 text-[#858890]">
                  File records are counted as returned by GitHub (up to 300 per commit); line totals use GitHub&apos;s commit statistics.
                </p>
              )}
              <ActivityChart commits={commits} details={detailBySha} progress={statsProgress} error={statsError} />
            </>
          )}

          <div className="flex items-center gap-2 rounded-xl border border-[#e5e6e9] bg-white px-3">
            <Search aria-hidden="true" className="size-4 shrink-0 text-[#858890]" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by commit, author, or SHA"
              aria-label="Filter commit history"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm text-[#25262a] outline-none placeholder:text-[#a0a2a8]"
            />
            <span className="text-[10px] tabular-nums text-[#858890]">{filteredCommits.length}/{commits.length}</span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-[#e5e6e9] bg-white py-12 text-sm text-[#777a81]">
              <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
              Loading the complete repository history…
            </div>
          ) : commits.length === 0 ? (
            <p className="rounded-2xl border border-[#e5e6e9] bg-white p-5 text-sm text-[#777a81]">No commits were returned for this repository.</p>
          ) : filteredCommits.length === 0 ? (
            <p className="rounded-2xl border border-[#e5e6e9] bg-white p-5 text-sm text-[#777a81]">No commits match that filter.</p>
          ) : (
            <div className="space-y-2">
              {filteredCommits.map((commit) => {
                const date = commitDate(commit);
                const isExpanded = expandedSha === commit.sha;
                const detail = detailBySha[commit.sha];
                const originalIndex = commits.findIndex(({ sha }) => sha === commit.sha);
                const prior = originalIndex >= 0 ? commits[originalIndex + 1] : undefined;
                const priorDetail = prior ? detailBySha[prior.sha] : undefined;
                const isDetailLoading = loadingSha === commit.sha;
                return (
                  <article key={commit.sha} className="overflow-hidden rounded-2xl border border-[#e5e6e9] bg-white">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "Collapse" : "Expand"} commit: ${commitSubject(commit)}`}
                      onClick={() => setExpandedSha(isExpanded ? null : commit.sha)}
                      className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 p-3 text-left transition hover:bg-[#fafafa] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#777a81] sm:p-4"
                    >
                      <span className="row-span-2 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#f1f2f4] text-[#34363b]">
                        <GitCommitHorizontal aria-hidden="true" className="size-4" />
                      </span>
                      <span className="col-start-2 row-start-1 min-w-0">
                        <span className="block truncate text-sm font-medium leading-5 text-[#25262a]">{commitSubject(commit)}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-[#777a81]">
                          <span>{commitAuthor(commit)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{date ? `${formatCompactDate(date)} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Date unavailable"}</span>
                          <span aria-hidden="true">·</span>
                          <code className="rounded bg-[#f1f2f4] px-1.5 py-0.5 font-mono">{shortSha(commit.sha)}</code>
                        </span>
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className={`col-start-3 row-start-1 mt-1 size-4 text-[#777a81] transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                      <span className="col-start-2 col-span-2 row-start-2 flex min-w-0 items-center justify-between gap-2 border-t border-[#f0f0f0] pt-2">
                        {detail ? (
                          <>
                            <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] leading-4 tabular-nums">
                              <span className="whitespace-nowrap">
                                <span className="mr-1 text-[#858890]">+</span>
                                <strong className="font-semibold text-emerald-700">{detail.stats.additions.toLocaleString()}</strong>
                              </span>
                              <span className="whitespace-nowrap">
                                <span className="mr-1 text-[#858890]">−</span>
                                <strong className="font-semibold text-rose-700">{detail.stats.deletions.toLocaleString()}</strong>
                              </span>
                              <span className="whitespace-nowrap text-[#777a81]">{detail.files.length} file records</span>
                            </span>
                            <CommitTraffic detail={detail} />
                          </>
                        ) : (
                          <span className="text-[10px] text-[#858890]">
                            {statsError || detailError ? "Statistics unavailable" : "Loading commit statistics…"}
                          </span>
                        )}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="space-y-3 border-t border-[#ececf0] bg-[#fbfbfc] p-3.5 sm:p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[10px] text-[#777a81]">
                            {commit.commit.message.split("\n").slice(1).join(" ").trim() || "Commit summary and file-level changes"}
                          </p>
                          <a
                            href={commit.html_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-violet-700 hover:underline"
                          >
                            Open on GitHub <ExternalLink aria-hidden="true" className="size-3" />
                          </a>
                        </div>

                        {detailError && (
                          <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs text-red-800">{detailError}</p>
                        )}

                        {isDetailLoading ? (
                          <div className="flex items-center gap-2 py-5 text-xs text-[#777a81]">
                            <RefreshCw aria-hidden="true" className="size-3.5 animate-spin" />
                            Loading file diffs and commit statistics…
                          </div>
                        ) : detail ? (
                          <>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                              <div className="rounded-xl border border-[#e7e8eb] bg-white p-2.5">
                                <div className="text-[9px] font-semibold tracking-wide text-[#858890]">FILES REPORTED</div>
                                <div className="mt-1 text-sm font-semibold tabular-nums text-[#25262a]">{detail.files.length}</div>
                              </div>
                              <div className="rounded-xl border border-[#e7e8eb] bg-white p-2.5">
                                <div className="text-[9px] font-semibold tracking-wide text-[#858890]">INSERTIONS</div>
                                <div className="mt-1 flex items-center gap-1 text-sm font-semibold tabular-nums text-emerald-700">
                                  <ArrowUp aria-hidden="true" className="size-3" />{detail.stats.additions.toLocaleString()}
                                </div>
                              </div>
                              <div className="rounded-xl border border-[#e7e8eb] bg-white p-2.5">
                                <div className="text-[9px] font-semibold tracking-wide text-[#858890]">DELETIONS</div>
                                <div className="mt-1 flex items-center gap-1 text-sm font-semibold tabular-nums text-red-700">
                                  <ArrowDown aria-hidden="true" className="size-3" />{detail.stats.deletions.toLocaleString()}
                                </div>
                              </div>
                              <div className="rounded-xl border border-[#e7e8eb] bg-white p-2.5">
                                <div className="text-[9px] font-semibold tracking-wide text-[#858890]">NET CHANGE</div>
                                <div className={`mt-1 text-sm font-semibold tabular-nums ${detail.stats.additions - detail.stats.deletions >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                                  {detail.stats.additions - detail.stats.deletions > 0 ? "+" : ""}{(detail.stats.additions - detail.stats.deletions).toLocaleString()}
                                </div>
                              </div>
                            </div>
                            <p className="text-[10px] leading-4 text-[#858890]">
                              GitHub returns up to 300 file records per commit. Added and removed line counts are GitHub&apos;s commit-level totals.
                            </p>

                            <div className="rounded-xl border border-[#e7e8eb] bg-white p-3">
                              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[#777a81]">Compared with previous commit</h3>
                              {priorDetail ? (
                                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                                  <span className="text-[#777a81]">Δ file records <strong className="text-[#25262a]">{(detail.files.length - priorDetail.files.length > 0 ? "+" : "") + (detail.files.length - priorDetail.files.length).toLocaleString()}</strong></span>
                                  <span className="text-[#777a81]">Δ additions <strong className={detail.stats.additions >= priorDetail.stats.additions ? "text-emerald-700" : "text-red-700"}>{(detail.stats.additions - priorDetail.stats.additions > 0 ? "+" : "") + (detail.stats.additions - priorDetail.stats.additions).toLocaleString()}</strong></span>
                                  <span className="text-[#777a81]">Δ deletions <strong className={detail.stats.deletions <= priorDetail.stats.deletions ? "text-emerald-700" : "text-red-700"}>{(detail.stats.deletions - priorDetail.stats.deletions > 0 ? "+" : "") + (detail.stats.deletions - priorDetail.stats.deletions).toLocaleString()}</strong></span>
                                  <span className="text-[10px] text-[#96989e]">baseline {shortSha(prior?.sha ?? "")}</span>
                                </div>
                              ) : (
                                <p className="mt-1.5 text-xs text-[#777a81]">This is the oldest commit in the currently loaded history.</p>
                              )}
                              {prior && !priorDetail && (
                                <p className="mt-1.5 text-[10px] text-[#96989e]">The previous commit&apos;s statistics are not available yet.</p>
                              )}
                            </div>

                            <div className="space-y-2">
                              <h3 className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-[#777a81]">
                                <span className="flex items-center gap-1.5">
                                  <FileCode2 aria-hidden="true" className="size-3.5" />
                                  Changed source files
                                </span>
                                <span className="font-normal normal-case tracking-normal text-[#96989e]">
                                  {detail.files.length} files · scroll to browse
                                </span>
                              </h3>
                              <div className="max-h-[12rem] space-y-1.5 overflow-y-auto overscroll-contain pr-1">
                                {detail.files.map((file) => (
                                  <details key={file.filename} className="overflow-hidden rounded-xl border border-[#e7e8eb] bg-white">
                                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
                                      <StatusBadge status={file.status} />
                                      <code className="min-w-0 flex-1 truncate text-[10px] text-[#45474e]">{file.filename}</code>
                                      <span className="shrink-0 text-[9px] tabular-nums">
                                        <span className="text-emerald-700">+{file.additions}</span>
                                        <span className="mx-1 text-[#c3c4c8]">/</span>
                                        <span className="text-red-700">−{file.deletions}</span>
                                      </span>
                                    </summary>
                                    {file.patch ? (
                                      <div className="border-t border-[#ececf0] p-2">
                                        <CommitDiff patch={file.patch} />
                                      </div>
                                    ) : (
                                      <p className="border-t border-[#ececf0] px-3 py-2 text-[10px] text-[#858890]">
                                        GitHub did not include an inline patch for this file. Open the commit on GitHub to inspect the full source change.
                                      </p>
                                    )}
                                  </details>
                                ))}
                              </div>
                            </div>
                            <p className="text-[9px] leading-4 text-[#96989e]">
                              Commit metadata and inline patches are supplied by GitHub&apos;s public API. Very large diffs may be truncated; the GitHub commit link is the source of truth.
                            </p>
                          </>
                        ) : null}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {remainingRequests && (
            <p className="text-right text-[9px] text-[#a0a2a8]">GitHub API requests remaining: {remainingRequests}</p>
          )}
        </>
      )}
    </section>
  );
}
