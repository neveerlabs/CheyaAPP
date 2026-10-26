import { ExternalLink, Link2, LoaderCircle } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { AppSupabaseClient } from "../lib/supabase";

interface PagePreview {
  url: string;
  title: string;
  description: string;
  siteName: string;
  imageUrl: string | null;
  videoUrl: string | null;
  content: string;
}

function extractUrls(content: string): string[] {
  const urls = new Set<string>();
  const visibleMarkdown = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " ");
  for (const match of visibleMarkdown.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    let candidate = match[0].replace(/[.,;!?]+$/, "");
    while (candidate.endsWith(")")) {
      const openCount = (candidate.match(/\(/g) ?? []).length;
      const closeCount = (candidate.match(/\)/g) ?? []).length;
      if (closeCount <= openCount) break;
      candidate = candidate.slice(0, -1);
    }
    try {
      const url = new URL(candidate);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname.includes(".") ||
        url.username ||
        url.password
      ) {
        continue;
      }
      urls.add(url.href);
    } catch {
      continue;
    }
    if (urls.size >= 2) break;
  }
  return [...urls];
}

function LinkPreview({
  url,
  client,
  userMessage,
}: {
  url: string;
  client: AppSupabaseClient;
  userMessage: boolean;
}) {
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mediaFailed, setMediaFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.access_token) throw new Error("Sign in to load this link preview.");

        const response = await fetch("/api/link-preview", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            typeof payload === "object" &&
            payload !== null &&
            "statusMessage" in payload &&
            typeof payload.statusMessage === "string"
              ? payload.statusMessage
              : `Could not load preview (${response.status}).`;
          throw new Error(message);
        }
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("title" in payload) ||
          !("url" in payload) ||
          typeof payload.title !== "string" ||
          typeof payload.url !== "string"
        ) {
          throw new Error("The link preview returned invalid metadata.");
        }
        setPreview(payload as PagePreview);
      } catch (previewError) {
        if (!controller.signal.aborted) {
          setError(
            previewError instanceof Error ? previewError.message : "Could not load this preview.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [client, url]);

  const sourceUrl = preview?.url ?? url;
  const siteName = preview?.siteName || (() => {
    try {
      return new URL(sourceUrl).hostname;
    } catch {
      return sourceUrl;
    }
  })();
  const isPlayableVideo =
    preview?.videoUrl && /\.(mp4|webm|ogv)(?:$|[?#])/i.test(preview.videoUrl);
  const hasMedia = Boolean(preview && (preview.imageUrl || isPlayableVideo));
  const description = preview?.description || preview?.content?.trim().slice(0, 240) || "";
  const cardClass = userMessage
    ? "border-white/20 bg-black/10 text-white"
    : "border-[#e5e6e9] bg-[#f7f8fa] text-[#282a30]";

  if (loading) {
    return (
      <div className={`min-h-[5.25rem] w-full min-w-0 overflow-hidden rounded-xl border text-xs ${cardClass}`}>
        <div className="flex min-h-[5.25rem] items-center gap-3 px-3 py-2.5">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-2 w-1/4 rounded bg-current opacity-15" />
            <div className="h-3 w-3/4 rounded bg-current opacity-15" />
            <div className="h-2 w-1/2 rounded bg-current opacity-15" />
          </div>
        </div>
      </div>
    );
  }
  if (error || !preview) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={`flex min-h-[5.25rem] w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl border px-3 py-2.5 text-xs ${cardClass}`}
      >
        <Link2 aria-hidden="true" className="size-4 shrink-0 opacity-60" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[10px] opacity-65">{siteName}</span>
          <span className="mt-1 block break-all line-clamp-2">{url}</span>
        </span>
        <span className="shrink-0">
          <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
        </span>
      </a>
    );
  }

  return (
    <div
      className={`w-full min-w-0 max-w-full overflow-hidden rounded-xl border text-left ${cardClass}`}
    >
      {hasMedia && (
        <div className="relative flex h-40 w-full items-center justify-center overflow-hidden bg-black/5">
          {!mediaFailed && isPlayableVideo ? (
            <video
              src={preview.videoUrl ?? undefined}
              poster={preview.imageUrl ?? undefined}
              controls
              preload="metadata"
              onError={() => setMediaFailed(true)}
              className="absolute inset-0 block h-full w-full bg-black object-contain"
            />
          ) : !mediaFailed && preview.imageUrl ? (
            <img
              src={preview.imageUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setMediaFailed(true)}
              className="absolute inset-0 block h-full w-full object-cover"
            />
          ) : (
            <Link2 aria-hidden="true" className="size-5 opacity-40" />
          )}
        </div>
      )}
      <div className={`min-h-[5.25rem] p-2.5 ${hasMedia ? "" : "flex flex-col justify-center"}`}>
        <p className={`truncate text-[10px] ${userMessage ? "text-white/65" : "text-[#777a82]"}`}>
          {siteName}
        </p>
        <a
          href={preview.url}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 block break-words line-clamp-2 text-xs font-semibold leading-4 underline underline-offset-2"
        >
          {preview.title}
        </a>
        <a
          href={preview.url}
          target="_blank"
          rel="noreferrer"
          className={`mt-1 block break-all line-clamp-2 text-[10px] leading-4 underline underline-offset-2 ${
            userMessage ? "text-white/60" : "text-[#858890]"
          }`}
        >
          {preview.url}
        </a>
        {description && (
          <p className={`mt-1 line-clamp-2 text-[11px] leading-4 ${userMessage ? "text-white/75" : "text-[#62656d]"}`}>
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export const LinkPreviews = memo(function LinkPreviews({
  content,
  client,
  userMessage = false,
}: {
  content: string;
  client: AppSupabaseClient | null;
  userMessage?: boolean;
}) {
  const urls = extractUrls(content);
  if (!client || urls.length === 0) return null;
  return (
    <div
      aria-label="Link previews"
      className="mt-2 grid w-full min-w-0 max-w-full grid-cols-1 gap-2 overflow-hidden"
    >
      {urls.map((url) => (
        <LinkPreview key={url} url={url} client={client} userMessage={userMessage} />
      ))}
    </div>
  );
});
