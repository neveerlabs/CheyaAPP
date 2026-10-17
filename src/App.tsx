import {
  AudioLines,
  ArrowLeft,
  ArrowDown,
  ArrowRight,
  BadgeCheck,
  Bell,
  Brain,
  Bug,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Flashlight,
  FlashlightOff,
  Files,
  Image,
  LoaderCircle,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  X,
  Settings,
  Send,
  SwitchCamera,
  Video,
  Volume2,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import cheyaLogo from "../assets/circle.png";
import { AccountLogin } from "./AccountLogin";
import { ErrorPage } from "./ErrorPage";
import { LinkPreviews } from "./components/LinkPreviews";
import { PublicHome } from "./PublicHome";
import {
  CHAT_ATTACHMENT_BUCKET,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_SOURCE_BYTES,
  MAX_CHAT_ATTACHMENT_COUNT,
  MAX_CHAT_MESSAGE_ATTACHMENT_BYTES,
  CHAT_ATTACHMENT_RETENTION_MS,
  MAX_GEMINI_CONTEXT_ATTACHMENTS,
  formatChatAttachmentSize,
  isChatAttachmentExpired,
  loadChatAttachmentDrafts,
  removeChatAttachmentDraft,
  resolveChatAttachmentMimeType,
  saveChatAttachmentDraft,
  type ChatAttachmentRegistration,
} from "./lib/chat-attachments";
import { preprocessChatAttachment } from "./lib/chat-attachment-processing";
import {
  readBarcodeForAi,
  type AiBarcodeReading,
} from "./lib/chat-barcode";
import {
  generateThinkingSummary,
  generateGeminiConversation,
  normalizeUserFacingMarkdown,
  prepareGeminiAttachments,
  type GeminiAttachmentReference,
} from "./lib/gemini";
import {
  clearAccountSessionId,
  getAccountSessionId,
  getAccountSessionLocation,
} from "./lib/account-sessions";
import { subscribeWithReconnect } from "./lib/realtime";
import {
  prepareAssistantSpeech,
} from "./lib/tts-playback";
import type { AppSupabaseClient, ChatMessageJob, ChatMessageVersion } from "./lib/supabase";
import type { ChatAttachment } from "./lib/chat-attachments";

let assistantMarkdownModulePromise: Promise<typeof import("./components/AssistantMarkdown")> | null =
  null;
function loadAssistantMarkdown() {
  assistantMarkdownModulePromise ??= import("./components/AssistantMarkdown");
  return assistantMarkdownModulePromise;
}

const SettingsPage = lazy(() =>
  import("./SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const AssistantMarkdown = lazy(() =>
  loadAssistantMarkdown().then((module) => ({ default: module.AssistantMarkdown })),
);

function PageLoadingSkeleton({ pathname }: { pathname: string }) {
  const isSettings = pathname.startsWith("/settings");
  const settingsTitle = pathname.endsWith("/personal")
    ? "Personal"
    : pathname.endsWith("/configure")
      ? "Configure"
      : pathname.endsWith("/memory")
        ? "Memory"
        : pathname.endsWith("/account")
          ? "Account"
          : pathname.endsWith("/privacy")
            ? "Privacy Policy"
            : pathname.endsWith("/terms")
              ? "Terms of Service"
        : "Settings";

  if (isSettings) {
    return (
      <main className="fixed inset-0 flex justify-center bg-[#f5f6f8]">
        <section
          aria-label={`Loading ${settingsTitle.toLowerCase()} page`}
          className="relative h-full w-full max-w-4xl overflow-hidden bg-[#f5f6f8] sm:my-5 sm:h-[calc(100%-40px)]"
        >
          <header className="absolute inset-x-0 top-0 z-10 flex h-[68px] items-center gap-2 px-1 sm:px-4">
            <div className="chat-loading-skeleton size-11 rounded-full" />
            <div className="chat-loading-skeleton h-11 flex-1 rounded-full" />
            <div className="chat-loading-skeleton size-11 rounded-full" />
          </header>
          <div className="absolute inset-0 overflow-hidden px-5 pb-8 pt-[92px] sm:px-8">
            <div className="animate-pulse space-y-5">
              {settingsTitle === "Settings" ? (
                [0, 1, 2].map((item) => (
                  <div key={item} className="flex items-center gap-4 py-5">
                    <div className="h-10 w-10 shrink-0 rounded-xl bg-[#e9ebef]" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-28 rounded-full bg-[#e9ebef]" />
                      <div className="h-3 w-3/4 rounded-full bg-[#e9ebef]" />
                    </div>
                    <div className="size-5 rounded-full bg-[#e9ebef]" />
                  </div>
                ))
              ) : (
                <>
                  <div className="space-y-2 pt-3">
                    <div className="h-5 w-32 rounded-full bg-[#e9ebef]" />
                    <div className="h-3 w-64 max-w-full rounded-full bg-[#e9ebef]" />
                  </div>
                  {[48, 120, 48, 48, 100].map((height, index) => (
                    <div
                      key={index}
                      className="rounded-xl bg-[#e9ebef]"
                      style={{ height }}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="fixed inset-0 flex justify-center bg-white p-0 sm:p-5">
      <section
        aria-label="Loading chat"
        className="relative flex h-full w-full max-w-[580px] flex-col overflow-hidden bg-white sm:rounded-[34px] sm:border sm:border-[#e7e8eb]"
      >
        <header className="flex h-[64px] shrink-0 items-center justify-between gap-2 px-2 py-1 sm:gap-3 sm:px-5">
          <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-[#e8e9ec] bg-white py-1 pl-1 pr-2">
            <div className="size-10 rounded-full bg-[#eef0f3]" />
            <div className="space-y-2">
              <div className="h-3.5 w-28 rounded-full bg-[#eef0f3]" />
              <div className="h-2.5 w-20 rounded-full bg-[#eef0f3]" />
            </div>
            <div className="ml-auto size-8 rounded-full bg-[#f1f2f4]" />
          </div>
          <div className="h-12 w-32 rounded-full border border-[#e8e9ec] bg-white p-1">
            <div className="flex h-full justify-end gap-1">
              <div className="size-9 rounded-full bg-[#f1f2f4]" />
              <div className="size-9 rounded-full bg-[#f1f2f4]" />
              <div className="size-9 rounded-full bg-[#f1f2f4]" />
            </div>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-5 px-4 pb-3 pt-2 sm:px-6">
          <div className="chat-loading-skeleton ml-auto h-10 w-36 rounded-[18px] rounded-br-md" />
          <div className="space-y-3">
            <div className="chat-loading-skeleton h-3 w-28 rounded-full" />
            <div className="chat-loading-skeleton h-3 w-[92%] rounded-full" />
            <div className="chat-loading-skeleton h-3 w-[84%] rounded-full" />
            <div className="chat-loading-skeleton h-3 w-[68%] rounded-full" />
          </div>
          <div className="chat-loading-skeleton ml-auto h-10 w-48 rounded-[18px] rounded-br-md" />
        </div>
        <footer className="shrink-0 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2.5 sm:px-5 sm:pb-5">
          <div className="chat-loading-skeleton h-[88px] rounded-[25px] border border-[#e5e6e9] bg-white p-1" />
        </footer>
      </section>
    </main>
  );
}

function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function MediaPreview({
  src,
  fileName,
  fileSize,
  isVideo,
  downloadHref,
  onClose,
}: {
  src: string;
  fileName: string;
  fileSize: number;
  isVideo: boolean;
  downloadHref?: string;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStageRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartRef = useRef<{
    distance: number;
    centerX: number;
    centerY: number;
    scale: number;
    translateX: number;
    translateY: number;
    focalX: number;
    focalY: number;
  } | null>(null);
  const mediaTransformRef = useRef({ scale: 1, translateX: 0, translateY: 0 });
  const panStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    translateX: number;
    translateY: number;
  } | null>(null);
  const pinchOccurredRef = useRef(false);
  const pinchClickResetRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; x: number } | null>(null);
  const seekFeedbackTimerRef = useRef<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playError, setPlayError] = useState("");
  const [seekFeedback, setSeekFeedback] = useState<{ direction: "back" | "forward"; id: number } | null>(
    null,
  );

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (
      event.pointerType !== "touch" ||
      !window.matchMedia("(pointer: coarse)").matches ||
      (event.target as HTMLElement).closest("button, input")
    ) {
      return;
    }

    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (activePointersRef.current.size === 1 && mediaTransformRef.current.scale > 1) {
      panStartRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        translateX: mediaTransformRef.current.translateX,
        translateY: mediaTransformRef.current.translateY,
      };
    }
    if (activePointersRef.current.size === 2) {
      activePointersRef.current.forEach((_, pointerId) => {
        if (!event.currentTarget.hasPointerCapture(pointerId)) {
          event.currentTarget.setPointerCapture(pointerId);
        }
      });
      const [first, second] = [...activePointersRef.current.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (distance > 0 && mediaRef.current) {
        if (pinchClickResetRef.current !== null) {
          window.clearTimeout(pinchClickResetRef.current);
          pinchClickResetRef.current = null;
        }
        const stageBounds = mediaStageRef.current?.getBoundingClientRect();
        if (!stageBounds) return;
        const centerX = (first.x + second.x) / 2;
        const centerY = (first.y + second.y) / 2;
        pinchStartRef.current = {
          distance,
          centerX,
          centerY,
          scale: mediaTransformRef.current.scale,
          translateX: mediaTransformRef.current.translateX,
          translateY: mediaTransformRef.current.translateY,
          focalX:
            (centerX -
              stageBounds.left -
              stageBounds.width / 2 -
              mediaTransformRef.current.translateX) /
            mediaTransformRef.current.scale,
          focalY:
            (centerY -
              stageBounds.top -
              stageBounds.height / 2 -
              mediaTransformRef.current.translateY) /
            mediaTransformRef.current.scale,
        };
        mediaRef.current.style.transition = "none";
        mediaRef.current.style.transformOrigin = "center";
        pinchOccurredRef.current = true;
      }
    }
  }

  function applyMediaTransform(scale: number, translateX: number, translateY: number) {
    const stage = mediaStageRef.current;
    const media = mediaRef.current;
    if (!stage || !media) return;
    const mediaWidth =
      media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
    const mediaHeight =
      media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
    const aspectRatio =
      mediaWidth > 0 && mediaHeight > 0 ? mediaWidth / mediaHeight : stage.clientWidth / stage.clientHeight;
    const fittedWidth = Math.min(stage.clientWidth, stage.clientHeight * aspectRatio);
    const fittedHeight = Math.min(stage.clientHeight, stage.clientWidth / aspectRatio);
    const maxX = Math.max(0, (fittedWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (fittedHeight * scale - stage.clientHeight) / 2);
    const boundedX = Math.min(maxX, Math.max(-maxX, translateX));
    const boundedY = Math.min(maxY, Math.max(-maxY, translateY));
    mediaTransformRef.current = { scale, translateX: boundedX, translateY: boundedY };
    media.style.transform =
      `translate3d(${boundedX}px, ${boundedY}px, 0) scale(${scale})`;
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!activePointersRef.current.has(event.pointerId)) return;
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointersRef.current.size === 1 && panStartRef.current) {
      const translateX =
        panStartRef.current.translateX + event.clientX - panStartRef.current.pointerX;
      const translateY =
        panStartRef.current.translateY + event.clientY - panStartRef.current.pointerY;
      applyMediaTransform(mediaTransformRef.current.scale, translateX, translateY);
      return;
    }
    if (activePointersRef.current.size < 2 || !pinchStartRef.current) return;

    const [first, second] = [...activePointersRef.current.values()];
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    const centerX = (first.x + second.x) / 2;
    const centerY = (first.y + second.y) / 2;
    const nextZoom = Math.min(
      4,
      Math.max(
        1,
        pinchStartRef.current.scale * (distance / pinchStartRef.current.distance),
      ),
    );
    const stageBounds = mediaStageRef.current?.getBoundingClientRect();
    if (!stageBounds) return;
    const translateX =
      centerX - stageBounds.left - stageBounds.width / 2 - pinchStartRef.current.focalX * nextZoom;
    const translateY =
      centerY - stageBounds.top - stageBounds.height / 2 - pinchStartRef.current.focalY * nextZoom;
    applyMediaTransform(nextZoom, translateX, translateY);
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    activePointersRef.current.delete(event.pointerId);
    panStartRef.current = null;
    if (activePointersRef.current.size === 0) {
      pinchStartRef.current = null;
      applyMediaTransform(1, 0, 0);
      if (pinchOccurredRef.current) {
        if (mediaRef.current) {
          mediaRef.current.style.transition = "none";
        }
        pinchClickResetRef.current = window.setTimeout(() => {
          pinchOccurredRef.current = false;
          pinchClickResetRef.current = null;
        }, 400);
      }
    } else if (activePointersRef.current.size === 1) {
      pinchStartRef.current = null;
      const [pointer] = [...activePointersRef.current.values()];
      if (mediaTransformRef.current.scale > 1) {
        panStartRef.current = {
          pointerX: pointer.x,
          pointerY: pointer.y,
          translateX: mediaTransformRef.current.translateX,
          translateY: mediaTransformRef.current.translateY,
        };
      }
    }
  }

  useEffect(
    () => () => {
      if (pinchClickResetRef.current !== null) window.clearTimeout(pinchClickResetRef.current);
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
      if (seekFeedbackTimerRef.current !== null) window.clearTimeout(seekFeedbackTimerRef.current);
    },
    [],
  );

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    setPlayError("");
    if (video.paused) {
      try {
        await video.play();
      } catch (error) {
        setPlayError(
          error instanceof Error
            ? `This video could not be played: ${error.message}`
            : "This video could not be played.",
        );
      }
    } else {
      video.pause();
    }
  }

  function seekFromDoubleClick(clientX: number) {
    const video = videoRef.current;
    const stage = mediaStageRef.current;
    if (!video || !stage) return;
    const bounds = stage.getBoundingClientRect();
    const clickedLeftSide = clientX < bounds.left + bounds.width / 2;
    const direction = clickedLeftSide ? "back" : "forward";
    video.currentTime = Math.min(
      Math.max(0, video.currentTime + (clickedLeftSide ? -5 : 5)),
      Number.isFinite(video.duration) ? video.duration : video.currentTime + 5,
    );
    setSeekFeedback((current) => ({
      direction,
      id: (current?.id ?? 0) + 1,
    }));
    if (seekFeedbackTimerRef.current !== null) window.clearTimeout(seekFeedbackTimerRef.current);
    seekFeedbackTimerRef.current = window.setTimeout(() => setSeekFeedback(null), 650);
  }

  function handleMediaClick(event: React.MouseEvent<HTMLImageElement | HTMLVideoElement>) {
    if (pinchOccurredRef.current) {
      if (pinchClickResetRef.current !== null) window.clearTimeout(pinchClickResetRef.current);
      pinchOccurredRef.current = false;
      pinchClickResetRef.current = null;
      return;
    }
    if (!isVideo) return;

    const now = performance.now();
    const lastTap = lastTapRef.current;
    if (
      event.detail >= 2 ||
      (lastTap && now - lastTap.time < 320 && Math.abs(event.clientX - lastTap.x) < 120)
    ) {
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      lastTapRef.current = null;
      seekFromDoubleClick(event.clientX);
      return;
    }

    lastTapRef.current = { time: now, x: event.clientX };
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      void togglePlayback();
    }, 220);
  }

  return (
    <main className="fixed inset-0 z-[60] flex flex-col bg-[#17181c] text-white">
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-white/10 px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{fileName}</p>
          <p className="text-xs text-white/60">{formatChatAttachmentSize(fileSize)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {downloadHref && (
            <a
              href={downloadHref}
              download={fileName}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
            >
              Download
            </a>
          )}
          <button
            type="button"
            aria-label="Close attachment"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
      </header>
      <div
        ref={mediaStageRef}
        className="media-preview-stage relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        {isVideo ? (
          <video
            ref={(element) => {
              videoRef.current = element;
              mediaRef.current = element;
            }}
            src={src}
            playsInline
            preload="metadata"
            aria-label={fileName}
            onClick={handleMediaClick}
            onLoadedMetadata={(event) =>
              setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)
            }
            onDurationChange={(event) =>
              setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)
            }
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onError={() => setPlayError("This video could not be loaded or played in this browser.")}
            className="size-full select-none object-contain"
          />
        ) : (
          <img
            ref={(element) => {
              mediaRef.current = element;
            }}
            src={src}
            alt={fileName}
            draggable={false}
            onClick={handleMediaClick}
            className="size-full select-none object-contain"
          />
        )}
        {isVideo && seekFeedback && (
          <span
            key={seekFeedback.id}
            aria-hidden="true"
            className={`media-seek-feedback media-seek-feedback-${seekFeedback.direction} pointer-events-none absolute top-1/2 z-10 flex -translate-y-1/2 items-center justify-center text-white ${
              seekFeedback.direction === "back" ? "left-[12%]" : "right-[12%]"
            }`}
          >
            {seekFeedback.direction === "back" ? (
              <ArrowLeft aria-hidden="true" className="size-12" strokeWidth={2.5} />
            ) : (
              <ArrowRight aria-hidden="true" className="size-12" strokeWidth={2.5} />
            )}
          </span>
        )}
        {isVideo && (
          <div className="absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-3xl flex-col gap-2 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-8 sm:px-6">
            <input
              type="range"
              aria-label="Video position"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onInput={(event) => {
                const video = videoRef.current;
                if (!video) return;
                const nextTime = Number(event.currentTarget.value);
                video.currentTime = nextTime;
                setCurrentTime(nextTime);
              }}
              className="media-preview-seek h-2 w-full cursor-pointer accent-white"
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  aria-label={isPlaying ? "Pause video" : "Play video"}
                  onClick={() => void togglePlayback()}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25"
                >
                  {isPlaying ? (
                    <Pause aria-hidden="true" className="size-4" fill="currentColor" />
                  ) : (
                    <Play aria-hidden="true" className="size-4" fill="currentColor" />
                  )}
                </button>
                <span className="text-xs tabular-nums text-white/85">
                  {formatMediaTime(currentTime)} / {formatMediaTime(duration)}
                </span>
              </div>
              <span className="hidden truncate text-xs text-white/60 sm:block">
                Double-click left/right to seek 5s
              </span>
            </div>
            {playError && <p role="alert" className="text-xs text-red-200">{playError}</p>}
          </div>
        )}
      </div>
    </main>
  );
}

const UserMessageAttachmentTile = memo(function UserMessageAttachmentTile({
  attachment,
  expired,
  onOpen,
  getPreviewUrl,
}: {
  attachment: ChatAttachment;
  expired: boolean;
  onOpen: (attachment: ChatAttachment) => void;
  getPreviewUrl: (attachment: ChatAttachment) => Promise<string>;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const isImage = attachment.mime_type.startsWith("image/");
  const isVideo = attachment.mime_type.startsWith("video/");
  const isMedia = isImage || isVideo;

  useEffect(() => {
    if (!isMedia || expired) return;
    let cancelled = false;
    void getPreviewUrl(attachment)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment, expired, getPreviewUrl, isMedia]);

  return (
    <button
      type="button"
      disabled={expired}
      onClick={() => onOpen(attachment)}
      dir="ltr"
      className="group/attachment relative flex size-[68px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-[#e5e6e9] bg-white text-[#3d4148] shadow-sm transition hover:border-[#cdd3da] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-65"
      aria-label={
        expired
          ? `${attachment.file_name}, expired`
          : `Open ${attachment.file_name}, ${formatChatAttachmentSize(attachment.size_bytes)}`
      }
      title={`${attachment.file_name} · ${formatChatAttachmentSize(attachment.size_bytes)}`}
    >
      {previewUrl && isImage ? (
        <img
          src={previewUrl}
          alt={attachment.file_name}
          className="absolute inset-0 size-full object-cover"
        />
      ) : previewUrl && isVideo ? (
        <video
          src={previewUrl}
          muted
          playsInline
          preload="metadata"
          aria-label={attachment.file_name}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-[#f8f9fb] to-[#edf0f4] px-1.5">
          {isImage ? (
            <Image aria-hidden="true" className="size-5 text-[#6585a7]" />
          ) : isVideo ? (
            <Video aria-hidden="true" className="size-5 text-[#6585a7]" />
          ) : (
            <Files aria-hidden="true" className="size-5 text-[#6585a7]" />
          )}
          {!isMedia && (
            <span className="w-full truncate text-center text-[9px] font-semibold">
              {attachment.file_name}
            </span>
          )}
          {isMedia && previewError && (
            <span className="text-[8px] text-[#777a82]">Preview unavailable</span>
          )}
        </div>
      )}
      {isMedia && previewUrl && (
        <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-1 pb-1 pt-3 text-center text-[8px] font-medium text-white">
          {attachment.file_name}
        </span>
      )}
      {isVideo && previewUrl && (
        <span className="pointer-events-none absolute left-1/2 top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white">
          <Play aria-hidden="true" className="size-3.5 fill-current" />
        </span>
      )}
      {expired && (
        <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-1 text-center text-[8px] font-medium text-white">
          Expired
        </span>
      )}
    </button>
  );
});

const ChatMessageInput = memo(function ChatMessageInput({
  inputRef,
  defaultValue,
  disabled,
  placeholder,
  onDraftInput,
  onSubmitMessage,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  defaultValue: string;
  disabled: boolean;
  placeholder: string;
  onDraftInput: (value: string, input: HTMLTextAreaElement) => void;
  onSubmitMessage: () => void;
}) {
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input || !defaultValue) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 44), 88)}px`;
  }, [defaultValue, inputRef]);

  return (
    <textarea
      ref={inputRef}
      defaultValue={defaultValue}
      aria-label="Message"
      name="message"
      placeholder={placeholder}
      rows={1}
      disabled={disabled}
      inputMode="text"
      enterKeyHint="enter"
      autoCapitalize="sentences"
      autoCorrect="on"
      spellCheck
      onInput={(event) => onDraftInput(event.currentTarget.value, event.currentTarget)}
      onKeyDown={(event) => {
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.nativeEvent.isComposing ||
          window.matchMedia("(pointer: coarse)").matches
        ) {
          return;
        }
        event.preventDefault();
        onSubmitMessage();
      }}
      className="h-11 min-h-11 max-h-[88px] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-2 text-base leading-6 text-[#25262a] caret-[#229fe3] outline-none placeholder:text-[#a2a3a7] selection:bg-[#bfe6f7] selection:text-[#25262a] [-webkit-user-select:text]"
    />
  );
});

const ChatMediaMenu = memo(function ChatMediaMenu({
  disabled,
  onOpenCamera,
  onPickPhoto,
  onPickFiles,
}: {
  disabled: boolean;
  onOpenCamera: () => void;
  onPickPhoto: () => void;
  onPickFiles: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Add media"
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
        className="flex size-9 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3] disabled:cursor-not-allowed sm:size-10"
      >
        <Plus aria-hidden="true" className="size-[21px]" strokeWidth={1.8} />
      </button>
      {isOpen && (
        <>
          <button
            type="button"
            aria-label="Close media menu"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setIsOpen(false)}
          />
          <div
            role="menu"
            aria-label="Choose a media source"
            className="absolute bottom-[calc(100%+10px)] left-0 z-30 w-48 overflow-hidden rounded-2xl border border-[#e5e6e9] bg-white p-1.5 shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onOpenCamera();
              }}
              className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-[#292b30] transition hover:bg-[#f4f5f7]"
            >
              <Camera aria-hidden="true" className="size-[18px]" />
              Camera
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onPickPhoto();
              }}
              className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-[#292b30] transition hover:bg-[#f4f5f7]"
            >
              <Image aria-hidden="true" className="size-[18px]" />
              Photo
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onPickFiles();
              }}
              className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-[#292b30] transition hover:bg-[#f4f5f7]"
            >
              <Files aria-hidden="true" className="size-[18px]" />
              Files
            </button>
          </div>
        </>
      )}
    </div>
  );
});

const ThinkingModeToggle = memo(function ThinkingModeToggle({
  disabled,
  onToggle,
}: {
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const title = enabled ? "Turn off thinking summary" : "Turn on thinking summary";

  return (
    <button
      type="button"
      aria-label="Think"
      aria-pressed={enabled}
      title={title}
      disabled={disabled}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        const next = !enabled;
        setEnabled(next);
        onToggle(next);
      }}
      className={`flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3] disabled:cursor-not-allowed sm:h-10 sm:px-3.5 ${
        enabled
          ? "border-[#b9dff2] bg-[#edf8fd] text-[#1678a8]"
          : "border-[#e5e6e9] bg-white text-[#34363b] hover:bg-[#f7f8fa]"
      }`}
    >
      <Brain aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
      <span>Thinking</span>
    </button>
  );
});

const headerActions = [
  { label: "Report a problem", icon: Bug },
  { label: "Settings", icon: Settings },
];
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  versionNumber: number;
  thinkingSummary: string | null;
  attachments?: ChatAttachment[];
}

interface PendingChatAttachment {
  id: string;
  file: File;
  mimeType: string;
  draftSavedAt?: number;
  isUploading: boolean;
  isBlocked: boolean;
  isPreprocessed?: boolean;
  uploadError: string | null;
  uploaded: ChatAttachment | null;
}

interface AttachmentView {
  index: number;
  mode: "media" | "editor";
}

function messageDraftStorageKey(userId: string): string {
  return `cheyaverse-chat-message-draft:v1:${userId}`;
}

function isChatAttachment(value: unknown): value is ChatAttachment {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "user_id" in value &&
    typeof value.user_id === "string" &&
    "message_id" in value &&
    (typeof value.message_id === "string" || value.message_id === null) &&
    "file_name" in value &&
    typeof value.file_name === "string" &&
    "mime_type" in value &&
    typeof value.mime_type === "string" &&
    "size_bytes" in value &&
    typeof value.size_bytes === "number" &&
    "created_at" in value &&
    typeof value.created_at === "string" &&
    "expires_at" in value &&
    typeof value.expires_at === "string" &&
    "deleted_at" in value &&
    (typeof value.deleted_at === "string" || value.deleted_at === null)
  );
}

interface DeleteConfirmation {
  label: string;
  preview: string;
}

interface DeleteChatTarget {
  id: string;
  text: string;
}

interface ReportTarget {
  id: string;
  versionNumber: number;
}

interface TtsPlayback {
  messageId: string;
  versionNumber: number;
  text: string;
  engine: "loading" | "audio" | "browser";
  status: "loading" | "ready" | "playing" | "paused" | "ended" | "error";
  durationSeconds: number;
  elapsedSeconds: number;
  browserVoiceName?: string;
  errorSummary?: string;
  errorDetails?: string;
}

type AssistantRating = "like" | "dislike";

const textFileExtensions = new Set([
  "c",
  "cc",
  "cfg",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "go",
  "h",
  "hpp",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);
const binaryFileExtensions = new Set(["7z", "doc", "docx", "gz", "pdf", "rar", "tar", "xls", "xlsx", "zip"]);

function speechTextFromMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/(\*\*|__|~~|\*|_)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function estimateSpeechDurationSeconds(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil((wordCount / 155) * 60));
}

function formatSpeechTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function speechWaveHeight(text: string, index: number): number {
  const character = text.charCodeAt((index * 7) % Math.max(text.length, 1)) || index * 13;
  return 18 + ((character * (index + 11)) % 72);
}

function summarizeSpeechError(details: string): string {
  const firstLine = details.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "Speech playback failed.";
  return firstLine.length > 64 ? `${firstLine.slice(0, 61).trimEnd()}...` : firstLine;
}

async function loadBrowserSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  const synthesis = window.speechSynthesis;
  const available = synthesis.getVoices();
  if (available.length > 0) return available;

  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timeoutId);
      synthesis.removeEventListener("voiceschanged", finish);
      resolve(synthesis.getVoices());
    };
    const timeoutId = window.setTimeout(finish, 1200);
    synthesis.addEventListener("voiceschanged", finish, { once: true });
  });
}

function selectBrowserSpeechVoice(
  voices: SpeechSynthesisVoice[],
  preferredName?: string,
): SpeechSynthesisVoice | null {
  if (preferredName) {
    const preferred = voices.find((voice) => voice.name === preferredName);
    if (preferred) return preferred;
  }
  const indonesianVoices = voices.filter((voice) => /^id(?:-|$)/i.test(voice.lang));
  const explicitlyFemale = voices.find((voice) =>
    /google/i.test(voice.name) &&
    /female|woman|perempuan|wanita|gadis/i.test(voice.name),
  );
  if (explicitlyFemale) return explicitlyFemale;
  const googleIndonesian = indonesianVoices.find((voice) => /google/i.test(voice.name));
  if (googleIndonesian) return googleIndonesian;
  const likelyFemale = indonesianVoices.find((voice) =>
    /female|woman|perempuan|wanita|gadis/i.test(voice.name),
  );
  return likelyFemale ?? indonesianVoices[0] ?? voices.find((voice) => /google/i.test(voice.name)) ?? null;
}

function isTextAttachment(mimeType: string, fileName: string): boolean {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return (
    mimeType.startsWith("text/") ||
    /\/(json|javascript|xml|x-sql|x-yaml)$/.test(mimeType) ||
    textFileExtensions.has(extension)
  );
}

export function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [authClient, setAuthClient] = useState<AppSupabaseClient | null>(null);
  const [authUser, setAuthUser] = useState<{ id: string; email: string | null } | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [historyLoadError, setHistoryLoadError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatJobs, setChatJobs] = useState<ChatMessageJob[]>([]);
  const [messageVersions, setMessageVersions] = useState<Record<string, ChatMessageVersion[]>>({});
  const [selectedMessageVersions, setSelectedMessageVersions] = useState<Record<string, number>>({});
  const [isSending, setIsSending] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isRestoringDraftAttachments, setIsRestoringDraftAttachments] = useState(false);
  const [typingAssistant, setTypingAssistant] = useState<{ id: string; content: string } | null>(
    null,
  );
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [hasGeminiApiKey, setHasGeminiApiKey] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(() => new Set());
  const [ratings, setRatings] = useState<Record<string, AssistantRating>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [ttsPlayback, setTtsPlayback] = useState<TtsPlayback | null>(null);
  const [isTtsErrorExpanded, setIsTtsErrorExpanded] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const reportDetailsRef = useRef("");
  const [reportError, setReportError] = useState("");
  const [isSavingReport, setIsSavingReport] = useState(false);
  const userEditTargetRef = useRef<string | null>(null);
  const userEditTextRef = useRef("");
  const userEditDialogRef = useRef<HTMLDialogElement>(null);
  const userEditTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeUserActions, setActiveUserActions] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);
  const [deleteChatTarget, setDeleteChatTarget] = useState<DeleteChatTarget | null>(null);
  const [isDeletingChatBranch, setIsDeletingChatBranch] = useState(false);
  const [sendError, setSendError] = useState("");
  const [attachmentToast, setAttachmentToast] = useState("");
  const [isDraggingAttachments, setIsDraggingAttachments] = useState(false);
  const [attachedMedia, setAttachedMedia] = useState<PendingChatAttachment[]>([]);
  const barcodeReadsRef = useRef(
    new Map<string, Promise<Omit<AiBarcodeReading, "attachmentId"> | null>>(),
  );
  function prepareAiBarcodeRead(
    attachment: Pick<PendingChatAttachment, "id" | "file" | "mimeType">,
  ): Promise<Omit<AiBarcodeReading, "attachmentId"> | null> | null {
    if (!attachment.mimeType.startsWith("image/")) return null;
    const existing = barcodeReadsRef.current.get(attachment.id);
    if (existing) return existing;

    const reading = readBarcodeForAi(attachment.file).catch((error: unknown) => {
      console.warn(
        `Barcode analysis could not be completed for "${attachment.file.name}"; the original image will still be sent to Cheya.`,
        error,
      );
      return null;
    });
    barcodeReadsRef.current.set(attachment.id, reading);
    return reading;
  }
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"environment" | "user">("environment");
  const [isCameraSwitchSupported, setIsCameraSwitchSupported] = useState(false);
  const [isCameraTorchSupported, setIsCameraTorchSupported] = useState(false);
  const [isCameraTorchOn, setIsCameraTorchOn] = useState(false);
  const isAttachmentUploadPending =
    isPreparingAttachments || attachedMedia.some((attachment) => attachment.isUploading);
  const authenticatedUserId = authUser?.id ?? null;
  const [remoteAttachmentView, setRemoteAttachmentView] = useState<{
    attachment: ChatAttachment;
    signedUrl: string;
    textContent: string | null;
  } | null>(null);
  const [attachmentView, setAttachmentView] = useState<AttachmentView | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const editorOriginalContentRef = useRef<string | null>(null);
  const [editorError, setEditorError] = useState("");
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const ttsAudioUrlRef = useRef("");
  const ttsRequestControllerRef = useRef<AbortController | null>(null);
  const ttsTokenRef = useRef(0);
  const pendingConversationScrollRestoreRef = useRef<number | null>(null);
  const pendingHistoryScrollRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const oldestHistoryCursorRef = useRef<{ id: string; created_at: string } | null>(null);
  const hasOlderHistoryRef = useRef(false);
  const loadingOlderHistoryRef = useRef(false);
  const historyGenerationRef = useRef(0);
  const versionRestoreGenerationRef = useRef(0);
  const versionRestoreQueueRef = useRef(Promise.resolve());
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const jobRefreshTimerRef = useRef<number | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const preparingAttachmentsRef = useRef(false);
  const cameraHistoryEntryRef = useRef(false);
  const attachmentToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageDraftRef = useRef("");
  const messageDraftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageDraftUserIdRef = useRef<string | null>(null);
  const dragEnterDepthRef = useRef(0);
  const pendingAssistantAnchorRef = useRef<string | null>(null);
  const shouldScrollToLatestRef = useRef(true);
  const followLatestRef = useRef(true);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const pendingOptimisticMessageIdsRef = useRef(new Set<string>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const nextApiIndexRef = useRef(0);
  const thinkingModeRef = useRef(false);
  const attachmentViewRequestRef = useRef(0);
  const cancelledAttachmentsRef = useRef(new Set<string>());
  const deleteConfirmationResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const wasSettingsRef = useRef(window.location.pathname === "/settings");
  const chatJobsByMessageId = useMemo(() => {
    const result = new Map<string, ChatMessageJob>();
    for (const job of chatJobs) {
      if (!result.has(job.message_id)) result.set(job.message_id, job);
    }
    return result;
  }, [chatJobs]);
  const activeChatJob = chatJobs.find(
    (job) => job.status === "queued" || job.status === "processing",
  );

  useEffect(() => {
    if (!authClient || !authenticatedUserId) return;
    let isActive = true;
    let sessionId: string;
    try {
      sessionId = getAccountSessionId();
    } catch (error) {
      console.error("Could not initialize this account session tracker.", error);
      return;
    }
    let hasRegisteredSession = false;

    const reportSession = async () => {
      if (!isActive) return;
      try {
        const { origin, path } = getAccountSessionLocation();
        const lastSeenAt = new Date().toISOString();
        if (!hasRegisteredSession) {
          const { error } = await authClient.from("account_sessions").upsert(
            {
              id: sessionId,
              user_id: authenticatedUserId,
              origin,
              path,
              user_agent: navigator.userAgent,
              last_seen_at: lastSeenAt,
            },
            { onConflict: "id" },
          );
          if (error) throw new Error(error.message);
          hasRegisteredSession = true;
          return;
        }

        // Later heartbeats must not recreate a session removed from Account settings.
        const { data, error } = await authClient
          .from("account_sessions")
          .update({ origin, path, user_agent: navigator.userAgent, last_seen_at: lastSeenAt })
          .eq("id", sessionId)
          .eq("user_id", authenticatedUserId)
          .select("id");
        if (error) throw new Error(error.message);
        if (data.length === 0) {
          isActive = false;
          clearAccountSessionId();
          const { error: signOutError } = await authClient.auth.signOut({ scope: "local" });
          if (signOutError) throw new Error(signOutError.message);
        }
      } catch (error) {
        console.error("Could not update the active account session.", error);
      }
    };

    void reportSession();
    const heartbeat = window.setInterval(() => void reportSession(), 30_000);
    document.addEventListener("visibilitychange", reportSession);
    return () => {
      isActive = false;
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", reportSession);
    };
  }, [authClient, authenticatedUserId]);

  function closeTts() {
    ttsTokenRef.current += 1;
    ttsRequestControllerRef.current?.abort();
    ttsRequestControllerRef.current = null;
    ttsAudioRef.current?.pause();
    ttsAudioRef.current = null;
    ttsUtteranceRef.current = null;
    window.speechSynthesis?.cancel();
    if (ttsAudioUrlRef.current) URL.revokeObjectURL(ttsAudioUrlRef.current);
    ttsAudioUrlRef.current = "";
    setIsTtsErrorExpanded(false);
    setTtsPlayback(null);
  }

  async function startBrowserSpeech(
    messageId: string,
    versionNumber: number,
    text: string,
    token: number,
    durationSeconds: number,
    previousErrors: string[],
    preferredVoiceName?: string,
  ): Promise<string | undefined> {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      throw new Error("This browser does not support built-in speech synthesis.");
    }
    const voices = await loadBrowserSpeechVoices();
    if (ttsTokenRef.current !== token) return;
    const voice = selectBrowserSpeechVoice(voices, preferredVoiceName);
    if (!voice) {
      throw new Error("No Google or Indonesian speech voice is installed in this browser.");
    }

    const synthesis = window.speechSynthesis;
    synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang || "id-ID";
    utterance.rate = 1;
    utterance.pitch = 1.05;
    ttsUtteranceRef.current = utterance;
    utterance.onboundary = (event) => {
      if (ttsTokenRef.current !== token || !text.length) return;
      const progress = Math.min(1, Math.max(0, event.charIndex / text.length));
      setTtsPlayback((current) =>
        current?.messageId === messageId
          ? { ...current, elapsedSeconds: durationSeconds * progress }
          : current,
      );
    };
    utterance.onend = () => {
      if (ttsTokenRef.current !== token) return;
      ttsUtteranceRef.current = null;
      setTtsPlayback((current) =>
        current?.messageId === messageId
          ? { ...current, status: "ended", elapsedSeconds: durationSeconds }
          : current,
      );
    };
    utterance.onerror = (event) => {
      if (
        ttsTokenRef.current !== token ||
        event.error === "canceled" ||
        event.error === "interrupted"
      ) {
        return;
      }
      const details = [
        ...previousErrors,
        `Browser speech synthesis (${voice.name}) failed: ${event.error}.`,
      ].join("\n\n");
      setTtsPlayback((current) =>
        current?.messageId === messageId
          ? {
              ...current,
              engine: "browser",
              status: "error",
              errorSummary: summarizeSpeechError(details),
              errorDetails: details,
            }
          : current,
      );
    };
    synthesis.speak(utterance);
    setTtsPlayback({
      messageId,
      versionNumber,
      text,
      engine: "browser",
      status: "playing",
      durationSeconds,
      elapsedSeconds: 0,
      browserVoiceName: voice.name,
      errorSummary: previousErrors.length
        ? "Gemini TTS failed; using the browser voice."
        : undefined,
      errorDetails: previousErrors.length ? previousErrors.join("\n\n") : undefined,
    });
    return voice.name;
  }

  async function playAssistantSpeech(
    messageId: string,
    versionNumber: number,
    markdown: string,
  ) {
    const text = speechTextFromMarkdown(markdown);
    if (!text) return;

    if (
      ttsPlayback?.messageId === messageId &&
      ttsPlayback.versionNumber === versionNumber
    ) {
      if (ttsPlayback.status === "loading") return;
      if (ttsPlayback.engine === "browser") {
        const synthesis = window.speechSynthesis;
        if (ttsPlayback.status === "playing" && synthesis.speaking) {
          synthesis.pause();
          setTtsPlayback((current) =>
            current?.messageId === messageId
              ? { ...current, status: "paused" }
              : current,
          );
          return;
        }
        if (ttsPlayback.status === "paused" && synthesis.paused) {
          synthesis.resume();
          setTtsPlayback((current) =>
            current?.messageId === messageId
              ? { ...current, status: "playing" }
              : current,
          );
          return;
        }
        if (ttsPlayback.status === "ended" || ttsPlayback.status === "error") {
          const previousErrors = ttsPlayback.errorDetails
            ? ttsPlayback.errorDetails.split("\n\n")
            : [];
          try {
            await startBrowserSpeech(
              messageId,
              versionNumber,
              text,
              ttsTokenRef.current,
              ttsPlayback.durationSeconds,
              previousErrors,
              ttsPlayback.browserVoiceName,
            );
          } catch (error) {
            const details = [
              ttsPlayback.errorDetails,
              error instanceof Error ? error.message : "Browser speech synthesis failed.",
            ]
              .filter(Boolean)
              .join("\n\n");
            setTtsPlayback((current) =>
              current?.messageId === messageId
                ? {
                    ...current,
                    status: "error",
                    errorSummary: summarizeSpeechError(details),
                    errorDetails: details,
                  }
                : current,
            );
          }
          return;
        }
      }
      const audio = ttsAudioRef.current;
      if (audio && !audio.paused) {
        audio.pause();
        setTtsPlayback((current) =>
          current?.messageId === messageId
            ? { ...current, elapsedSeconds: audio.currentTime, status: "paused" }
            : current,
        );
        return;
      }
      if (audio) {
        if (audio.ended) audio.currentTime = 0;
        const playbackToken = ttsTokenRef.current;
        const playPromise = audio.play();
        setTtsPlayback((current) =>
          current?.messageId === messageId
            ? { ...current, status: "playing", elapsedSeconds: audio.currentTime }
            : current,
        );
        void playPromise.catch((error: unknown) => {
          if (ttsTokenRef.current !== playbackToken) return;
          const details = error instanceof Error ? error.message : "Browser playback was blocked.";
          setTtsPlayback((current) =>
            current?.messageId === messageId && current.status !== "paused"
              ? {
                  ...current,
                  status: "paused",
                  errorSummary: summarizeSpeechError(details),
                  errorDetails: details,
                }
              : current,
          );
        });
        return;
      }
    }

    closeTts();
    const token = ttsTokenRef.current;
    const requestController = new AbortController();
    ttsRequestControllerRef.current = requestController;
    const durationSeconds = estimateSpeechDurationSeconds(text);
    let errors: string[] = [];
    setTtsPlayback({
      messageId,
      versionNumber,
      text,
      engine: "loading",
      status: "loading",
      durationSeconds,
      elapsedSeconds: 0,
    });

    try {
      const prepared = await prepareAssistantSpeech(
        authClient,
        messageId,
        versionNumber,
        text,
        requestController.signal,
      );
      errors = prepared.errors;
      if (ttsTokenRef.current !== token) return;

      if (!prepared.audio) {
        await startBrowserSpeech(
          messageId,
          versionNumber,
          text,
          token,
          durationSeconds,
          errors,
          prepared.browserVoiceName,
        );
        return;
      }

      const audioBlob = prepared.audio;
      const audioUrl = URL.createObjectURL(audioBlob);
      ttsAudioUrlRef.current = audioUrl;
      const audio = new Audio(audioUrl);
      audio.preload = "auto";
      ttsAudioRef.current = audio;

      const actualDuration = await new Promise<number>((resolve, reject) => {
        audio.addEventListener(
          "loadedmetadata",
          () => resolve(Number.isFinite(audio.duration) ? audio.duration : durationSeconds),
          { once: true },
        );
        audio.addEventListener(
          "error",
          () => reject(new Error("The generated audio could not be loaded by this browser.")),
          { once: true },
        );
        audio.load();
      });
      if (ttsTokenRef.current !== token) return;

      audio.addEventListener("timeupdate", () => {
        if (ttsTokenRef.current !== token) return;
        setTtsPlayback((current) =>
          current?.messageId === messageId
            ? { ...current, elapsedSeconds: audio.currentTime }
            : current,
        );
      });
      audio.addEventListener("ended", () => {
        if (ttsTokenRef.current !== token) return;
        setTtsPlayback((current) =>
          current?.messageId === messageId
            ? {
                ...current,
                elapsedSeconds: actualDuration,
                status: "ended",
              }
            : current,
        );
      });
      audio.addEventListener("error", () => {
        if (ttsTokenRef.current !== token) return;
        const details = [...errors, "The generated audio could not be played by this browser."]
          .join("\n\n");
        setTtsPlayback((current) =>
          current?.messageId === messageId
            ? {
                ...current,
                status: "error",
                errorSummary: summarizeSpeechError(details),
                errorDetails: details,
              }
            : current,
        );
      });
      setTtsPlayback({
        messageId,
        versionNumber,
        text,
        engine: "audio",
        status: "ready",
        durationSeconds: actualDuration,
        elapsedSeconds: 0,
        errorSummary: errors.length ? summarizeSpeechError(errors.join("\n\n")) : undefined,
        errorDetails: errors.length ? errors.join("\n\n") : undefined,
      });
    } catch (error) {
      if (ttsTokenRef.current !== token || requestController.signal.aborted) return;
      const details = error instanceof Error ? error.message : "Could not generate speech.";
      const allErrors = errors.length ? `${errors.join("\n\n")}\n\n${details}` : details;
      setTtsPlayback((current) =>
        current?.messageId === messageId
          ? {
              ...current,
              engine: "loading",
              status: "error",
              errorSummary: summarizeSpeechError(allErrors),
              errorDetails: allErrors,
            }
          : current,
      );
    } finally {
      if (ttsRequestControllerRef.current === requestController) {
        ttsRequestControllerRef.current = null;
      }
    }
  }

  useLayoutEffect(() => {
    if (ttsPlayback?.status !== "ready" || ttsPlayback.engine !== "audio") return;
    const audio = ttsAudioRef.current;
    const messageId = ttsPlayback.messageId;
    const token = ttsTokenRef.current;
    if (!audio) return;

    void audio.play().then(
      () => {
        if (ttsTokenRef.current !== token) return;
        setTtsPlayback((current) =>
          current?.messageId === messageId && current.status === "ready"
            ? { ...current, status: "playing" }
            : current,
        );
      },
      (error: unknown) => {
        if (ttsTokenRef.current !== token || !audio.paused) return;
        const details = error instanceof Error
          ? error.message
          : "Browser playback was blocked.";
        setTtsPlayback((current) =>
          current?.messageId === messageId && current.status === "ready"
            ? {
                ...current,
                status: "paused",
                errorSummary: summarizeSpeechError(details),
                errorDetails: details,
              }
            : current,
        );
      },
    );
  }, [ttsPlayback]);

  useEffect(() => {
    if (pathname.startsWith("/settings")) closeTts();
  }, [pathname]);

  useEffect(
    () => () => {
      ttsTokenRef.current += 1;
      ttsRequestControllerRef.current?.abort();
      ttsAudioRef.current?.pause();
      window.speechSynthesis?.cancel();
      if (ttsAudioUrlRef.current) URL.revokeObjectURL(ttsAudioUrlRef.current);
    },
    [],
  );

  function scrollConversationToLatest(behavior: ScrollBehavior = "smooth") {
    const conversation = conversationRef.current;
    if (!conversation) return;
    conversation.scrollTo({ top: conversation.scrollHeight, behavior });
  }

  async function loadOlderChatHistory() {
    const client = authClient;
    const generation = historyGenerationRef.current;
    const before = oldestHistoryCursorRef.current;
    if (
      !client ||
      !authenticatedUserId ||
      !before ||
      !hasOlderHistoryRef.current ||
      loadingOlderHistoryRef.current
    ) {
      return;
    }
    loadingOlderHistoryRef.current = true;
    loadingOlderHistoryRef.current = true;
    try {
      const { loadChatMessagePage, loadMessageAttachments, loadMessageVersions } =
        await import("./lib/chat-data");
      const page = await loadChatMessagePage(client, {
        before,
        userId: authenticatedUserId,
      });
      if (historyGenerationRef.current !== generation) return;
      if (page.messages.length === 0) {
        hasOlderHistoryRef.current = false;
        return;
      }

      const [versions, attachments] = await Promise.all([
        loadMessageVersions(
          client,
          page.messages.map((message) => message.id),
        ),
        loadMessageAttachments(
          client,
          page.messages.map((message) => message.id),
        ),
      ]);
      const assistantMessages = page.messages.filter((message) => message.role === "assistant");
      let loadedRatings: Record<string, AssistantRating> = {};
      if (assistantMessages.length > 0) {
        const { data, error } = await client
          .from("message_feedback")
          .select("message_id, version_number, kind")
          .in(
            "message_id",
            assistantMessages.map((message) => message.id),
          )
          .in("kind", ["like", "dislike"]);
        if (error) {
          throw new Error(`Could not load saved response feedback: ${error.message}`);
        }
        loadedRatings = Object.fromEntries(
          data.flatMap((item) =>
            item.kind === "like" || item.kind === "dislike"
              ? [[`${item.message_id}:${item.version_number}`, item.kind]]
              : [],
          ),
        );
      }

      if (historyGenerationRef.current !== generation) return;
      const conversation = conversationRef.current;
      if (conversation) {
        pendingHistoryScrollRestoreRef.current = {
          height: conversation.scrollHeight,
          top: conversation.scrollTop,
        };
      }
      const oldestMessage = page.messages[0];
      oldestHistoryCursorRef.current = oldestMessage
        ? { id: oldestMessage.id, created_at: oldestMessage.created_at }
        : before;
      hasOlderHistoryRef.current = page.hasMore;
      setMessageVersions((current) => ({ ...current, ...versions }));
      setSelectedMessageVersions((current) => ({
        ...current,
        ...Object.fromEntries(
          page.messages.map((message) => [message.id, message.version_number]),
        ),
      }));
      setRatings((current) => ({ ...current, ...loadedRatings }));
      setMessages((current) => {
        const currentIds = new Set(current.map((message) => message.id));
        const olderMessages = page.messages
          .filter((message) => !currentIds.has(message.id))
          .map(({ id, role, content, created_at, version_number, thinking_summary }) => ({
            id,
            role,
            text: content,
            createdAt: created_at,
            versionNumber: version_number,
            thinkingSummary: thinking_summary,
            attachments: attachments[id] ?? [],
          }));
        return [...olderMessages, ...current];
      });
    } catch (error) {
      setSendError(
        error instanceof Error ? error.message : "Could not load earlier chat history.",
      );
    } finally {
      if (historyGenerationRef.current === generation) {
        loadingOlderHistoryRef.current = false;
      }
    }
  }

  function showAttachmentToast(message: string) {
    setAttachmentToast(message);
    if (attachmentToastTimerRef.current) clearTimeout(attachmentToastTimerRef.current);
    attachmentToastTimerRef.current = setTimeout(() => {
      attachmentToastTimerRef.current = null;
      setAttachmentToast("");
    }, 5000);
  }

  useEffect(
    () => () => {
      if (attachmentToastTimerRef.current) clearTimeout(attachmentToastTimerRef.current);
    },
    [],
  );

  function handleConversationScroll() {
    const conversation = conversationRef.current;
    if (!conversation) return;
    if (conversation.scrollTop <= 48 && hasOlderHistoryRef.current) {
      void loadOlderChatHistory();
    }
    setShowScrollToLatest(
      conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight > 120,
    );
    followLatestRef.current =
      conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight <= 120;
  }

  function resizeMessageInput(input: HTMLTextAreaElement) {
    input.style.height = "auto";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 44), 88)}px`;
  }

  function handleMessageDraftInput(value: string, input: HTMLTextAreaElement) {
    messageDraftRef.current = value;
    resizeMessageInput(input);
    if (messageDraftSaveTimerRef.current) clearTimeout(messageDraftSaveTimerRef.current);
    messageDraftSaveTimerRef.current = setTimeout(() => {
      const userId = messageDraftUserIdRef.current;
      if (!userId) return;
      try {
        const key = messageDraftStorageKey(userId);
        if (messageDraftRef.current) localStorage.setItem(key, messageDraftRef.current);
        else localStorage.removeItem(key);
      } catch (error) {
        setSendError(
          error instanceof Error
            ? `Your message draft could not be saved locally: ${error.message}`
            : "Your message draft could not be saved locally.",
        );
      }
    }, 100);
  }
  const mediaPreviews = useMemo(
    () =>
      new Map(
        attachedMedia
          .filter(
            ({ mimeType, isBlocked }) =>
              !isBlocked &&
              (mimeType.startsWith("image/") || mimeType.startsWith("video/")),
          )
          .map(({ file }) => [file, URL.createObjectURL(file)]),
      ),
    [attachedMedia],
  );
  useEffect(
    () => () => {
      mediaPreviews.forEach((url) => URL.revokeObjectURL(url));
    },
    [mediaPreviews],
  );

  function requestDeleteConfirmation(label: string, preview: string): Promise<boolean> {
    if (deleteConfirmationResolverRef.current) return Promise.resolve(false);
    setDeleteConfirmation({ label, preview });
    return new Promise((resolve) => {
      deleteConfirmationResolverRef.current = resolve;
    });
  }

  function resolveDeleteConfirmation(approved: boolean) {
    deleteConfirmationResolverRef.current?.(approved);
    deleteConfirmationResolverRef.current = null;
    setDeleteConfirmation(null);
  }

  function displayedVersionNumber(chatMessage: ChatMessage): number {
    return selectedMessageVersions[chatMessage.id] ?? chatMessage.versionNumber;
  }

  function displayedMessageText(chatMessage: ChatMessage): string {
    const versionNumber = displayedVersionNumber(chatMessage);
    const content =
      messageVersions[chatMessage.id]?.find((item) => item.version_number === versionNumber)
        ?.content ?? chatMessage.text;
    return chatMessage.role === "assistant"
      ? normalizeUserFacingMarkdown(content)
      : content;
  }

  function displayedThinkingSummary(chatMessage: ChatMessage): string | null {
    const versionNumber = displayedVersionNumber(chatMessage);
    return (
      messageVersions[chatMessage.id]?.find((item) => item.version_number === versionNumber)
        ?.thinking_summary ?? chatMessage.thinkingSummary
    );
  }

  function openUserMessageEditor(messageId: string, text: string) {
    userEditTargetRef.current = messageId;
    userEditTextRef.current = text;
    if (userEditTextareaRef.current) userEditTextareaRef.current.value = text;
    const dialog = userEditDialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeUserMessageEditor() {
    userEditDialogRef.current?.close();
    userEditTargetRef.current = null;
  }

  async function setMessageVersion(chatMessage: ChatMessage, direction: -1 | 1) {
    if (isSending) return;
    setSendError("");
    setTypingAssistant(null);
    const messageIndex = messages.findIndex((item) => item.id === chatMessage.id);
    const versions = messageVersions[chatMessage.id] ?? [];
    if (versions.length < 2) return;
    const currentNumber = displayedVersionNumber(chatMessage);
    const currentIndex = versions.findIndex((item) => item.version_number === currentNumber);
    if (currentIndex < 0) {
      setSendError("Could not find the currently selected message version.");
      return;
    }
    const nextVersion = versions[currentIndex + direction];
    if (!nextVersion) return;

    if (authClient) {
      const restoreGeneration = ++versionRestoreGenerationRef.current;
      setSelectedMessageVersions((current) => ({
        ...current,
        [chatMessage.id]: nextVersion.version_number,
      }));
      try {
        const {
          restoreChatBranch,
          loadMessageAttachments,
          loadMessageVersions,
        } = await import("./lib/chat-data");
        const branchRequest = versionRestoreQueueRef.current.then(() => {
          if (versionRestoreGenerationRef.current !== restoreGeneration) return null;
          return restoreChatBranch(
            authClient,
            chatMessage.id,
            nextVersion.version_number,
          );
        });
        versionRestoreQueueRef.current = branchRequest.then(
          () => undefined,
          () => undefined,
        );
        const branch = await branchRequest;
        if (!branch) return;
        if (branch.length === 0) {
          throw new Error("No saved conversation branch was returned for this message version.");
        }
        const [loadedVersions, loadedAttachments] = await Promise.all([
          loadMessageVersions(
            authClient,
            branch.map((item) => item.id),
          ),
          loadMessageAttachments(
            authClient,
            branch.map((item) => item.id),
          ),
        ]);
        if (versionRestoreGenerationRef.current !== restoreGeneration) return;
        setMessages(
          branch.map(({ id, role, content, created_at, version_number, thinking_summary }) => ({
            id,
            role,
            text: content,
            createdAt: created_at,
            versionNumber: version_number,
            thinkingSummary: thinking_summary,
            attachments: loadedAttachments[id] ?? [],
          })),
        );
        setMessageVersions((current) => ({ ...current, ...loadedVersions }));
        setSelectedMessageVersions(
          Object.fromEntries(branch.map((item) => [item.id, item.version_number])),
        );
        setSendError("");
        return;
      } catch (error) {
        if (versionRestoreGenerationRef.current === restoreGeneration) {
          setSelectedMessageVersions((current) => ({
            ...current,
            [chatMessage.id]: currentNumber,
          }));
          setSendError(
            error instanceof Error ? error.message : "Could not restore this conversation branch.",
          );
        }
        return;
      }
    }

    const selectedVersions = {
      ...selectedMessageVersions,
      [chatMessage.id]: nextVersion.version_number,
    };
    for (const laterMessage of messages.slice(messageIndex + 1)) {
      const laterVersions = messageVersions[laterMessage.id] ?? [];
      if (laterVersions.length < 2) continue;
      const laterCurrentNumber = selectedVersions[laterMessage.id] ?? laterMessage.versionNumber;
      const laterIndex = laterVersions.findIndex(
        (item) => item.version_number === laterCurrentNumber,
      );
      const adjacentVersion = laterVersions[laterIndex + direction];
      if (adjacentVersion) selectedVersions[laterMessage.id] = adjacentVersion.version_number;
    }
    setSelectedMessageVersions(selectedVersions);
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  useEffect(() => {
    if (!activeUserActions) return;
    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-user-actions]")) {
        setActiveUserActions(null);
      }
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [activeUserActions]);

  useEffect(() => () => clearLongPressTimer(), []);

  useEffect(() => {
    if (!authenticatedUserId) return;
    const userId = authenticatedUserId;
    messageDraftUserIdRef.current = userId;
    try {
      const draft = localStorage.getItem(messageDraftStorageKey(userId)) ?? "";
      messageDraftRef.current = draft;
      if (messageInputRef.current) {
        messageInputRef.current.value = draft;
        resizeMessageInput(messageInputRef.current);
      }
    } catch (error) {
      setSendError(
        error instanceof Error
          ? `The saved message draft could not be restored: ${error.message}`
          : "The saved message draft could not be restored.",
      );
    }

    const flushDraft = () => {
      try {
        const key = messageDraftStorageKey(userId);
        if (messageDraftRef.current) localStorage.setItem(key, messageDraftRef.current);
        else localStorage.removeItem(key);
      } catch (error) {
        setSendError(
          error instanceof Error
            ? `Your message draft could not be saved locally: ${error.message}`
            : "Your message draft could not be saved locally.",
        );
      }
    };
    window.addEventListener("pagehide", flushDraft);
    document.addEventListener("visibilitychange", flushDraft);
    return () => {
      window.removeEventListener("pagehide", flushDraft);
      document.removeEventListener("visibilitychange", flushDraft);
      if (messageDraftSaveTimerRef.current) {
        clearTimeout(messageDraftSaveTimerRef.current);
        messageDraftSaveTimerRef.current = null;
      }
      flushDraft();
    };
  }, [authenticatedUserId]);

  useEffect(
    () => () => {
      mediaPreviews.forEach((preview) => URL.revokeObjectURL(preview));
    },
    [mediaPreviews],
  );

  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previousRestoration;
    };
  }, []);

  useEffect(() => {
    if (!isSending) return;
    const frame = window.requestAnimationFrame(() => {
      const conversation = conversationRef.current;
      if (conversation) conversation.scrollTop = conversation.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isSending, thinkingSteps, messages.length]);

  useEffect(() => {
    if (
      !shouldScrollToLatestRef.current ||
      pathname !== "/" ||
      isAuthLoading ||
      isLoadingHistory ||
      !authClient ||
      !authUser
    ) {
      return;
    }

    let frame = 0;
    let frameCount = 0;
    let previousHeight = -1;
    let stableFrames = 0;
    const scrollWhenReady = () => {
      const conversation = conversationRef.current;
      if (!conversation) {
        frame = window.requestAnimationFrame(scrollWhenReady);
        return;
      }

      conversation.scrollTop = conversation.scrollHeight;
      followLatestRef.current = true;
      frameCount += 1;
      if (conversation.scrollHeight === previousHeight) stableFrames += 1;
      else stableFrames = 0;
      previousHeight = conversation.scrollHeight;

      if (frameCount < 8 && stableFrames < 2) {
        frame = window.requestAnimationFrame(scrollWhenReady);
      } else {
        shouldScrollToLatestRef.current = false;
      }
    };
    frame = window.requestAnimationFrame(scrollWhenReady);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [authClient, authUser, isAuthLoading, isLoadingHistory, messages.length, pathname]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    let observedContent: Element | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (followLatestRef.current) scrollConversationToLatest("auto");
    });
    const observeCurrentContent = () => {
      const currentContent = conversation.firstElementChild;
      if (currentContent === observedContent) return;
      if (observedContent) resizeObserver.unobserve(observedContent);
      observedContent = currentContent;
      if (observedContent) resizeObserver.observe(observedContent);
    };
    const mutationObserver = new MutationObserver(observeCurrentContent);
    observeCurrentContent();
    mutationObserver.observe(conversation, { childList: true });
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [isLoadingHistory, messages.length, pathname]);

  useEffect(() => {
    const anchorId = pendingAssistantAnchorRef.current;
    if (!anchorId) return;
    const anchorIndex = messages.findIndex((item) => item.id === anchorId);
    if (anchorIndex < 0) return;
    const response = messages.slice(anchorIndex + 1).find((item) => item.role === "assistant");
    if (!response) return;
    pendingAssistantAnchorRef.current = null;
    setTypingAssistant({ id: response.id, content: displayedMessageText(response) });
  }, [messages]);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | null = null;
    void (async () => {
      let client: AppSupabaseClient;
      try {
        const { createSupabaseClient, loadDatabaseConfig } = await import("./lib/supabase");
        const config = loadDatabaseConfig();
        if (!config) {
          setAuthError(
            "The shared CheyaVerse database is not configured. The administrator must add its public connection settings to Vercel.",
          );
          setIsAuthLoading(false);
          return;
        }
        client = createSupabaseClient(config);
        setAuthClient(client);
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Could not configure account sign-in.");
        setIsAuthLoading(false);
        return;
      }

      const activateSession = async (
      session: Awaited<ReturnType<typeof client.auth.getSession>>["data"]["session"],
    ) => {
      if (!isMounted) return;
      if (!session?.user || session.user.is_anonymous) {
        setAuthUser(null);
        setIsAuthLoading(false);
        setMessages([]);
        setChatJobs([]);
        setHasGeminiApiKey(false);
        return;
      }

      setIsAuthLoading(true);
      try {
        const { ensureSupabaseSession } = await import("./lib/supabase");
        await ensureSupabaseSession(client);
        if (!isMounted) return;
        setAuthError("");
        setAuthUser({ id: session.user.id, email: session.user.email ?? null });
      } catch (error) {
        if (!isMounted) return;
        setAuthUser(null);
        setAuthError(error instanceof Error ? error.message : "Could not prepare account data.");
      } finally {
        if (isMounted) setIsAuthLoading(false);
      }
    };

      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((event, session) => {
        if (event === "TOKEN_REFRESHED") return;
        window.setTimeout(() => void activateSession(session), 0);
      });
      unsubscribe = () => subscription.unsubscribe();
      void client.auth.getSession().then(({ data, error }) => {
        if (error) {
          setAuthError(`Could not restore your account session: ${error.message}`);
          setIsAuthLoading(false);
          return;
        }
        void activateSession(data.session);
      });
    })();

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const historyGeneration = ++historyGenerationRef.current;
    loadingOlderHistoryRef.current = false;
    pendingHistoryScrollRestoreRef.current = null;
    if (!authClient || !authenticatedUserId) {
      setIsLoadingHistory(false);
      setHistoryLoadError("");
      setMessages([]);
      setAttachedMedia([]);
      oldestHistoryCursorRef.current = null;
      hasOlderHistoryRef.current = false;
      loadingOlderHistoryRef.current = false;
      setMessageVersions({});
      setSelectedMessageVersions({});
      setRatings({});
      setHasGeminiApiKey(false);
      setChatJobs([]);
      setIsSending(false);
      return;
    }

    let isMounted = true;
    shouldScrollToLatestRef.current = true;
    followLatestRef.current = true;
    oldestHistoryCursorRef.current = null;
    hasOlderHistoryRef.current = false;
    setIsLoadingHistory(true);
    setHistoryLoadError("");
    let didLoadHistory = false;
    void (async () => {
      try {
        const markdownPromise = loadAssistantMarkdown();
        const chatData = await import("./lib/chat-data");
        const {
          loadChatMessagePage,
          loadMessageAttachments,
          loadMessageVersions,
        } = chatData;
        const [messagePage] = await Promise.all([
          loadChatMessagePage(authClient, { userId: authenticatedUserId }),
          markdownPromise,
        ]);
        if (!isMounted) return;
        const savedMessages = messagePage.messages;
        didLoadHistory = true;
        const oldestMessage = savedMessages[0];
        oldestHistoryCursorRef.current = oldestMessage
          ? { id: oldestMessage.id, created_at: oldestMessage.created_at }
          : null;
        hasOlderHistoryRef.current = messagePage.hasMore;

        setMessages((current) => {
          const currentAttachments = new Map(
            current.map((message) => [message.id, message.attachments ?? []]),
          );
          return savedMessages.map(
            ({ id, role, content, created_at, version_number, thinking_summary }) => ({
              id,
              role,
              text: content,
              createdAt: created_at,
              versionNumber: version_number,
              thinkingSummary: thinking_summary,
              attachments: currentAttachments.get(id) ?? [],
            }),
          );
        });
        shouldScrollToLatestRef.current = true;
        if (savedMessages.length === 0) setIsLoadingHistory(false);

        const assistantMessages = savedMessages.filter((item) => item.role === "assistant");
        const [keyResult, jobsResult, loadedVersions, loadedAttachments, loadedRatings] =
          await Promise.all([
          authClient
            .from("ai_api_keys")
            .select("id")
            .order("created_at", { ascending: true })
            .limit(1),
          authClient
            .from("chat_message_jobs")
            .select("*")
            .or("status.in.(queued,processing,failed),error.not.is.null")
            .order("created_at", { ascending: false })
            .limit(50),
          loadMessageVersions(
            authClient,
            savedMessages.map((item) => item.id),
          ),
          loadMessageAttachments(
            authClient,
            savedMessages.map((item) => item.id),
          ),
          (async () => {
            if (assistantMessages.length === 0) return {};
            const { data: feedback, error: feedbackError } = await authClient
              .from("message_feedback")
              .select("message_id, version_number, kind")
              .in("message_id", assistantMessages.map((item) => item.id))
              .in("kind", ["like", "dislike"]);
            if (feedbackError) {
              throw new Error(
                `Could not load saved response feedback. Run the latest server schema. ${feedbackError.message}`,
              );
            }
            const ratings: Record<string, AssistantRating> = {};
            feedback.forEach((item) => {
              if (item.kind === "like" || item.kind === "dislike") {
                ratings[`${item.message_id}:${item.version_number}`] = item.kind;
              }
            });
            return ratings;
          })(),
          ]);
        if (keyResult.error) throw keyResult.error;
        if (jobsResult.error) throw jobsResult.error;
        if (isMounted) {
          setHasGeminiApiKey(keyResult.data.length > 0);
          setChatJobs(jobsResult.data);
          const pendingJob = jobsResult.data.find(
            (job) => job.status === "queued" || job.status === "processing",
          );
          if (pendingJob) {
            pendingAssistantAnchorRef.current = pendingJob.message_id;
          } else if (
            jobsResult.data.some(
              (job) =>
                job.status === "failed" &&
                job.message_id === pendingAssistantAnchorRef.current,
            )
          ) {
            pendingAssistantAnchorRef.current = null;
          }
          setIsSending(
            Boolean(pendingJob),
          );
          setRatings(loadedRatings);
          setMessageVersions(loadedVersions);
          setSelectedMessageVersions(
            Object.fromEntries(savedMessages.map((item) => [item.id, item.version_number])),
          );
          setMessages((current) =>
            current.map((message) => ({
              ...message,
              attachments: loadedAttachments[message.id] ?? message.attachments ?? [],
            })),
          );
        }
      } catch (error) {
        if (isMounted) {
          const message =
            error instanceof Error ? error.message : "Could not load saved chat history.";
          if (!didLoadHistory && pathname === "/") setHistoryLoadError(message);
          setSendError(
            message,
          );
        }
      } finally {
        if (isMounted) setIsLoadingHistory(false);
      }
    })();

    return () => {
      isMounted = false;
      if (historyGenerationRef.current === historyGeneration) {
        historyGenerationRef.current += 1;
      }
    };
  }, [authClient, authUser, pathname]);

  useEffect(() => {
    if (!authClient || !authenticatedUserId) {
      setAttachedMedia([]);
      setIsRestoringDraftAttachments(false);
      return;
    }

    let isMounted = true;
    setAttachedMedia([]);
    setIsRestoringDraftAttachments(true);
    void (async () => {
      try {
        const [localDrafts, pendingResult] = await Promise.all([
          loadChatAttachmentDrafts(authenticatedUserId),
          authClient
            .from("chat_message_attachments")
            .select("id, user_id, message_id, storage_path, file_name, mime_type, size_bytes, created_at, expires_at, deleted_at")
            .is("message_id", null)
            .is("deleted_at", null)
            .gt("expires_at", new Date().toISOString())
            .order("created_at", { ascending: false })
            .limit(MAX_CHAT_ATTACHMENT_COUNT),
        ]);
        if (pendingResult.error) {
          throw new Error(`Could not restore draft attachments: ${pendingResult.error.message}`);
        }

        const localIds = localDrafts.map((draft) => draft.id);
        const localReferencesResult =
          localIds.length > 0
            ? await authClient
                .from("chat_message_attachments")
                .select("id, user_id, message_id, storage_path, file_name, mime_type, size_bytes, created_at, expires_at, deleted_at")
                .in("id", localIds)
            : { data: [], error: null };
        if (localReferencesResult.error) {
          throw new Error(
            `Could not reconcile local attachment drafts: ${localReferencesResult.error.message}`,
          );
        }

        const draftById = new Map(localDrafts.map((draft) => [draft.id, draft]));
        const referenceById = new Map(
          localReferencesResult.data.map((reference) => [reference.id, reference]),
        );
        const restored = new Map<string, PendingChatAttachment & { sortAt: number }>();

        for (const draft of localDrafts) {
          const reference = referenceById.get(draft.id);
          if (reference?.message_id) {
            await removeChatAttachmentDraft(authenticatedUserId, draft.id);
            continue;
          }
          if (
            !reference &&
            Date.now() - draft.savedAt >= CHAT_ATTACHMENT_RETENTION_MS
          ) {
            await deleteStoredAttachments([draft.id]);
            await removeChatAttachmentDraft(authenticatedUserId, draft.id);
            continue;
          }
          if (
            reference &&
            isChatAttachmentExpired(reference)
          ) {
            await deleteStoredAttachments([draft.id]);
            await removeChatAttachmentDraft(authenticatedUserId, draft.id);
            continue;
          }

          const uploaded = reference?.message_id === null ? reference : null;
          if (uploaded && uploaded.size_bytes !== draft.file.size) {
            throw new Error(`The saved draft "${draft.file.name}" no longer matches its stored file.`);
          }
          restored.set(draft.id, {
            id: draft.id,
            file: draft.file,
            mimeType: draft.mimeType,
            draftSavedAt: draft.savedAt,
            isUploading: !uploaded,
            isBlocked: false,
            uploadError: null,
            uploaded,
            sortAt: uploaded ? Date.parse(uploaded.created_at) : draft.savedAt,
          });
        }

        for (const row of pendingResult.data) {
          if (draftById.has(row.id)) continue;
          const { data: blob, error: downloadError } = await authClient.storage
            .from(CHAT_ATTACHMENT_BUCKET)
            .download(row.storage_path);
          if (downloadError) {
            throw new Error(`Could not restore "${row.file_name}": ${downloadError.message}`);
          }
          if (blob.size !== row.size_bytes) {
            throw new Error(`The stored file "${row.file_name}" did not match its saved size.`);
          }
          const file = new File([blob], row.file_name, {
            type: row.mime_type,
            lastModified: Date.parse(row.created_at) || Date.now(),
          });
          await saveChatAttachmentDraft(
            authenticatedUserId,
            row.id,
            file,
            row.mime_type,
            Date.parse(row.created_at) || Date.now(),
          );
          restored.set(row.id, {
            id: row.id,
            file,
            mimeType: row.mime_type,
            draftSavedAt: Date.parse(row.created_at),
            isUploading: false,
            isBlocked: false,
            uploadError: null,
            uploaded: row,
            sortAt: Date.parse(row.created_at),
          });
        }

        if (!isMounted) return;
        const drafts = [...restored.values()]
          .sort((first, second) => first.sortAt - second.sortAt)
          .map(({ sortAt: _sortAt, ...attachment }) => attachment);
        drafts.forEach((attachment) => prepareAiBarcodeRead(attachment));
        setAttachedMedia(drafts);
        drafts
          .filter((attachment) => attachment.isUploading)
          .forEach((attachment) => void uploadPendingAttachment(attachment));
      } catch (error) {
        if (isMounted) {
          setSendError(
            error instanceof Error
              ? error.message
              : "Could not restore your attached files.",
          );
        }
      } finally {
        if (isMounted) setIsRestoringDraftAttachments(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [authClient, authenticatedUserId]);

  useEffect(() => {
    if (!authClient || !authUser) return;
    let isMounted = true;
    const tables = [
      "chat_messages",
      "chat_message_versions",
      "chat_conversation_branches",
      "chat_message_attachments",
      "message_feedback",
      "ai_api_keys",
    ] as const;
    let hasConnected = false;
    const syncChatData = async () => {
      try {
        const currentMessages = messagesRef.current;
        const persistedMessageCount = currentMessages.filter(
          (message) => !pendingOptimisticMessageIdsRef.current.has(message.id),
        ).length;
        const {
          loadChatMessagePage,
          loadMessageAttachments,
          loadMessageVersions,
        } = await import("./lib/chat-data");
        const page = await loadChatMessagePage(authClient, {
          limit: Math.max(50, persistedMessageCount + 1),
          userId: authUser.id,
        });
        const messageIds = page.messages.map((message) => message.id);
        const assistantMessageIds = page.messages
          .filter((message) => message.role === "assistant")
          .map((message) => message.id);
        const [
          attachments,
          versions,
          feedbackResult,
          keysResult,
          jobsResult,
        ] = await Promise.all([
          loadMessageAttachments(authClient, messageIds),
          loadMessageVersions(authClient, messageIds),
          assistantMessageIds.length > 0
            ? authClient
                .from("message_feedback")
                .select("message_id, version_number, kind")
                .in("message_id", assistantMessageIds)
                .in("kind", ["like", "dislike"])
            : Promise.resolve({ data: [], error: null }),
          authClient.from("ai_api_keys").select("id").limit(1),
          authClient
            .from("chat_message_jobs")
            .select("*")
            .or("status.in.(queued,processing,failed),error.not.is.null")
            .order("created_at", { ascending: false })
            .limit(50),
        ]);
        if (feedbackResult.error) throw feedbackResult.error;
        if (keysResult.error) throw keysResult.error;
        if (jobsResult.error) throw jobsResult.error;
        if (!isMounted) return;

        const persistedIds = new Set(messageIds);
        const serverMessages: ChatMessage[] = page.messages.map(
          ({ id, role, content, created_at, version_number, thinking_summary }) => ({
            id,
            role,
            text: content,
            createdAt: created_at,
            versionNumber: version_number,
            thinkingSummary: thinking_summary,
            attachments: attachments[id] ?? [],
          }),
        );
        const loadedRatings = Object.fromEntries(
          feedbackResult.data.flatMap((item) =>
            item.kind === "like" || item.kind === "dislike"
              ? [[`${item.message_id}:${item.version_number}`, item.kind]]
              : [],
          ),
        ) as Record<string, AssistantRating>;
        const loadedSelections = Object.fromEntries(
          page.messages.map((message) => [message.id, message.version_number]),
        );

        setMessages((current) => {
          const pendingMessages = current.filter(
            (message) =>
              pendingOptimisticMessageIdsRef.current.has(message.id) &&
              !persistedIds.has(message.id),
          );
          return [...serverMessages, ...pendingMessages].sort(
            (left, right) =>
              new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
          );
        });
        setMessageVersions((current) => ({ ...current, ...versions }));
        setSelectedMessageVersions((current) => ({ ...current, ...loadedSelections }));
        setRatings((current) => {
          const next = { ...current };
          for (const messageId of messageIds) {
            for (const key of Object.keys(next)) {
              if (key.startsWith(`${messageId}:`)) delete next[key];
            }
          }
          return { ...next, ...loadedRatings };
        });
        setHasGeminiApiKey(keysResult.data.length > 0);
        setChatJobs(jobsResult.data);
        setIsSending(
          jobsResult.data.some(
            (job) => job.status === "queued" || job.status === "processing",
          ),
        );
        oldestHistoryCursorRef.current = page.messages[0]
          ? {
              id: page.messages[0].id,
              created_at: page.messages[0].created_at,
            }
          : null;
        hasOlderHistoryRef.current = page.hasMore;
      } catch (error) {
        if (isMounted) {
          setSendError(
            error instanceof Error
              ? `Could not sync live chat updates: ${error.message}`
              : "Could not sync live chat updates.",
          );
        }
      }
    };
    const scheduleChatSync = () => {
      if (!isMounted) return;
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        if (isMounted) void syncChatData();
      }, 120);
    };
    const scheduleJobRefresh = () => {
      if (!isMounted) return;
      if (jobRefreshTimerRef.current !== null) {
        window.clearTimeout(jobRefreshTimerRef.current);
      }
      jobRefreshTimerRef.current = window.setTimeout(() => {
        jobRefreshTimerRef.current = null;
        void (async () => {
          try {
            const { data, error } = await authClient
              .from("chat_message_jobs")
              .select("*")
              .or("status.in.(queued,processing,failed),error.not.is.null")
              .order("created_at", { ascending: false })
              .limit(50);
            if (!isMounted) return;
            if (error) {
              setSendError(`Could not refresh chat job status: ${error.message}`);
              return;
            }
            setChatJobs(data);
            setIsSending(data.some((job) => job.status === "queued" || job.status === "processing"));
          } catch (error) {
            if (!isMounted) return;
            setSendError(
              error instanceof Error
                ? `Could not refresh chat job status: ${error.message}`
                : "Could not refresh chat job status.",
            );
          }
        })();
      }, 80);
    };
    const stopRealtime = subscribeWithReconnect(
      authClient,
      `account-live-${authUser.id}`,
      (initialChannel) => {
        let channel = initialChannel;
        for (const table of tables) {
          channel = channel.on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table,
            },
            scheduleChatSync,
          );
        }
        return channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "chat_message_jobs",
          },
          scheduleJobRefresh,
        );
      },
      (status) => {
        if (!isMounted) return;
        if (status === "SUBSCRIBED") {
          if (hasConnected) {
            scheduleChatSync();
            scheduleJobRefresh();
          }
          hasConnected = true;
          setSendError((current) =>
            current.startsWith("Live sync disconnected. Reconnecting") ? "" : current,
          );
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setSendError("Live sync disconnected. Reconnecting…");
        }
      },
    );

    return () => {
      isMounted = false;
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
      if (jobRefreshTimerRef.current !== null) {
        window.clearTimeout(jobRefreshTimerRef.current);
        jobRefreshTimerRef.current = null;
      }
      stopRealtime();
    };
  }, [authClient, authUser]);

  useEffect(() => {
    if (!attachmentView) return;

    window.history.pushState({ attachmentView: true }, "", window.location.href);
    const closeOnBack = () => {
      attachmentViewRequestRef.current += 1;
      setAttachmentView(null);
      setIsEditorLoading(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.history.back();
    };
    window.addEventListener("popstate", closeOnBack);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("popstate", closeOnBack);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [attachmentView]);

  useEffect(() => {
    if (!remoteAttachmentView) return;

    window.history.pushState(
      { ...window.history.state, remoteAttachmentView: true },
      "",
      window.location.href,
    );
    const closeOnBack = () => setRemoteAttachmentView(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.history.back();
    };
    window.addEventListener("popstate", closeOnBack);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("popstate", closeOnBack);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [remoteAttachmentView]);

  useLayoutEffect(() => {
    const previousPosition = pendingHistoryScrollRestoreRef.current;
    const conversation = conversationRef.current;
    if (previousPosition && conversation) {
      pendingHistoryScrollRestoreRef.current = null;
      conversation.scrollTop =
        previousPosition.top + conversation.scrollHeight - previousPosition.height;
    }
    if (pathname === "/" && shouldScrollToLatestRef.current && conversation) {
      conversation.scrollTop = conversation.scrollHeight;
      followLatestRef.current = true;
    }
  }, [messages, pathname]);

  useEffect(() => {
    if (
      attachmentView ||
      remoteAttachmentView ||
      pendingConversationScrollRestoreRef.current === null
    ) {
      return;
    }

    const scrollTop = pendingConversationScrollRestoreRef.current;
    pendingConversationScrollRestoreRef.current = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (conversationRef.current) conversationRef.current.scrollTop = scrollTop;
      });
    });
  }, [attachmentView, remoteAttachmentView]);

  useEffect(() => {
    if (!isCameraOpen) return;

    let cancelled = false;
    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        showAttachmentToast("Direct camera access is not available in this browser or connection.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: cameraFacing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0];
        void navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            if (!cancelled) {
              setIsCameraSwitchSupported(
                devices.filter((device) => device.kind === "videoinput").length > 1,
              );
            }
          })
          .catch((error: unknown) => {
            if (!cancelled) {
              showAttachmentToast(
                error instanceof Error
                  ? `Could not check whether another camera is available: ${error.message}`
                  : "Could not check whether another camera is available.",
              );
            }
          });
        const trackCapabilities = videoTrack?.getCapabilities() as
          | (MediaTrackCapabilities & { torch?: boolean })
          | undefined;
        setIsCameraTorchSupported(Boolean(trackCapabilities?.torch));
        setIsCameraTorchOn(false);
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          await cameraVideoRef.current.play();
        }
      } catch (error) {
        if (!cancelled) {
          showAttachmentToast(
            error instanceof Error
              ? `Could not start the camera: ${error.message}`
              : "Could not start the camera. Check camera permissions and try again.",
          );
        }
      }
    };
    void startCamera();

    return () => {
      cancelled = true;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
      setIsCameraTorchSupported(false);
      setIsCameraTorchOn(false);
      setIsCameraSwitchSupported(false);
    };
  }, [cameraFacing, isCameraOpen]);

  useEffect(() => {
    if (!isCameraOpen) return;
    window.history.pushState(
      { ...window.history.state, cameraCapture: true },
      "",
      window.location.href,
    );
    cameraHistoryEntryRef.current = true;
    const closeOnBack = () => {
      cameraHistoryEntryRef.current = false;
      setIsCameraOpen(false);
    };
    window.addEventListener("popstate", closeOnBack);
    return () => {
      window.removeEventListener("popstate", closeOnBack);
    };
  }, [isCameraOpen]);

  useEffect(() => {
    if (window.location.pathname.startsWith("/settings/")) {
      const sectionPath = window.location.pathname;
      window.history.replaceState({ appRoute: "settings" }, "", "/settings");
      window.history.pushState({ appRoute: "settings-subpage" }, "", sectionPath);
    } else if (window.location.pathname === "/settings") {
      window.history.replaceState({ appRoute: "settings" }, "", "/settings");
    }

    const handlePopState = () => {
      const nextPath = window.location.pathname;
      if (nextPath.startsWith("/settings")) {
        if (
          nextPath === "/settings" &&
          wasSettingsRef.current &&
          !window.history.state?.appRoute
        ) {
          window.location.replace("/");
          return;
        }
        wasSettingsRef.current = true;
        setPathname(nextPath);
        return;
      }

      if (wasSettingsRef.current) {
        window.location.replace("/");
        return;
      }

      if (nextPath === "/") shouldScrollToLatestRef.current = true;
      setPathname(nextPath);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(path: string) {
    if (path.startsWith("/settings")) {
      const isSwitchingSettingsSections =
        window.location.pathname.startsWith("/settings/") &&
        path.startsWith("/settings/");
      const updateHistory = isSwitchingSettingsSections
        ? window.history.replaceState.bind(window.history)
        : window.history.pushState.bind(window.history);
      updateHistory(
        { appRoute: path === "/settings" ? "settings" : "settings-subpage" },
        "",
        path,
      );
      wasSettingsRef.current = true;
      setPathname(path);
    } else {
      window.location.replace(path);
    }
  }

  async function getAccessToken(): Promise<string> {
    if (!authClient) throw new Error("Sign in before uploading or opening attachments.");
    const {
      data: { session },
      error,
    } = await authClient.auth.getSession();
    if (error) throw error;
    if (!session?.access_token) throw new Error("Your account session has expired. Sign in again.");
    return session.access_token;
  }

  const getAttachmentPreviewUrl = useCallback(
    async (attachment: ChatAttachment): Promise<string> => {
      const accessToken = await getAccessToken();
      const response = await fetch("/api/chat-attachment-link", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: attachment.id }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "statusMessage" in payload &&
          typeof payload.statusMessage === "string"
            ? payload.statusMessage
            : `Could not load attachment preview (${response.status}).`;
        throw new Error(message);
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("signedUrl" in payload) ||
        typeof payload.signedUrl !== "string"
      ) {
        throw new Error("The attachment service returned an invalid preview link.");
      }
      return payload.signedUrl;
    },
    [authClient],
  );

  async function registerChatAttachment(
    attachment: PendingChatAttachment,
  ): Promise<ChatAttachment> {
    if (!authClient) throw new Error("Sign in before uploading attachments.");
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();
    if (userError) throw userError;
    if (!user || user.is_anonymous) throw new Error("Sign in before uploading attachments.");

    const storagePath = `${user.id}/${attachment.id}`;
    const digest = await crypto.subtle.digest("SHA-256", await attachment.file.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    async function register(action: "prepare" | "register"): Promise<ChatAttachmentRegistration> {
      const accessToken = await getAccessToken();
      const response = await fetch("/api/chat-attachments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          id: attachment.id,
          fileName: attachment.file.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.file.size,
          sha256,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "statusMessage" in payload &&
          typeof payload.statusMessage === "string"
            ? payload.statusMessage
            : `Could not register attachment (${response.status}).`;
        throw new Error(message);
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("uploadRequired" in payload) ||
        typeof payload.uploadRequired !== "boolean" ||
        !("reused" in payload) ||
        typeof payload.reused !== "boolean"
      ) {
        throw new Error("The attachment service returned an invalid response.");
      }
      if (payload.uploadRequired) return { uploadRequired: true, reused: false };
      if (!("attachment" in payload) || !isChatAttachment(payload.attachment)) {
        throw new Error("The attachment service returned invalid attachment metadata.");
      }
      return {
        uploadRequired: false,
        reused: payload.reused,
        attachment: payload.attachment,
      };
    }

    let registration = await register("prepare");
    if (registration.uploadRequired) {
      if (cancelledAttachmentsRef.current.has(attachment.id)) {
        throw new Error("The attachment was removed before its upload began.");
      }
      const { error: uploadError } = await authClient.storage
        .from(CHAT_ATTACHMENT_BUCKET)
        .upload(storagePath, attachment.file, {
          contentType: attachment.mimeType,
          upsert: false,
        });
      if (uploadError) throw new Error(`Could not upload ${attachment.file.name}: ${uploadError.message}`);
      registration = await register("register");
    }

    if (registration.uploadRequired || !registration.attachment) {
      throw new Error("The attachment service did not finish registering the file.");
    }
    return registration.attachment;
  }

  async function uploadPendingAttachment(
    attachment: PendingChatAttachment,
  ): Promise<ChatAttachment | null> {
    let preprocessingFailed = false;
    try {
      if (!authUser) throw new Error("Sign in before saving an attachment draft.");
      let uploadable = attachment;
      if (!attachment.isPreprocessed) {
        let processed: Awaited<ReturnType<typeof preprocessChatAttachment>>;
        try {
          processed = await preprocessChatAttachment(attachment.file, attachment.mimeType);
        } catch (error) {
          preprocessingFailed = true;
          throw error;
        }
        if (cancelledAttachmentsRef.current.has(attachment.id)) {
          throw new Error("The attachment was removed from the composer.");
        }
        if (processed.oversized) {
          const message = `This file is still larger than ${formatChatAttachmentSize(MAX_CHAT_ATTACHMENT_BYTES)} after processing and was not uploaded.`;
          setAttachedMedia((current) =>
            current.map((item) =>
              item.id === attachment.id
                ? { ...item, isUploading: false, isBlocked: true, uploadError: message }
                : item,
            ),
          );
          setSendError(message);
          return null;
        }
        const mimeType = resolveChatAttachmentMimeType(processed.file);
        if (!mimeType) throw new Error("The processed file type is not supported for upload.");
        uploadable = {
          ...attachment,
          file: processed.file,
          mimeType,
          isPreprocessed: true,
        };
        setAttachedMedia((current) =>
          current.map((item) =>
            item.id === attachment.id
              ? {
                  ...item,
                  file: processed.file,
                  mimeType,
                  isPreprocessed: true,
                }
              : item,
          ),
        );
      }
      prepareAiBarcodeRead(uploadable);
      await saveChatAttachmentDraft(
        authUser.id,
        uploadable.id,
        uploadable.file,
        uploadable.mimeType,
        uploadable.draftSavedAt,
      );
      if (cancelledAttachmentsRef.current.has(uploadable.id)) {
        throw new Error("The attachment was removed from the composer.");
      }
      const uploaded = await registerChatAttachment(uploadable);
      if (cancelledAttachmentsRef.current.has(uploadable.id)) {
        await deleteStoredAttachments([uploadable.id]);
        await removeChatAttachmentDraft(authUser.id, uploadable.id);
        cancelledAttachmentsRef.current.delete(uploadable.id);
        return null;
      }
      setAttachedMedia((current) =>
        current.map((item) =>
          item.id === uploadable.id
            ? { ...item, isUploading: false, isBlocked: false, uploadError: null, uploaded }
            : item,
        ),
      );
      return uploaded;
    } catch (error) {
      if (cancelledAttachmentsRef.current.has(attachment.id)) {
        try {
          if (!authUser) throw new Error("Sign in again to clean up this attachment.");
          await deleteStoredAttachments([attachment.id]);
          await removeChatAttachmentDraft(authUser.id, attachment.id);
          cancelledAttachmentsRef.current.delete(attachment.id);
        } catch (cleanupError) {
          setSendError(
            cleanupError instanceof Error
              ? `The file was removed from the composer, but cleanup failed: ${cleanupError.message}`
              : "The file was removed from the composer, but cleanup failed.",
          );
        }
        return null;
      }
      const message =
        error instanceof Error ? error.message : `Could not upload ${attachment.file.name}.`;
      if (preprocessingFailed) {
        setAttachedMedia((current) => current.filter((item) => item.id !== attachment.id));
        setSendError(message);
        return null;
      }
      setAttachedMedia((current) =>
        current.map((item) =>
          item.id === attachment.id
            ? { ...item, isUploading: false, isBlocked: false, uploadError: message }
            : item,
        ),
      );
      setSendError(message);
      return null;
    }
  }

  async function deleteStoredAttachments(ids: string[]) {
    if (ids.length === 0) return;
    const accessToken = await getAccessToken();
    const response = await fetch("/api/chat-attachments-delete", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "statusMessage" in payload &&
        typeof payload.statusMessage === "string"
          ? payload.statusMessage
          : `Could not delete attachments (${response.status}).`;
      throw new Error(message);
    }
  }

  function closeRemoteAttachmentView() {
    setRemoteAttachmentView(null);
    if (window.history.state?.remoteAttachmentView) {
      window.history.back();
    }
  }

  async function openStoredAttachment(attachment: ChatAttachment) {
    if (isChatAttachmentExpired(attachment)) {
      setSendError(`"${attachment.file_name}" expired after 24 hours and is no longer available.`);
      return;
    }

    try {
      const accessToken = await getAccessToken();
      const response = await fetch("/api/chat-attachment-link", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: attachment.id }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "statusMessage" in payload &&
          typeof payload.statusMessage === "string"
            ? payload.statusMessage
            : `Could not open attachment (${response.status}).`;
        throw new Error(message);
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("signedUrl" in payload) ||
        typeof payload.signedUrl !== "string"
      ) {
        throw new Error("The attachment service returned an invalid link.");
      }
      let textContent: string | null = null;
      if (isTextAttachment(attachment.mime_type, attachment.file_name)) {
        const fileResponse = await fetch(payload.signedUrl);
        if (!fileResponse.ok) {
          throw new Error(`Could not load file preview (${fileResponse.status}).`);
        }
        textContent = await fileResponse.text();
        if (textContent.includes("\0")) {
          throw new Error("This file contains binary data and cannot be previewed as text.");
        }
      }
      pendingConversationScrollRestoreRef.current = conversationRef.current?.scrollTop ?? 0;
      setRemoteAttachmentView({ attachment, signedUrl: payload.signedUrl, textContent });
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not open attachment.");
    }
  }

  function addPickedFiles(fileList: FileList | File[] | null, alreadyProcessed = false) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    if (preparingAttachmentsRef.current) {
      setSendError("Wait for the current files to finish processing before adding more.");
      return;
    }

    const availableSlots = Math.max(0, MAX_CHAT_ATTACHMENT_COUNT - attachedMedia.length);
    const acceptedFiles: PendingChatAttachment[] = [];
    let rejectedCount = 0;
    const rejectionReasons: string[] = [];
    for (const file of files) {
      if (acceptedFiles.length >= availableSlots) {
        rejectedCount += 1;
        rejectionReasons.push(`A message can include up to ${MAX_CHAT_ATTACHMENT_COUNT} files.`);
        continue;
      }

      if (file.size < 1 || file.size > MAX_CHAT_ATTACHMENT_SOURCE_BYTES) {
        rejectedCount += 1;
        rejectionReasons.push(
          `Files must be no larger than ${formatChatAttachmentSize(MAX_CHAT_ATTACHMENT_SOURCE_BYTES)} before processing.`,
        );
        continue;
      }
      const mimeType = resolveChatAttachmentMimeType(file);
      if (!mimeType) {
        rejectedCount += 1;
        rejectionReasons.push(
          `"${file.name}" is not a supported image, video, audio, PDF, or text file.`,
        );
        continue;
      }
      acceptedFiles.push({
        id: crypto.randomUUID(),
        file,
        mimeType,
        isUploading: true,
        isBlocked: false,
        isPreprocessed: alreadyProcessed,
        uploadError: null,
        uploaded: null,
      });
    }
    if (acceptedFiles.length > 0) {
      setAttachedMedia((current) => [...current, ...acceptedFiles]);
      preparingAttachmentsRef.current = true;
      setIsPreparingAttachments(true);
      void (async () => {
        let projectedBytes = attachedMedia
          .filter((attachment) => !attachment.isBlocked)
          .reduce((total, attachment) => total + attachment.file.size, 0);
        for (const attachment of acceptedFiles) {
          if (cancelledAttachmentsRef.current.has(attachment.id)) {
            cancelledAttachmentsRef.current.delete(attachment.id);
            continue;
          }
          try {
            const processed = alreadyProcessed
              ? {
                  file: attachment.file,
                  oversized: attachment.file.size > MAX_CHAT_ATTACHMENT_BYTES,
                }
              : await preprocessChatAttachment(attachment.file, attachment.mimeType);
            if (cancelledAttachmentsRef.current.has(attachment.id)) {
              cancelledAttachmentsRef.current.delete(attachment.id);
              continue;
            }
            if (processed.oversized) {
              const message = `This file is still larger than ${formatChatAttachmentSize(MAX_CHAT_ATTACHMENT_BYTES)} after processing and was not uploaded.`;
              setAttachedMedia((current) =>
                current.map((item) =>
                  item.id === attachment.id
                    ? {
                        ...item,
                        isUploading: false,
                        isBlocked: true,
                        uploadError: message,
                      }
                    : item,
                ),
              );
              rejectionReasons.push(`"${attachment.file.name}" is still too large after processing.`);
              continue;
            }

            if (projectedBytes + processed.file.size > MAX_CHAT_MESSAGE_ATTACHMENT_BYTES) {
              const message = `Attachments in one message cannot exceed ${formatChatAttachmentSize(MAX_CHAT_MESSAGE_ATTACHMENT_BYTES)} total.`;
              setAttachedMedia((current) =>
                current.map((item) =>
                  item.id === attachment.id
                    ? {
                        ...item,
                        isUploading: false,
                        isBlocked: true,
                        uploadError: message,
                      }
                    : item,
                ),
              );
              rejectionReasons.push(message);
              continue;
            }

            const processedMimeType = resolveChatAttachmentMimeType(processed.file);
            if (!processedMimeType) {
              throw new Error("The processed file type is not supported for upload.");
            }
            const readyAttachment: PendingChatAttachment = {
              ...attachment,
              file: processed.file,
              mimeType: processedMimeType,
              isPreprocessed: true,
            };
            setAttachedMedia((current) =>
              current.map((item) =>
                item.id === attachment.id
                  ? {
                      ...item,
                      file: processed.file,
                      mimeType: processedMimeType,
                      isPreprocessed: true,
                    }
                  : item,
              ),
            );
            projectedBytes += processed.file.size;
            void uploadPendingAttachment(readyAttachment);
          } catch (error) {
            if (cancelledAttachmentsRef.current.has(attachment.id)) {
              cancelledAttachmentsRef.current.delete(attachment.id);
              continue;
            }
            const message =
              error instanceof Error ? error.message : `Could not process "${attachment.file.name}".`;
            setAttachedMedia((current) =>
              current.filter((item) => item.id !== attachment.id),
            );
            rejectedCount += 1;
            rejectionReasons.push(message);
          }
        }
        preparingAttachmentsRef.current = false;
        setIsPreparingAttachments(false);
        if (rejectedCount > 0 || rejectionReasons.length > 0) {
          const details = [...new Set(rejectionReasons)].join(" ");
          const countMessage =
            rejectedCount > 0
              ? ` ${rejectedCount} file${rejectedCount === 1 ? " was" : "s were"} not added.`
              : "";
          showAttachmentToast(`${details}${countMessage}`.trim());
        } else {
          setSendError("");
        }
      })();
    }
    if (rejectedCount > 0 && acceptedFiles.length === 0) {
      showAttachmentToast(
        `${[...new Set(rejectionReasons)].join(" ")} ${rejectedCount} file${rejectedCount === 1 ? " was" : "s were"} not added.`,
      );
    } else if (acceptedFiles.length === 0) {
      setSendError("");
    }
  }

  function openCamera() {
    setIsCameraOpen(true);
  }

  function leaveCameraHistoryEntry() {
    if (!cameraHistoryEntryRef.current) return;
    cameraHistoryEntryRef.current = false;
    window.history.back();
  }

  function closeCamera() {
    leaveCameraHistoryEntry();
    setIsCameraOpen(false);
  }

  async function toggleCameraTorch() {
    const track = cameraStreamRef.current?.getVideoTracks()[0];
    if (!track || !isCameraTorchSupported) return;

    const nextTorchState = !isCameraTorchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: nextTorchState } as MediaTrackConstraintSet & { torch: boolean }],
      });
      setIsCameraTorchOn(nextTorchState);
    } catch (error) {
      showAttachmentToast(
        error instanceof Error
          ? `Could not change the camera light: ${error.message}`
          : "Could not change the camera light on this device.",
      );
    }
  }

  async function captureCameraPhoto() {
    if (preparingAttachmentsRef.current) {
      showAttachmentToast("Wait for the current files to finish processing before capturing a photo.");
      return;
    }
    const video = cameraVideoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      showAttachmentToast("The camera is not ready yet. Please wait a moment and try again.");
      return;
    }

    const track = cameraStreamRef.current?.getVideoTracks()[0];
    const imageCaptureConstructor = (
      window as Window & {
        ImageCapture?: new (track: MediaStreamTrack) => { takePhoto: () => Promise<Blob> };
      }
    ).ImageCapture;
    let imageBlob: Blob | null = null;

    try {
      if (track && imageCaptureConstructor) {
        try {
          imageBlob = await new imageCaptureConstructor(track).takePhoto();
        } catch {
          imageBlob = null;
        }
      }
      if (!imageBlob) {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not prepare the image for capture.");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        imageBlob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.9),
        );
        canvas.width = 0;
        canvas.height = 0;
      }
      if (!imageBlob) throw new Error("Could not encode the captured photo.");

      addPickedFiles(
        [
          new File(
            [imageBlob],
            `camera-${Date.now()}.${imageBlob.type === "image/png" ? "png" : "jpg"}`,
            {
              type: imageBlob.type || "image/jpeg",
              lastModified: Date.now(),
            },
          ),
        ],
      );
      closeCamera();
    } catch (error) {
      showAttachmentToast(
        error instanceof Error ? error.message : "Could not capture a photo. Please try again.",
      );
    }
  }

  async function removeAttachedFile(indexToRemove: number) {
    const attachment = attachedMedia[indexToRemove];
    if (!attachment) return;
    if (!authClient) {
      setSendError("Sign in before removing uploaded files.");
      return;
    }
    if (attachment.isUploading) cancelledAttachmentsRef.current.add(attachment.id);
    barcodeReadsRef.current.delete(attachment.id);
    setAttachedMedia((files) => files.filter((_, index) => index !== indexToRemove));
    try {
      await deleteStoredAttachments([attachment.id]);
      if (authUser) await removeChatAttachmentDraft(authUser.id, attachment.id);
      if (!attachment.isUploading) cancelledAttachmentsRef.current.delete(attachment.id);
    } catch (error) {
      setSendError(
        error instanceof Error ? error.message : `Could not remove ${attachment.file.name}.`,
      );
    }
  }

  async function openAttachment(index: number) {
    const pending = attachedMedia[index];
    const file = pending?.file;
    if (!pending || !file) return;

    const requestId = ++attachmentViewRequestRef.current;
    const isMedia = pending.mimeType.startsWith("image/") || pending.mimeType.startsWith("video/");
    pendingConversationScrollRestoreRef.current = conversationRef.current?.scrollTop ?? 0;
    setAttachmentView({ index, mode: isMedia ? "media" : "editor" });
    setEditorContent("");
    editorOriginalContentRef.current = null;
    setEditorError("");

    if (isMedia) return;

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (isTextAttachment(pending.mimeType, file.name)) {
      setIsEditorLoading(true);
      try {
        const content = await file.text();
        if (content.includes("\0")) {
          setEditorError("This file contains binary data and cannot be edited as text.");
        } else if (requestId === attachmentViewRequestRef.current) {
          editorOriginalContentRef.current = content;
          setEditorContent(content);
        }
      } catch (error) {
        if (requestId === attachmentViewRequestRef.current) {
          setEditorError(
            error instanceof Error ? `Could not read this file: ${error.message}` : "Could not read this file.",
          );
        }
      } finally {
        if (requestId === attachmentViewRequestRef.current) setIsEditorLoading(false);
      }
      return;
    }

    if (binaryFileExtensions.has(extension) || pending.mimeType.startsWith("application/")) {
      setEditorError("This file is binary and cannot be edited in the text editor.");
      return;
    }

    setIsEditorLoading(true);
    try {
      const content = await file.text();
      if (requestId !== attachmentViewRequestRef.current) return;
      if (content.includes("\0")) {
        setEditorError("This file contains binary data and cannot be edited as text.");
      } else {
        editorOriginalContentRef.current = content;
        setEditorContent(content);
      }
    } catch (error) {
      if (requestId === attachmentViewRequestRef.current) {
        setEditorError(
          error instanceof Error ? `Could not read this file: ${error.message}` : "Could not read this file.",
        );
      }
    } finally {
      if (requestId === attachmentViewRequestRef.current) setIsEditorLoading(false);
    }
  }

  function closeAttachmentView() {
    attachmentViewRequestRef.current += 1;
    setAttachmentView(null);
    setIsEditorLoading(false);
    if (window.history.state?.attachmentView) {
      window.history.back();
    }
  }

  async function commitFileEdit() {
    if (!attachmentView || attachmentView.mode !== "editor") return;

    const original = attachedMedia[attachmentView.index];
    if (original && !editorError && !isEditorLoading) {
      if (editorContent === editorOriginalContentRef.current) {
        closeAttachmentView();
        return;
      }
      const editedFile = new File([editorContent], original.file.name, {
        type: original.mimeType,
        lastModified: Date.now(),
      });
      if (editedFile.size > MAX_CHAT_ATTACHMENT_BYTES) {
        setEditorError(
          `Edited files must be no larger than ${formatChatAttachmentSize(MAX_CHAT_ATTACHMENT_BYTES)}.`,
        );
        return;
      }
      const mimeType = resolveChatAttachmentMimeType(editedFile);
      if (!mimeType) {
        setEditorError("The edited file type is not supported for upload.");
        return;
      }
      const replacement: PendingChatAttachment = {
        id: crypto.randomUUID(),
        file: editedFile,
        mimeType,
        isUploading: true,
        isBlocked: false,
        uploadError: null,
        uploaded: null,
      };
      setAttachedMedia((files) =>
        files.map((item, index) => (index === attachmentView.index ? replacement : item)),
      );
      const uploaded = await uploadPendingAttachment(replacement);
      if (!uploaded) {
        setAttachedMedia((files) =>
          files.map((item) => (item.id === replacement.id ? original : item)),
        );
        setEditorError("The edited file could not be saved. Your original file is unchanged.");
        return;
      }
      try {
        if (original.uploaded) await deleteStoredAttachments([original.id]);
        if (authUser) await removeChatAttachmentDraft(authUser.id, original.id);
      } catch (error) {
        setSendError(
          error instanceof Error
            ? `The edited file was saved, but the previous draft could not be removed: ${error.message}`
            : "The edited file was saved, but the previous draft could not be removed.",
        );
      }
      closeAttachmentView();
      return;
    }
    closeAttachmentView();
  }

  function formatFileSize(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function sendMessage() {
    if (isAttachmentUploadPending || isRestoringDraftAttachments) return;
    if (!authUser) {
      setSendError("Sign in with Google before starting a chat.");
      return;
    }
    if (!hasGeminiApiKey) {
      setSendError("Add a Gemini API key in Settings → Configure before using chat.");
      return;
    }
    const promptInput = messageInputRef.current?.value ?? "";
    const prompt = promptInput.trim();
    if (!prompt && attachedMedia.length === 0) {
      setSendError("Write a message or attach a file before sending it.");
      return;
    }
    if (prompt.length > 50000) {
      setSendError("Messages must be 50,000 characters or fewer.");
      return;
    }
    if (attachedMedia.some((attachment) => attachment.isBlocked)) {
      setSendError("Remove files that could not be processed or are over the upload limit before sending.");
      return;
    }
    if (attachedMedia.some((attachment) => !attachment.uploaded)) {
      setSendError("Wait for every attachment to finish uploading, or remove failed uploads.");
      return;
    }

    setSendError("");
    setIsSending(true);
    const showThinking = thinkingModeRef.current;
    let jobAccepted = false;
    const optimisticId = crypto.randomUUID();
    const submittedAttachments = attachedMedia;
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      role: "user",
      text: prompt || "Please review the attached files.",
      createdAt: new Date().toISOString(),
      versionNumber: 1,
      thinkingSummary: null,
      attachments: submittedAttachments.flatMap((attachment) =>
        attachment.uploaded ? [attachment.uploaded] : [],
      ),
    };
    pendingOptimisticMessageIdsRef.current.add(optimisticId);
    setMessages((current) => [...current, optimisticMessage]);
    setAttachedMedia([]);
    if (messageInputRef.current) {
      messageInputRef.current.value = "";
      resizeMessageInput(messageInputRef.current);
    }
    try {
      if (!authClient) throw new Error("Sign in before sending a message.");
      const {
        data: { session },
        error: sessionError,
      } = await authClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error("Your account session has expired. Sign in again.");

      const barcodeReadings = (
        await Promise.all(
          submittedAttachments.map(async (attachment) => {
            if (!attachment.uploaded) return null;
            const scan = prepareAiBarcodeRead(attachment);
            if (!scan) return null;
            const reading = await scan;
            return reading ? { attachmentId: attachment.id, ...reading } : null;
          }),
        )
      ).filter((reading): reading is AiBarcodeReading => reading !== null);
      const response = await fetch("/api/chat-jobs", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: prompt,
          thinkingMode: showThinking,
          attachmentIds: submittedAttachments.map((attachment) => attachment.id),
          barcodeReadings,
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { jobId?: string; messageId?: string; statusMessage?: string; message?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          result?.statusMessage ??
            result?.message ??
            `The chat server could not queue your message (${response.status}).`,
        );
      }
      if (!result?.jobId || !result.messageId) {
        throw new Error("The chat server accepted an invalid job response.");
      }

      jobAccepted = true;
      pendingOptimisticMessageIdsRef.current.delete(optimisticId);
      submittedAttachments.forEach((attachment) => barcodeReadsRef.current.delete(attachment.id));
      messageDraftRef.current = "";
      if (messageDraftSaveTimerRef.current) {
        clearTimeout(messageDraftSaveTimerRef.current);
        messageDraftSaveTimerRef.current = null;
      }
      try {
        localStorage.removeItem(messageDraftStorageKey(authUser.id));
      } catch (error) {
        setSendError(
          error instanceof Error
            ? `Your message was sent, but the local draft could not be cleared: ${error.message}`
            : "Your message was sent, but the local draft could not be cleared.",
        );
      }
      pendingAssistantAnchorRef.current = result.messageId;
      setMessages((current) => {
        const serverMessageExists = current.some((item) => item.id === result.messageId);
        return current.flatMap((item) => {
          if (item.id !== optimisticId) return [item];
          if (serverMessageExists) return [];
          return [
            {
              ...item,
              id: result.messageId!,
              attachments: submittedAttachments.flatMap((attachment) =>
                attachment.uploaded ? [attachment.uploaded] : [],
              ),
            },
          ];
        });
      });
      if (authUser) {
        void Promise.all(
          submittedAttachments.map((attachment) =>
            removeChatAttachmentDraft(authUser.id, attachment.id),
          ),
        ).catch((error: unknown) => {
          setSendError(
            `Your message was sent, but the local attachment draft could not be cleared: ${
              error instanceof Error ? error.message : "unknown local storage error"
            }`,
          );
        });
      }
      setThinkingSteps(showThinking ? ["Membaca pesan dan konteks percakapan…"] : []);
    } catch (error) {
      if (!jobAccepted) {
        pendingOptimisticMessageIdsRef.current.delete(optimisticId);
        setMessages((current) => current.filter((item) => item.id !== optimisticId));
        setAttachedMedia((current) => [...submittedAttachments, ...current]);
        if (messageInputRef.current && !messageInputRef.current.value) {
          messageInputRef.current.value = promptInput;
          resizeMessageInput(messageInputRef.current);
        }
        messageDraftRef.current = promptInput;
      }
      setSendError(error instanceof Error ? error.message : "Could not send your message.");
    } finally {
      setThinkingSteps([]);
      if (!jobAccepted) setIsSending(false);
    }
  }

  async function handleAssistantRating(
    messageId: string,
    versionNumber: number,
    rating: AssistantRating,
  ) {
    const ratingKey = `${messageId}:${versionNumber}`;
    const nextRating = ratings[ratingKey] === rating ? null : rating;
    try {
      const [
        { createSupabaseClient, ensureSupabaseSession, loadDatabaseConfig },
        { saveAssistantRating },
      ] = await Promise.all([import("./lib/supabase"), import("./lib/chat-data")]);
      const config = loadDatabaseConfig();
      if (!config) throw new Error("The CheyaVerse account service is not configured.");
      const client = createSupabaseClient(config);
      await ensureSupabaseSession(client);
      await saveAssistantRating(client, messageId, versionNumber, nextRating);
      setRatings((current) => {
        const updated = { ...current };
        if (nextRating) updated[ratingKey] = nextRating;
        else delete updated[ratingKey];
        return updated;
      });
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not save feedback.");
    }
  }

  async function submitAssistantReport() {
    if (!reportTarget) return;
    const details = reportDetailsRef.current.trim();
    if (!details) {
      setReportError("Write a short description before sending a report.");
      return;
    }
    setIsSavingReport(true);
    setReportError("");
    try {
      const [
        { createSupabaseClient, ensureSupabaseSession, loadDatabaseConfig },
        { saveAssistantReport },
      ] = await Promise.all([import("./lib/supabase"), import("./lib/chat-data")]);
      const config = loadDatabaseConfig();
      if (!config) throw new Error("The CheyaVerse account service is not configured.");
      const client = createSupabaseClient(config);
      await ensureSupabaseSession(client);
      await saveAssistantReport(
        client,
        reportTarget.id,
        reportTarget.versionNumber,
        details,
      );
      setReportTarget(null);
      reportDetailsRef.current = "";
      setReportError("");
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Could not save this report.");
    } finally {
      setIsSavingReport(false);
    }
  }

  async function copyMessageText(messageId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1800);
    } catch (error) {
      setSendError(
        error instanceof Error
          ? `Could not copy this reply: ${error.message}`
          : "Could not copy this reply.",
      );
    }
  }

  async function copyAssistantMessage(chatMessage: ChatMessage) {
    await copyMessageText(chatMessage.id, displayedMessageText(chatMessage));
  }

  async function deleteChatBranchFromMessage() {
    if (!deleteChatTarget || !authClient || isDeletingChatBranch) return;
    const targetId = deleteChatTarget.id;
    const targetIndex = messages.findIndex((item) => item.id === targetId);
    setIsDeletingChatBranch(true);
    setSendError("");
    try {
      if (targetIndex < 0) {
        throw new Error("Reload the conversation before deleting this message branch.");
      }
      const attachmentIds = messages
        .slice(targetIndex)
        .flatMap((message) => message.attachments ?? [])
        .map((attachment) => attachment.id);
      if (attachmentIds.length > 0) await deleteStoredAttachments(attachmentIds);

      const { data: removedCount, error } = await authClient.rpc(
        "delete_chat_branch_from_message",
        { p_message_id: targetId },
      );
      if (error) {
        throw new Error(
          `Could not delete this message branch. Confirm the latest supabase/schema.sql has been run. ${error.message}`,
        );
      }
      if (removedCount < 1) {
        throw new Error("The message branch was not found, so nothing was deleted.");
      }

      const removedIds = new Set(messages.slice(targetIndex).map((item) => item.id));
      setMessages((current) => current.slice(0, targetIndex));
      setMessageVersions((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => !removedIds.has(id))),
      );
      setSelectedMessageVersions((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => !removedIds.has(id))),
      );
      setRatings((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([key]) => ![...removedIds].some((id) => key.startsWith(`${id}:`)),
          ),
        ),
      );
      setChatJobs((current) =>
        current.filter((job) => !removedIds.has(job.message_id)),
      );
      setActiveUserActions(null);
      setDeleteChatTarget(null);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not delete this message branch.");
    } finally {
      setIsDeletingChatBranch(false);
    }
  }

  async function regenerateAssistantMessage(
    messageId: string,
    editedSource?: { text: string; versionNumber: number },
  ) {
    if (isSending) return;
    const assistantIndex = messages.findIndex((item) => item.id === messageId);
    const sourceIndex = assistantIndex - 1;
    const sourceMessage = sourceIndex >= 0 ? messages[sourceIndex] : undefined;
    if (
      assistantIndex < 0 ||
      messages[assistantIndex].role !== "assistant" ||
      !sourceMessage ||
      sourceMessage.role !== "user"
    ) {
      setSendError("Could not find the user message for this reply.");
      return;
    }
    const sourceText = editedSource?.text ?? displayedMessageText(sourceMessage);
    const previousAnswer = displayedMessageText(messages[assistantIndex]);
    const previousVersionNumber = displayedVersionNumber(messages[assistantIndex]);

    setIsSending(true);
    setSendError("");
    const showThinking = thinkingModeRef.current;
    setThinkingSteps(showThinking ? ["Mencari konteks untuk menyusun ulang jawaban…"] : []);
    try {
      const [
        {
          createSupabaseClient,
          DEFAULT_PERSONALIZATION,
          ensureSupabaseSession,
          loadDatabaseConfig,
          saveApiStatus,
        },
        {
          createEmbedding,
          executeChatDataTool,
          findRelevantContext,
          loadMessageCreatedAt,
          loadMessageFeedback,
          loadMessageVersions,
          loadRecentAssistantFeedback,
          loadRecentInsights,
          saveChatBranch,
          updateChatMessage,
        },
      ] = await Promise.all([import("./lib/supabase"), import("./lib/chat-data")]);
      const config = loadDatabaseConfig();
      if (!config) throw new Error("The CheyaVerse account service is not configured.");
      const client = createSupabaseClient(config);
      await ensureSupabaseSession(client);
      const [{ data: keys, error: keysError }, { data: profile, error: profileError }] =
        await Promise.all([
          client
            .from("ai_api_keys")
            .select("id, model, api_key, status, last_error, created_at")
            .order("created_at", { ascending: true })
            .order("id", { ascending: true }),
          client
            .from("user_settings")
            .select("display_name, custom_prompt, chat_style")
            .maybeSingle(),
        ]);
      if (keysError) throw keysError;
      if (profileError) throw profileError;
      if (keys.length === 0) throw new Error("Add a Gemini API key in Settings first.");

      const startIndex = ((nextApiIndexRef.current % keys.length) + keys.length) % keys.length;
      const selectedKey = keys[startIndex];
      const [queryResult, insightsResult] = await Promise.allSettled([
        createEmbedding(selectedKey.api_key, sourceText, "RETRIEVAL_QUERY"),
        loadMessageCreatedAt(client, sourceMessage.id),
      ]);
      const regenerationWarnings: string[] = [];
      if (queryResult.status === "rejected") {
        regenerationWarnings.push(
          `Semantic retrieval was unavailable: ${
            queryResult.reason instanceof Error
              ? queryResult.reason.message
              : "Could not create a retrieval query."
          }`,
        );
      }
      const targetCreatedAt =
        insightsResult.status === "fulfilled" ? insightsResult.value : undefined;
      if (insightsResult.status === "rejected") {
        regenerationWarnings.push(
          `The message timestamp could not be loaded: ${
            insightsResult.reason instanceof Error
              ? insightsResult.reason.message
              : "Unknown database error."
          }`,
        );
      }
      const history = messages.slice(0, sourceIndex).slice(-12);
      const [feedbackResult, recentFeedbackResult] = await Promise.allSettled([
        loadMessageFeedback(client, messageId, previousVersionNumber),
        loadRecentAssistantFeedback(
          client,
          history.filter((item) => item.role === "assistant").map((item) => item.id),
        ),
      ]);
      const previousFeedback =
        feedbackResult.status === "fulfilled"
          ? feedbackResult.value
          : { rating: null, reports: [] };
      if (feedbackResult.status === "rejected") {
        regenerationWarnings.push(
          `Feedback for the previous answer could not be loaded: ${
            feedbackResult.reason instanceof Error
              ? feedbackResult.reason.message
              : "Unknown database error."
          }`,
        );
      }
      const recentFeedback =
        recentFeedbackResult.status === "fulfilled" ? recentFeedbackResult.value : [];
      if (recentFeedbackResult.status === "rejected") {
        regenerationWarnings.push(
          `Other saved response feedback could not be loaded: ${
            recentFeedbackResult.reason instanceof Error
              ? recentFeedbackResult.reason.message
              : "Unknown database error."
          }`,
        );
      }
      const [contextResult, insightsContextResult] = await Promise.allSettled([
        queryResult.status === "fulfilled" && targetCreatedAt
          ? findRelevantContext(
              client,
              queryResult.value,
              sourceMessage.id,
              targetCreatedAt,
            )
          : Promise.resolve({ messages: [], memories: [] }),
        targetCreatedAt
          ? loadRecentInsights(client, 12, sourceMessage.id, targetCreatedAt)
          : Promise.resolve([]),
      ]);
      if (contextResult.status === "rejected") {
        regenerationWarnings.push(
          `Related context could not be loaded: ${
            contextResult.reason instanceof Error
              ? contextResult.reason.message
              : "Unknown database error."
          }`,
        );
      }
      if (insightsContextResult.status === "rejected") {
        regenerationWarnings.push(
          `Recent insights could not be loaded: ${
            insightsContextResult.reason instanceof Error
              ? insightsContextResult.reason.message
              : "Unknown database error."
          }`,
        );
      }
      const relevantContext =
        contextResult.status === "fulfilled"
          ? contextResult.value
          : { messages: [], memories: [] };
      const insights =
        insightsContextResult.status === "fulfilled" ? insightsContextResult.value : [];
      const attachmentMessageIds = [...history.map((item) => item.id), sourceMessage.id];
      const { data: savedAttachments, error: attachmentsError } = await client
        .from("chat_message_attachments")
        .select("id, file_name, mime_type, storage_path, message_id, created_at, expires_at, deleted_at")
        .in("message_id", attachmentMessageIds)
        .is("deleted_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (attachmentsError) {
        throw new Error(`Could not load unexpired chat attachments: ${attachmentsError.message}`);
      }
      const currentAttachments = savedAttachments.filter(
        (attachment) => attachment.message_id === sourceMessage.id,
      );
      const earlierAttachments = savedAttachments.filter(
        (attachment) => attachment.message_id !== sourceMessage.id,
      );
      const attachmentsForModel = [...currentAttachments, ...earlierAttachments]
        .slice(0, MAX_GEMINI_CONTEXT_ATTACHMENTS)
        .map<GeminiAttachmentReference>((attachment) => ({
          id: attachment.id,
          fileName: attachment.file_name,
          mimeType: attachment.mime_type,
          storagePath: attachment.storage_path,
          messageCreatedAt:
            history.find((item) => item.id === attachment.message_id)?.createdAt ??
            sourceMessage.createdAt,
        }));
      const barcodeReadings = (
        await Promise.all(
          currentAttachments
            .filter((attachment) => attachment.mime_type.startsWith("image/"))
            .slice(0, 10)
            .map(async (attachment) => {
              try {
                const { data, error } = await client.storage
                  .from(CHAT_ATTACHMENT_BUCKET)
                  .download(attachment.storage_path);
                if (error) throw error;
                const reading = await readBarcodeForAi(
                  new File([data], attachment.file_name, { type: attachment.mime_type }),
                );
                return reading
                  ? { fileName: attachment.file_name, ...reading }
                  : null;
              } catch (error) {
                console.warn(
                  `Barcode analysis could not be completed for "${attachment.file_name}" during regeneration.`,
                  error,
                );
                return null;
              }
            }),
        )
      ).filter((reading): reading is NonNullable<typeof reading> => reading !== null);
      if (showThinking) setThinkingSteps(["Meninjau riwayat dan konteks tersimpan…"]);

      const result = await generateGeminiConversation(
        keys,
        sourceText,
        startIndex,
        profile ?? DEFAULT_PERSONALIZATION,
        {
          thinkingMode: showThinking,
          regenerateForVariation: !editedSource,
          currentMessageAt: sourceMessage.createdAt,
          history: history.map(({ role, text, createdAt }) => ({
            role,
            content: text,
            created_at: createdAt,
          })),
          relevantMessages: relevantContext.messages,
          memories: relevantContext.memories,
          insights,
          feedback: recentFeedback,
          barcodeReadings,
          attachments: attachmentsForModel,
          prepareAttachments: (key, attachments) =>
            prepareGeminiAttachments(key, attachments, async (attachment) => {
              const { data, error } = await client.storage
                .from(CHAT_ATTACHMENT_BUCKET)
                .download(attachment.storagePath);
              if (error) {
                throw new Error(
                  `Could not read "${attachment.fileName}" from private storage: ${error.message}`,
                );
              }
              return data;
            }),
          replacedResponse: {
            content: previousAnswer,
            feedback: previousFeedback.rating,
            reports: previousFeedback.reports,
          },
          onToolActivity: async (toolName) => {
            setThinkingSteps([
              toolName === "search_web"
                ? "Searching the web and inspecting source pages…"
                : `Using chat data tool: ${toolName}`,
            ]);
          },
          executeTool: (name, input, key) => {
            if (name === "search_web") {
              const query =
                typeof input === "object" &&
                input !== null &&
                "query" in input &&
                typeof input.query === "string"
                  ? input.query
                  : "";
              if (!authClient) throw new Error("Sign in before searching the web.");
              return authClient.auth.getSession().then(async ({ data, error }) => {
                if (error) throw error;
                if (!data.session?.access_token) {
                  throw new Error("Your account session has expired. Sign in again.");
                }
                const response = await fetch("/api/web-search", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${data.session.access_token}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ query }),
                });
                const payload: unknown = await response.json().catch(() => null);
                if (!response.ok) {
                  const message =
                    typeof payload === "object" &&
                    payload !== null &&
                    "statusMessage" in payload &&
                    typeof payload.statusMessage === "string"
                      ? payload.statusMessage
                      : `Web search failed (${response.status}).`;
                  throw new Error(message);
                }
                if (!payload || typeof payload !== "object") {
                  throw new Error("The web search service returned an invalid result.");
                }
                return payload;
              });
            }
            return executeChatDataTool(
              client,
              key.api_key,
              name,
              input,
              requestDeleteConfirmation,
              undefined,
              sourceMessage.id,
              async (id) => deleteStoredAttachments([id]),
            );
          },
        },
      );
      regenerationWarnings.push(
        ...result.toolErrors.map((detail) => `A tool reported an error: ${detail}`),
      );
      let thinkingSummary: string | null = null;
      if (showThinking) {
        try {
          const summary = await generateThinkingSummary(
            keys,
            sourceText,
            result.text,
            {
              currentMessageAt: sourceMessage.createdAt,
              history: history.map(({ role, text, createdAt }) => ({
                role,
                content: text,
                created_at: createdAt,
              })),
              relevantMessages: relevantContext.messages,
              memories: relevantContext.memories,
              insights,
              replacedResponse: {
                content: previousAnswer,
                feedback: previousFeedback.rating,
                reports: previousFeedback.reports,
              },
            },
            result.keyIndex,
          );
          thinkingSummary = summary.summary;
          result.attempts.push(...summary.attempts);
        } catch (error) {
          regenerationWarnings.push(
            `The answer is ready, but its Thinking mode explanation could not be created: ${
              error instanceof Error ? error.message : "Unknown Gemini error."
            }`,
          );
        }
      }
      let embedding: number[] | null = null;
      try {
        embedding = await createEmbedding(
          keys[result.keyIndex].api_key,
          result.text,
          "RETRIEVAL_DOCUMENT",
        );
      } catch (error) {
        regenerationWarnings.push(
          `Semantic search could not be updated: ${
            error instanceof Error ? error.message : "Unknown embedding error."
          }`,
        );
      }
      const updatedMessage = await updateChatMessage(
        client,
        messageId,
        result.text,
        embedding,
        thinkingSummary,
        "regenerate",
        !editedSource,
      );
      if (!updatedMessage) throw new Error("This reply could not be found in the database.");

      try {
        await saveChatBranch(client, updatedMessage.id, updatedMessage.version_number);
      } catch (error) {
        regenerationWarnings.push(
          `Reply was regenerated, but its conversation branch could not be preserved: ${
            error instanceof Error ? error.message : "Unknown database error."
          }`,
        );
      }

      const updatedVersions = await loadMessageVersions(client, [messageId]);
      setMessageVersions((current) => ({ ...current, ...updatedVersions }));
      setSelectedMessageVersions((current) => ({
        ...current,
        [messageId]: updatedMessage.version_number,
      }));
      setMessages((current) =>
        current.map((item) =>
          item.id === messageId
            ? {
                ...item,
                text: updatedMessage.content,
                createdAt: updatedMessage.created_at,
                versionNumber: updatedMessage.version_number,
                thinkingSummary: updatedMessage.thinking_summary,
              }
            : item,
        ),
      );
      nextApiIndexRef.current = (result.keyIndex + 1) % keys.length;
      await Promise.all(
        result.attempts.map((attempt) =>
          saveApiStatus(client, attempt).catch((error: unknown) => {
            throw new Error(
              `Reply regenerated, but API status could not be saved: ${
                error instanceof Error ? error.message : "Unknown database error."
              }`,
            );
          }),
        ),
      );
      if (regenerationWarnings.length > 0) {
        setSendError(regenerationWarnings.join("\n"));
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not regenerate this reply.");
    } finally {
      setThinkingSteps([]);
      setIsSending(false);
    }
  }

  async function saveUserMessageEdit() {
    const userEditTarget = userEditTargetRef.current;
    if (!userEditTarget) return;
    const nextText = userEditTextRef.current.trim();
    if (!nextText || nextText.length > 50000) {
      setSendError("Edited messages must contain 1–50,000 characters.");
      return;
    }
    const messageIndex = messages.findIndex((item) => item.id === userEditTarget);
    const originalMessage = messages[messageIndex];
    if (!originalMessage || originalMessage.role !== "user") {
      setSendError("Could not find the user message to edit.");
      return;
    }

    setIsSending(true);
    setSendError("");
    try {
      const [
        { createSupabaseClient, ensureSupabaseSession, loadDatabaseConfig },
        { createEmbedding, loadMessageVersions, saveChatBranch, updateChatMessage },
      ] = await Promise.all([import("./lib/supabase"), import("./lib/chat-data")]);
      const config = loadDatabaseConfig();
      if (!config) throw new Error("The CheyaVerse account service is not configured.");
      const client = createSupabaseClient(config);
      await ensureSupabaseSession(client);
      const { data: keys, error: keysError } = await client
        .from("ai_api_keys")
        .select("id, model, api_key, status, last_error, created_at")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (keysError) throw keysError;
      if (keys.length === 0) throw new Error("Add a Gemini API key in Settings first.");

      let embedding: number[] | null = null;
      try {
        embedding = await createEmbedding(keys[0].api_key, nextText, "RETRIEVAL_DOCUMENT");
      } catch (error) {
        throw new Error(
          `Could not prepare the edited message for semantic search: ${
            error instanceof Error ? error.message : "Unknown embedding error."
          }`,
        );
      }
      const updatedMessage = await updateChatMessage(
        client,
        userEditTarget,
        nextText,
        embedding,
        null,
        "user_edit",
        true,
      );
      if (!updatedMessage) throw new Error("The edited message was not found.");
      const versions = await loadMessageVersions(client, [userEditTarget]);
      setMessageVersions((current) => ({ ...current, ...versions }));
      setSelectedMessageVersions((current) => ({
        ...current,
        [userEditTarget]: updatedMessage.version_number,
      }));
      setMessages((current) =>
        current.map((item) =>
          item.id === userEditTarget
            ? {
                ...item,
                text: updatedMessage.content,
                createdAt: updatedMessage.created_at,
                versionNumber: updatedMessage.version_number,
                thinkingSummary: null,
              }
            : item,
        ),
      );
      closeUserMessageEditor();
      userEditTextRef.current = "";
      setActiveUserActions(null);
      const nextAssistant = messages[messageIndex + 1];
      if (nextAssistant?.role === "assistant") {
        await regenerateAssistantMessage(nextAssistant.id, {
          text: updatedMessage.content,
          versionNumber: updatedMessage.version_number,
        });
      } else {
        try {
          await saveChatBranch(client, updatedMessage.id, updatedMessage.version_number);
        } catch (error) {
          setSendError(
            error instanceof Error
              ? error.message
              : "The edited message was saved, but its conversation branch could not be saved.",
          );
        }
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not edit this message.");
    } finally {
      setIsSending(false);
    }
  }

  if (
    pathname !== "/" &&
    !/^\/settings(?:\/(?:personal|configure|memory|account|privacy|terms))?\/?$/.test(pathname)
  ) {
    return (
      <ErrorPage
        code="404"
        title="Page not found"
        description="The page you’re looking for doesn’t exist or may have moved."
        onHome={() => window.location.assign("/")}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (isAuthLoading) {
    return <PageLoadingSkeleton pathname={pathname} />;
  }

  if (historyLoadError && authUser && pathname === "/") {
    return (
      <ErrorPage
        code="CHAT HISTORY ERROR"
        title="Could not load your chat"
        description="Your conversation history could not be reached. Check your connection and try again."
        details={historyLoadError}
        onHome={() => window.location.assign("/")}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (authError && !authUser) {
    return (
      <ErrorPage
        code="ACCOUNT ERROR"
        title="Could not connect your account"
        description="CheyaAPP could not restore the account session. Check the connection and try again."
        details={authError}
        onHome={() => window.location.assign("/")}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!authUser) {
    if (pathname === "/" && !isLoginOpen) {
      return <PublicHome onSignIn={() => setIsLoginOpen(true)} />;
    }
    return (
      <AccountLogin
        client={authClient}
        error={authError}
      />
    );
  }

  if (remoteAttachmentView) {
    const { attachment, signedUrl } = remoteAttachmentView;
    const isImage = attachment.mime_type.startsWith("image/");
    const isVideo = attachment.mime_type.startsWith("video/");
    const isPdf = attachment.mime_type === "application/pdf";
    if (isImage || isVideo) {
      return (
        <MediaPreview
          src={signedUrl}
          fileName={attachment.file_name}
          fileSize={attachment.size_bytes}
          isVideo={isVideo}
          downloadHref={signedUrl}
          onClose={closeRemoteAttachmentView}
        />
      );
    }
    const textLines = (remoteAttachmentView.textContent ?? "").split(/\r\n|\r|\n/);
    const longestTextLine = textLines.reduce(
      (longest, line) => Math.max(longest, line.length),
      0,
    );
    return (
      <main className="fixed inset-0 z-50 flex flex-col bg-[#17181c] text-white">
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-white/10 px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{attachment.file_name}</p>
            <p className="text-xs text-white/60">{formatFileSize(attachment.size_bytes)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={signedUrl}
              download={attachment.file_name}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
            >
              Download
            </a>
            <button
              type="button"
              aria-label="Close attachment"
              onClick={closeRemoteAttachmentView}
              className="flex size-9 items-center justify-center rounded-full hover:bg-white/10"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
        </header>
        <div
          className={`flex min-h-0 flex-1 items-center justify-center overflow-auto ${
            isTextAttachment(attachment.mime_type, attachment.file_name) ? "p-0" : "p-3 sm:p-6"
          }`}
        >
          {isPdf ? (
            <iframe
              src={signedUrl}
              title={attachment.file_name}
              className="size-full rounded-lg bg-white"
            />
          ) : isTextAttachment(attachment.mime_type, attachment.file_name) ? (
            <section
              aria-label="File preview"
              className="relative size-full min-h-0 overflow-hidden bg-white text-[#24252a]"
            >
              <div className="absolute inset-0 overflow-auto overscroll-contain">
                <div className="flex min-h-full w-max min-w-full items-stretch font-mono text-[13px] leading-6">
                  <div
                    aria-hidden="true"
                    className="sticky left-0 z-10 shrink-0 border-r border-[#eceef0] bg-[#fafafa] px-3 py-4 text-right text-[#a0a3aa] select-none"
                  >
                    {textLines.map((_, index) => (
                      <div key={index} className="h-6 leading-6">
                        {index + 1}
                      </div>
                    ))}
                  </div>
                  <textarea
                    aria-label={`Preview ${attachment.file_name}`}
                    readOnly
                    spellCheck={false}
                    wrap="off"
                    value={remoteAttachmentView.textContent ?? ""}
                    style={{
                      width: `calc(${Math.max(40, longestTextLine)}ch + 1.5rem)`,
                      minWidth: "calc(100vw - 56px)",
                      height: `${Math.max(100, textLines.length * 24 + 32)}px`,
                    }}
                    className="m-0 block min-h-full shrink-0 resize-none overflow-hidden border-0 bg-white px-3 py-4 font-mono text-[13px] leading-6 text-[#25262a] outline-none"
                  />
                </div>
              </div>
            </section>
          ) : (
            <div className="text-center text-sm text-white/70">
              <Files aria-hidden="true" className="mx-auto mb-3 size-10" />
              <p>This file can be downloaded but does not have an in-app preview.</p>
            </div>
          )}
        </div>
      </main>
    );
  }

  if (pathname.startsWith("/settings") && authClient) {
    return (
      <Suspense
        fallback={<PageLoadingSkeleton pathname={pathname} />}
      >
        <SettingsPage
          pathname={pathname}
          onNavigate={navigate}
          onBack={() => navigate("/")}
          client={authClient}
          accountUserId={authUser.id}
          accountEmail={authUser.email}
          onGeminiKeyChange={setHasGeminiApiKey}
        />
      </Suspense>
    );
  }

  if (pathname === "/" && isLoadingHistory && messages.length === 0) {
    return <PageLoadingSkeleton pathname={pathname} />;
  }

  const viewedAttachment = attachmentView ? attachedMedia[attachmentView.index] : undefined;
  const viewedFile = viewedAttachment?.file;
  const editorLines = editorContent.split(/\r\n|\r|\n/);
  const longestEditorLine = editorLines.reduce((longest, line) => Math.max(longest, line.length), 0);

  if (attachmentView && viewedFile && viewedAttachment) {
    const previewUrl = mediaPreviews.get(viewedFile);
    const isMediaView =
      viewedAttachment.mimeType.startsWith("image/") ||
      viewedAttachment.mimeType.startsWith("video/");
    if (isMediaView) {
      return previewUrl ? (
        <MediaPreview
          src={previewUrl}
          fileName={viewedFile.name}
          fileSize={viewedFile.size}
          isVideo={viewedAttachment.mimeType.startsWith("video/")}
          onClose={closeAttachmentView}
        />
      ) : null;
    }
    const editorWidth = `calc(${Math.max(40, longestEditorLine)}ch + 1.5rem)`;
    const editorHeight = `${Math.max(100, editorLines.length * 24 + 32)}px`;

    return (
      <main
        aria-label={`Edit: ${viewedFile.name}`}
        className="fixed inset-0 z-40 flex flex-col bg-white text-[#24252a]"
      >
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[#eceef0] px-3 text-xs">
          <span className="min-w-0 truncate font-medium">{viewedFile.name}</span>
          <span className="shrink-0 text-[#777a81]">{formatFileSize(viewedFile.size)}</span>
        </header>
        <section
          aria-label="File editor"
          className="relative min-h-0 flex-1 overflow-hidden bg-white"
        >
              {isEditorLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-[#777a81]">
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  Opening file…
                </div>
              ) : editorError ? (
                <p role="alert" className="p-5 text-sm text-red-700">
                  {editorError}
                </p>
              ) : (
                <div className="absolute inset-0 overflow-auto overscroll-contain">
                  <div className="flex min-h-full w-max min-w-full items-stretch font-mono text-[13px] leading-6">
                    <div
                      aria-hidden="true"
                      className="sticky left-0 z-10 shrink-0 border-r border-[#eceef0] bg-[#fafafa] px-3 py-4 text-right text-[#a0a3aa] select-none"
                    >
                      {editorLines.map((_, index) => (
                        <div key={index} className="h-6 leading-6">
                          {index + 1}
                        </div>
                      ))}
                    </div>
                    <textarea
                      aria-label={`Edit ${viewedFile.name}`}
                      spellCheck={false}
                      wrap="off"
                      value={editorContent}
                      onChange={(event) => setEditorContent(event.target.value)}
                      style={{
                        width: editorWidth,
                        minWidth: "calc(100vw - 56px)",
                        height: editorHeight,
                      }}
                      className="m-0 block min-h-full shrink-0 resize-none overflow-hidden border-0 bg-white px-3 py-4 font-mono text-[13px] leading-6 text-[#25262a] outline-none focus:outline-none"
                    />
                  </div>
                </div>
              )}
              <button
                type="button"
                disabled={isEditorLoading || Boolean(viewedAttachment?.isUploading)}
                onClick={() => void commitFileEdit()}
                className="absolute bottom-[max(16px,env(safe-area-inset-bottom))] right-4 flex h-10 items-center justify-center rounded-full border border-[#e5e6e9] bg-white px-5 text-sm font-medium text-[#27282d] shadow-md transition hover:bg-[#f7f8fa] disabled:opacity-50"
              >
                Commit
              </button>
        </section>
      </main>
    );
  }

  return (
    <main
      className="fixed inset-0 flex justify-center bg-[#f5f6f8] p-0 sm:p-5"
    >
      <section
        aria-label="CheyaVerse chat"
        className="relative flex h-full w-full flex-col overflow-hidden border-[#e7e8eb] bg-[#f5f6f8] sm:max-w-[580px] sm:rounded-[34px] sm:border"
        onDragEnter={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          dragEnterDepthRef.current += 1;
          setIsDraggingAttachments(true);
        }}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          dragEnterDepthRef.current = Math.max(0, dragEnterDepthRef.current - 1);
          if (dragEnterDepthRef.current === 0) setIsDraggingAttachments(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragEnterDepthRef.current = 0;
          setIsDraggingAttachments(false);
          addPickedFiles(event.dataTransfer.files);
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          if (files.length === 0) {
            files.push(
              ...Array.from(event.clipboardData.items)
                .filter((item) => item.kind === "file")
                .map((item) => item.getAsFile())
                .filter((file): file is File => file !== null),
            );
          }
          if (files.length === 0) return;
          event.preventDefault();
          addPickedFiles(files);
        }}
      >
        {isDraggingAttachments && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-[28px] border-2 border-dashed border-[#229fe3] bg-[#e9f7fd]/95 text-center text-sm font-medium text-[#176d96] shadow-[0_0_0_9999px_rgba(34,159,227,0.08)] sm:inset-3"
          >
            Drop files or media to attach
          </div>
        )}
        <header className="absolute inset-x-0 top-0 z-20 flex h-[64px] select-none items-center justify-between gap-2 bg-transparent px-2 py-1 sm:gap-3 sm:px-5">
          <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-[#e8e9ec] bg-white py-1 pl-1 pr-2 sm:gap-2.5 sm:pr-2">
            <img
              src={cheyaLogo}
              alt="CheyaVerse logo"
              className="pointer-events-none size-10 shrink-0 rounded-full object-cover select-none"
              draggable={false}
            />
            <div className="pointer-events-none flex min-w-0 flex-col justify-center select-none">
              <div className="flex items-center gap-0.5">
                <h1 className="truncate text-base font-semibold leading-5 text-[#17181b]">
                  CheyaVerse
                </h1>
                <BadgeCheck
                  aria-label="Verified account"
                  className="pointer-events-none size-[18px] shrink-0 fill-[#28a9e0] text-white select-none"
                  strokeWidth={2.5}
                />
              </div>
              <p className="pointer-events-none truncate text-[11px] leading-4 text-[#96989d] select-none">
                Always here for you
              </p>
            </div>
            <button
              type="button"
              aria-label="Notifications"
              title="Notifications"
              className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full text-[#303238] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
            >
              <Bell aria-hidden="true" className="size-5" strokeWidth={1.8} />
            </button>
          </div>

          <nav
            aria-label="Chat actions"
            className="flex h-12 shrink-0 items-center gap-0.5 rounded-full border border-[#e8e9ec] bg-white p-1"
          >
            {headerActions.map(({ label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                title={label}
                onClick={() => {
                  if (label === "Settings") navigate("/settings");
                }}
                className="flex size-9 items-center justify-center rounded-full text-[#303238] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
              >
                <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
              </button>
            ))}
          </nav>
        </header>

        {ttsPlayback && (
          <div className="absolute inset-x-3 top-[68px] z-10 space-y-1.5 sm:inset-x-5">
            <section
              aria-label="Text-to-speech player"
              className="flex min-h-12 items-center gap-0 rounded-2xl border border-[#e6e7eb] bg-white px-1.5 py-1.5 shadow-sm"
            >
              {ttsPlayback.status === "loading" ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="ml-1 mr-2 size-4 shrink-0 animate-spin text-[#656871]"
                  />
                  <p role="status" className="min-w-0 flex-1 text-xs text-[#656871]">
                    Preparing speech…
                  </p>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label={ttsPlayback.status === "playing" ? "Pause speech" : "Play speech"}
                    onClick={() =>
                      void playAssistantSpeech(
                        ttsPlayback.messageId,
                        ttsPlayback.versionNumber,
                        ttsPlayback.text,
                      )
                    }
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-[#303238] transition-colors hover:bg-[#f1f2f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
                  >
                    {ttsPlayback.status === "playing" ? (
                      <Pause aria-hidden="true" className="size-4" />
                    ) : (
                      <Play aria-hidden="true" className="size-4" />
                    )}
                  </button>
                  {ttsPlayback.errorDetails && (
                    <button
                      type="button"
                      aria-label="Show speech error details"
                      aria-expanded={isTtsErrorExpanded}
                      onClick={() => setIsTtsErrorExpanded((expanded) => !expanded)}
                      className="flex size-7 shrink-0 items-center justify-center rounded-full text-amber-700 transition-colors hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                    >
                      <TriangleAlert aria-hidden="true" className="size-4" />
                    </button>
                  )}
                  {ttsPlayback.status === "error" ? (
                    <p role="alert" className="ml-1 min-w-0 flex-1 truncate text-xs text-[#bd4a4a]">
                      {ttsPlayback.errorSummary}
                    </p>
                  ) : (
                    <>
                      <div
                        aria-label={`${formatSpeechTime(ttsPlayback.elapsedSeconds)} of ${formatSpeechTime(ttsPlayback.durationSeconds)}`}
                        className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-[#656871]"
                      >
                        <span>{formatSpeechTime(ttsPlayback.elapsedSeconds)}</span>
                        <span className="text-[#a0a2a8]">/</span>
                        <span>{formatSpeechTime(ttsPlayback.durationSeconds)}</span>
                      </div>
                      <div
                        role="img"
                        aria-label="Speech waveform"
                        className="flex h-6 min-w-0 flex-1 items-center justify-between gap-[2px] overflow-hidden px-1.5"
                      >
                        {Array.from({ length: 36 }, (_, index) => {
                          const progress =
                            ttsPlayback.status === "ended"
                              ? 1
                              : ttsPlayback.elapsedSeconds / ttsPlayback.durationSeconds;
                          return (
                            <span
                              key={index}
                              className={`tts-wave-bar ${
                                (index + 0.5) / 36 <= progress ? "tts-wave-bar-played" : ""
                              }`}
                              style={{
                                height: `${speechWaveHeight(ttsPlayback.text, index)}%`,
                              }}
                            />
                          );
                        })}
                      </div>
                      {ttsPlayback.errorSummary && (
                        <span className="sr-only" role="status">
                          {ttsPlayback.errorSummary}
                        </span>
                      )}
                    </>
                  )}
                </>
              )}
              <button
                type="button"
                aria-label="Close speech player"
                onClick={closeTts}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-[#777a82] transition-colors hover:bg-[#f1f2f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </section>
            {isTtsErrorExpanded && ttsPlayback.errorDetails && (
              <div
                role="alert"
                className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-[#e6e7eb] bg-white px-3 py-2.5 text-xs leading-5 text-[#55504a] shadow-sm"
              >
                {ttsPlayback.errorDetails}
              </div>
            )}
          </div>
        )}

        <div
          ref={conversationRef}
          aria-label="Conversation"
          aria-live="polite"
          onScroll={handleConversationScroll}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#f5f6f8] px-3 pb-3 pt-[64px] sm:px-[22px]"
        >
          <div className="space-y-3">
            {messages.map((chatMessage) => {
              const versionNumber = displayedVersionNumber(chatMessage);
              const versions = messageVersions[chatMessage.id] ?? [];
              const versionIndex = versions.findIndex(
                (item) => item.version_number === versionNumber,
              );
              const visibleText = displayedMessageText(chatMessage);
              const visibleThinkingSummary = displayedThinkingSummary(chatMessage);
              const animateAssistant =
                typingAssistant?.id === chatMessage.id &&
                typingAssistant.content === visibleText;
              const ratingKey = `${chatMessage.id}:${versionNumber}`;
              const chatJob = chatJobsByMessageId.get(chatMessage.id);
              const versionLabel =
                chatMessage.role === "user" ? "user message" : "assistant response";
              const versionControls = versions.length > 1 ? (
                <div className="flex items-center gap-0.5 text-[11px] text-[#777a82]">
                  <button
                    type="button"
                    aria-label={`Show previous ${versionLabel} version`}
                    disabled={isSending || versionIndex <= 0}
                    onClick={() => void setMessageVersion(chatMessage, -1)}
                    className="flex size-7 items-center justify-center rounded-md hover:bg-[#f1f2f4] disabled:opacity-30"
                  >
                    <ArrowLeft aria-hidden="true" className="size-3.5" />
                  </button>
                  <span>{Math.max(versionIndex + 1, 1)}/{versions.length}</span>
                  <button
                    type="button"
                    aria-label={`Show newer ${versionLabel} version`}
                    disabled={
                      isSending ||
                      versionIndex < 0 ||
                      versionIndex >= versions.length - 1
                    }
                    onClick={() => void setMessageVersion(chatMessage, 1)}
                    className="flex size-7 items-center justify-center rounded-md hover:bg-[#f1f2f4] disabled:opacity-30"
                  >
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
              ) : null;

              if (chatMessage.role === "user") {
                return (
                  <article key={chatMessage.id} className="group relative flex w-full flex-col items-end">
                    {chatMessage.attachments && chatMessage.attachments.length > 0 && (
                      <div
                        aria-label="Message attachments"
                        dir="rtl"
                        className="mb-1.5 flex w-fit max-w-[min(94%,290px)] flex-wrap justify-start gap-1.5"
                      >
                        {chatMessage.attachments.map((attachment) => (
                          <UserMessageAttachmentTile
                            key={attachment.id}
                            attachment={attachment}
                            expired={isChatAttachmentExpired(attachment)}
                            getPreviewUrl={getAttachmentPreviewUrl}
                            onOpen={(item) => void openStoredAttachment(item)}
                          />
                        ))}
                      </div>
                    )}
                    <div
                      onPointerDown={(event) => {
                        if (event.pointerType !== "touch") return;
                        clearLongPressTimer();
                        longPressStartRef.current = { x: event.clientX, y: event.clientY };
                        longPressTimerRef.current = setTimeout(
                          () => {
                            setActiveUserActions(chatMessage.id);
                            longPressTimerRef.current = null;
                          },
                          300,
                        );
                      }}
                      onPointerMove={(event) => {
                        const start = longPressStartRef.current;
                        if (
                          event.pointerType === "touch" &&
                          start &&
                          Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
                        ) {
                          clearLongPressTimer();
                          longPressStartRef.current = null;
                        }
                      }}
                      onPointerUp={() => {
                        clearLongPressTimer();
                        longPressStartRef.current = null;
                      }}
                      onPointerCancel={() => {
                        clearLongPressTimer();
                        longPressStartRef.current = null;
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setActiveUserActions(chatMessage.id);
                      }}
                      onDragStart={(event) => event.preventDefault()}
                      className="max-w-[94%] select-none rounded-[18px] rounded-br-md bg-[#28292e] px-3.5 py-1.5 text-[13px] leading-[1.35] text-white [webkit-touch-callout:none] sm:max-w-[88%]"
                      style={{ WebkitTouchCallout: "none" }}
                    >
                      <Suspense fallback={null}>
                        <AssistantMarkdown content={visibleText} userMessage />
                      </Suspense>
                      <LinkPreviews
                        content={visibleText}
                        client={authClient}
                        userMessage
                      />
                    </div>
                    {chatJob && (chatJob.status === "failed" || chatJob.error) && (
                      <p
                        role="alert"
                        className="mt-1 max-w-[88%] text-xs text-red-700"
                      >
                        {chatJob.error || "Cheya could not complete this response."}
                      </p>
                    )}
                    {versionControls && (
                      <div className="mt-0.5 flex min-h-7 w-full items-center justify-end">
                        {versionControls}
                      </div>
                    )}
                    <div
                      data-user-actions
                      aria-label="User message actions"
                      className={`absolute right-1 top-[calc(100%+2px)] z-30 items-center gap-0.5 rounded-xl border border-[#e5e6e9] bg-white p-1 shadow-lg ${
                        activeUserActions === chatMessage.id
                          ? "flex"
                          : "hidden sm:group-hover:flex sm:group-focus-within:flex"
                      }`}
                    >
                      <button
                        type="button"
                        aria-label="Copy user message"
                        onClick={() => void copyMessageText(chatMessage.id, visibleText)}
                        className="flex size-7 items-center justify-center rounded-md text-[#777a82] hover:bg-[#f1f2f4]"
                      >
                        {copiedMessageId === chatMessage.id ? (
                          <Check aria-hidden="true" className="size-3.5 text-[#398650]" />
                        ) : (
                          <Copy aria-hidden="true" className="size-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label="Edit user message"
                        onClick={() => {
                          openUserMessageEditor(chatMessage.id, visibleText);
                        }}
                        className="flex size-7 items-center justify-center rounded-md text-[#777a82] hover:bg-[#f1f2f4]"
                      >
                        <Pencil aria-hidden="true" className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete this message and everything after it"
                        disabled={isSending || isDeletingChatBranch}
                        onClick={() => {
                          setDeleteChatTarget({ id: chatMessage.id, text: visibleText });
                          setActiveUserActions(null);
                        }}
                        className="flex size-7 items-center justify-center rounded-md text-[#b43b3b] hover:bg-red-50 disabled:opacity-40"
                      >
                        <Trash2 aria-hidden="true" className="size-3.5" />
                      </button>
                    </div>
                  </article>
                );
              }

              return (
                <article key={chatMessage.id} className="w-full min-w-0 text-[#27282d]">
                  {visibleThinkingSummary && (
                    <div className="mb-2">
                      <button
                        type="button"
                        aria-expanded={expandedThinkingIds.has(ratingKey)}
                        onClick={() =>
                          setExpandedThinkingIds((current) => {
                            const next = new Set(current);
                            if (next.has(ratingKey)) next.delete(ratingKey);
                            else next.add(ratingKey);
                            return next;
                          })
                        }
                        className="inline-flex flex-row-reverse items-center gap-1 rounded-lg pl-0 pr-2 py-1 text-xs text-[#747780] hover:bg-[#f5f6f8]"
                      >
                        {expandedThinkingIds.has(ratingKey) ? (
                          <ChevronDown aria-hidden="true" className="size-3.5" />
                        ) : (
                          <ChevronRight aria-hidden="true" className="size-3.5" />
                        )}
                        Thinking mode
                      </button>
                      {expandedThinkingIds.has(ratingKey) && (
                        <p className="mt-1 border-l border-[#e4e5e8] pl-3 text-xs leading-5 text-[#747780]">
                          {visibleThinkingSummary}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="max-w-full break-words text-[14px] leading-6 sm:text-[15px]">
                    <Suspense fallback={null}>
                      <AssistantMarkdown
                        content={visibleText}
                        animate={animateAssistant}
                        onTypewriterProgress={() => {
                          if (followLatestRef.current) scrollConversationToLatest("auto");
                        }}
                        onTypewriterComplete={() =>
                          setTypingAssistant((current) =>
                            current?.id === chatMessage.id ? null : current,
                          )
                        }
                      />
                    </Suspense>
                    {!animateAssistant && (
                      <LinkPreviews content={visibleText} client={authClient} />
                    )}
                  </div>
                  <div
                    aria-label="Assistant message actions"
                    className="mt-1 flex flex-wrap items-center gap-1"
                  >
                    {versionControls}
                    <button
                      type="button"
                      aria-label="Like response"
                      aria-pressed={ratings[ratingKey] === "like"}
                      onClick={() =>
                        void handleAssistantRating(chatMessage.id, versionNumber, "like")
                      }
                      className={`flex size-8 items-center justify-center rounded-lg transition hover:bg-[#f1f2f4] ${
                        ratings[ratingKey] === "like" ? "text-[#2088bf]" : "text-[#777a82]"
                      }`}
                    >
                      <ThumbsUp aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Dislike response"
                      aria-pressed={ratings[ratingKey] === "dislike"}
                      onClick={() =>
                        void handleAssistantRating(chatMessage.id, versionNumber, "dislike")
                      }
                      className={`flex size-8 items-center justify-center rounded-lg transition hover:bg-[#f1f2f4] ${
                        ratings[ratingKey] === "dislike" ? "text-[#bd4a4a]" : "text-[#777a82]"
                      }`}
                    >
                      <ThumbsDown aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Regenerate response"
                      disabled={isSending}
                      onClick={() => void regenerateAssistantMessage(chatMessage.id)}
                      className="flex size-8 items-center justify-center rounded-lg text-[#777a82] transition hover:bg-[#f1f2f4] disabled:opacity-50"
                    >
                      <RotateCw aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Report response"
                      onClick={() => {
                        setReportTarget({
                          id: chatMessage.id,
                          versionNumber,
                        });
                        reportDetailsRef.current = "";
                        setReportError("");
                        setSendError("");
                      }}
                      className="flex size-8 items-center justify-center rounded-lg text-[#777a82] transition hover:bg-[#f1f2f4]"
                    >
                      <TriangleAlert aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={
                        ttsPlayback?.messageId === chatMessage.id &&
                        ttsPlayback.versionNumber === versionNumber
                          ? "Speech player is open"
                          : "Read response aloud"
                      }
                      aria-pressed={
                        ttsPlayback?.messageId === chatMessage.id &&
                        ttsPlayback.versionNumber === versionNumber
                      }
                      onClick={() => {
                        if (
                          ttsPlayback?.messageId !== chatMessage.id ||
                          ttsPlayback.versionNumber !== versionNumber
                        ) {
                          void playAssistantSpeech(chatMessage.id, versionNumber, visibleText);
                        }
                      }}
                      className={`flex size-8 items-center justify-center rounded-lg transition hover:bg-[#f1f2f4] ${
                        ttsPlayback?.messageId === chatMessage.id
                          ? "text-[#2088bf]"
                          : "text-[#777a82]"
                      }`}
                    >
                      <Volume2 aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={copiedMessageId === chatMessage.id ? "Copied response" : "Copy response"}
                      onClick={() => void copyAssistantMessage(chatMessage)}
                      className="ml-auto flex size-8 items-center justify-center rounded-lg text-[#777a82] transition hover:bg-[#f1f2f4]"
                    >
                      {copiedMessageId === chatMessage.id ? (
                        <Check aria-hidden="true" className="size-4 text-[#398650]" />
                      ) : (
                        <Copy aria-hidden="true" className="size-4" />
                      )}
                    </button>
                  </div>
                </article>
              );
            })}
            {isSending && (
              <div
                role="status"
                aria-live="polite"
                className={`w-full min-w-0 text-xs text-[#747780] ${
                  activeChatJob?.thinking_mode ?? thinkingModeRef.current
                    ? "space-y-1.5 rounded-2xl border border-[#ece9f5] bg-[#faf9fd] px-3.5 py-3"
                    : "flex justify-start px-1 py-1"
                }`}
              >
                {activeChatJob?.thinking_mode ?? thinkingModeRef.current ? (
                  <p className="font-medium text-[#4b4e55]">
                    {activeChatJob?.progress ||
                      thinkingSteps[thinkingSteps.length - 1] ||
                      "Reviewing the request…"}
                  </p>
                ) : (
                  <p>{activeChatJob?.progress || "Cheya is preparing a reply…"}</p>
                )}
              </div>
            )}
            {!hasGeminiApiKey && !isLoadingHistory && (
              <div className="flex h-12 shrink-0 items-center justify-between gap-3 overflow-hidden rounded-2xl border border-[#e6e8eb] bg-white px-3.5 text-sm text-[#686b72]">
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  Add a Gemini API key to start chatting.
                </span>
                <button
                  type="button"
                  onClick={() => navigate("/settings/configure")}
                  className="shrink-0 font-medium text-[#5c45a4] underline underline-offset-2"
                >
                  Configure
                </button>
              </div>
            )}
            {sendError && (
              <p
                role="alert"
                className="whitespace-pre-line rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {sendError}
              </p>
            )}
          </div>
        </div>

        <footer
          className="relative z-20 shrink-0 bg-transparent px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2.5 sm:px-5 sm:pb-5"
        >
          {showScrollToLatest && pathname === "/" && (
            <button
              type="button"
              aria-label="Scroll to latest message"
              title="Scroll to latest message"
              onClick={() => scrollConversationToLatest()}
              className="absolute right-4 z-30 flex size-9 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] shadow-[0_3px_14px_rgba(20,24,32,0.16)] transition hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3] sm:size-10"
              style={{ bottom: "calc(100% + 12px)" }}
            >
              <ArrowDown aria-hidden="true" className="size-4" />
            </button>
          )}
          <form
            aria-label="Send message"
            className="chat-composer rounded-[25px] border border-[#e5e6e9] bg-white p-1 shadow-[0_2px_10px_rgba(20,24,32,0.05)]"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            {attachedMedia.length > 0 && (
              <div
                aria-label="Files ready to upload"
                className="grid max-w-full grid-flow-col auto-cols-[68px] gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain px-2 pb-0 pt-2 sm:auto-cols-[68px] sm:gap-1.5 sm:pb-1 sm:pt-2.5"
              >
                {attachedMedia.map((attachment, index) => {
                  const { file } = attachment;
                  const isPreviewable =
                    attachment.mimeType.startsWith("image/") ||
                    attachment.mimeType.startsWith("video/");
                  const preview = attachment.isBlocked ? undefined : mediaPreviews.get(file);

                  return (
                    <article
                      key={attachment.id}
                      aria-label={`Attached file: ${file.name}`}
                      className="group/attachment relative aspect-square min-w-0 overflow-hidden rounded-xl border border-[#e5e6e9] bg-white text-[#3d4148] shadow-sm"
                      title={attachment.uploadError ?? file.name}
                    >
                      <button
                        type="button"
                        aria-label={`Open ${file.name}`}
                        disabled={attachment.isBlocked}
                        onClick={() => void openAttachment(index)}
                        className="absolute inset-0 flex size-full flex-col items-center justify-center overflow-hidden text-left disabled:cursor-not-allowed"
                      >
                        {attachment.isBlocked ? (
                          <div className="flex size-full flex-col items-center justify-center gap-1 bg-amber-50 px-1.5 text-amber-800">
                            <TriangleAlert aria-hidden="true" className="size-6" />
                            <span className="text-center text-[9px] font-semibold leading-3">
                              Not uploaded
                            </span>
                          </div>
                        ) : isPreviewable && preview ? (
                          attachment.mimeType.startsWith("video/") ? (
                            <video
                              src={preview}
                              muted
                              playsInline
                              preload="metadata"
                              aria-label={`Preview of ${file.name}`}
                              className="size-full object-cover"
                            />
                          ) : (
                            <img
                              src={preview}
                              alt={file.name}
                              className="size-full object-cover"
                            />
                          )
                        ) : (
                          <div className="flex size-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-[#f8f9fb] to-[#edf0f4] px-1.5">
                            {attachment.mimeType.startsWith("video/") ? (
                              <Video aria-hidden="true" className="size-5 text-[#6585a7]" />
                            ) : (
                              <Files aria-hidden="true" className="size-5 text-[#6585a7]" />
                            )}
                            <span className="w-full truncate text-center text-[9px] font-semibold">
                              {file.name}
                            </span>
                          </div>
                        )}
                      </button>
                      {attachment.mimeType.startsWith("video/") &&
                        preview &&
                        !attachment.isBlocked && (
                          <span className="pointer-events-none absolute left-1/2 top-1/2 z-[2] flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white">
                            <Play aria-hidden="true" className="size-4 fill-current" />
                          </span>
                        )}
                      {isPreviewable && preview && (
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-1 pb-1 pt-3 text-center text-[8px] font-medium text-white">
                          {file.name}
                        </span>
                      )}
                      {attachment.isUploading && (
                        <span
                          role="status"
                          aria-label={`Processing ${file.name}`}
                          className="attachment-upload-progress pointer-events-none absolute inset-x-0 bottom-0 z-[5]"
                        />
                      )}
                      {attachment.uploadError && !attachment.isBlocked && (
                        <span
                          role="alert"
                          className="absolute inset-x-0 bottom-0 truncate bg-red-700/90 px-1 py-1 text-center text-[9px] font-medium text-white"
                          title={attachment.uploadError}
                        >
                          Upload failed
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`${attachment.isUploading ? "Cancel upload of" : "Remove"} ${file.name}`}
                        title={`${attachment.isUploading ? "Cancel upload of" : "Remove"} ${file.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeAttachedFile(index);
                        }}
                        className="absolute right-1 top-1 z-10 flex size-5 items-center justify-center rounded-full border border-black/5 bg-white/95 text-[#292b30] shadow-sm transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
                      >
                        <X aria-hidden="true" className="size-3.5" strokeWidth={2} />
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
            <div className="flex min-h-11 items-start px-3 pb-2 pt-1 sm:min-h-[52px]">
              <ChatMessageInput
                inputRef={messageInputRef}
                defaultValue={messageDraftRef.current}
                disabled={!hasGeminiApiKey}
                onDraftInput={handleMessageDraftInput}
                onSubmitMessage={() => void sendMessage()}
                placeholder={
                  hasGeminiApiKey ? "Ask anything..." : "Add a Gemini API key in Settings first"
                }
              />
            </div>

            <div className="-mx-1 flex items-center justify-between gap-2 px-1 pb-1">
              <ChatMediaMenu
                disabled={
                  !hasGeminiApiKey ||
                  isRestoringDraftAttachments ||
                  isPreparingAttachments
                }
                onOpenCamera={openCamera}
                onPickPhoto={() => fileInputRef.current?.click()}
                onPickFiles={() => filesInputRef.current?.click()}
              />
              <div className="flex items-center gap-1">
                <ThinkingModeToggle
                  disabled={!hasGeminiApiKey}
                  onToggle={(enabled) => {
                    thinkingModeRef.current = enabled;
                  }}
                />
                {attachedMedia.length > 0 ? (
                  <button
                    type="button"
                    aria-label="Send message"
                    onClick={sendMessage}
                    disabled={
                      isSending ||
                      isRestoringDraftAttachments ||
                      isPreparingAttachments ||
                      !hasGeminiApiKey ||
                      attachedMedia.some(
                        (attachment) =>
                          attachment.isBlocked || attachment.isUploading || !attachment.uploaded,
                      )
                    }
                    className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3] sm:size-10"
                  >
                    {isSending || isAttachmentUploadPending || isRestoringDraftAttachments ? (
                      <LoaderCircle aria-hidden="true" className="size-[18px] animate-spin" />
                    ) : (
                      <Send aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
                    )}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-label="Use microphone"
                      className="chat-composer-idle-control flex size-9 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3] sm:size-10"
                    >
                      <Mic aria-hidden="true" className="size-[19px]" strokeWidth={1.8} />
                    </button>
                    <button
                      type="button"
                      aria-label="Visualize"
                      className="chat-composer-idle-control flex size-9 shrink-0 items-center justify-center rounded-full border border-[#17181b] bg-[#17181b] text-white transition-colors hover:bg-[#34363b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3] sm:size-10"
                    >
                      <AudioLines aria-hidden="true" className="size-5" strokeWidth={1.8} />
                    </button>
                    <button
                      type="button"
                      aria-label="Send message"
                      onClick={sendMessage}
                      disabled={
                        isSending ||
                        isRestoringDraftAttachments ||
                        isAttachmentUploadPending ||
                        !hasGeminiApiKey
                      }
                      className="chat-composer-send hidden size-9 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3] disabled:opacity-40 sm:size-10"
                    >
                      {isSending || isRestoringDraftAttachments || isAttachmentUploadPending ? (
                        <LoaderCircle aria-hidden="true" className="size-[18px] animate-spin" />
                      ) : (
                        <Send aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
                      )}
                    </button>
                    </>
                )}
              </div>
            </div>
          </form>
        </footer>
      </section>

      {deleteChatTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-5 py-8"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isDeletingChatBranch) {
              setDeleteChatTarget(null);
            }
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-chat-branch-title"
            aria-describedby="delete-chat-branch-description"
            className="w-full max-w-md rounded-3xl border border-[#e2e4e8] bg-white p-5 shadow-xl"
          >
            <h2 id="delete-chat-branch-title" className="text-base font-semibold text-[#22242a]">
              Delete this conversation branch?
            </h2>
            <p
              id="delete-chat-branch-description"
              className="mt-2 text-sm leading-6 text-[#64666d]"
            >
              This permanently removes this user message, its reply, and every later message,
              including their versions, insights, feedback, pending chat jobs, and any AI memories
              learned from those messages. Earlier messages stay in the conversation.
            </p>
            <p className="mt-3 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-[#f5f6f8] p-3 text-sm text-[#34363b]">
              {deleteChatTarget.text.slice(0, 500)}
            </p>
            {isSending && (
              <p className="mt-3 text-xs leading-5 text-amber-800">
                Wait for the current reply to finish before deleting the conversation branch.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isDeletingChatBranch}
                onClick={() => setDeleteChatTarget(null)}
                className="h-10 rounded-full border border-[#e5e6e9] px-4 text-sm font-medium text-[#34363b] hover:bg-[#f7f8fa] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSending || isDeletingChatBranch}
                onClick={() => void deleteChatBranchFromMessage()}
                className="flex h-10 items-center gap-2 rounded-full bg-[#bd3030] px-4 text-sm font-medium text-white hover:bg-[#a92929] disabled:opacity-50"
              >
                {isDeletingChatBranch && (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                )}
                Delete branch
              </button>
            </div>
          </section>
        </div>
      )}

      <dialog
        ref={userEditDialogRef}
        onCancel={(event) => {
          event.preventDefault();
          closeUserMessageEditor();
        }}
        onClose={() => {
          userEditTargetRef.current = null;
        }}
        className="fixed inset-0 m-auto w-[calc(100%-2.5rem)] max-w-lg border-0 bg-transparent p-0 backdrop:bg-black/35"
      >
        <form
          aria-labelledby="edit-user-message-title"
          onSubmit={(event) => {
            event.preventDefault();
            void saveUserMessageEdit();
          }}
          className="w-full rounded-3xl bg-white p-5 shadow-xl"
        >
          <h2 id="edit-user-message-title" className="text-base font-semibold text-[#22242a]">
            Edit message
          </h2>
          <textarea
            ref={userEditTextareaRef}
            aria-label="Edit user message"
            maxLength={50000}
            rows={5}
            onInput={(event) => {
              userEditTextRef.current = event.currentTarget.value;
            }}
            className="mt-3 w-full resize-y rounded-xl border border-[#e5e6e9] p-3 text-sm leading-6 outline-none focus:border-[#229fe3]"
          />
          <p className="mt-2 text-xs text-[#777a82]">
            Pesan setelah ini akan disimpan sebagai riwayat lama dan disembunyikan dari percakapan aktif.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              disabled={isSending}
              onClick={closeUserMessageEditor}
              className="h-10 rounded-full border border-[#e5e6e9] px-4 text-sm font-medium text-[#34363b] hover:bg-[#f7f8fa] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSending}
              className="flex h-10 items-center gap-2 rounded-full bg-[#28292e] px-4 text-sm font-medium text-white hover:bg-[#3b3d43] disabled:opacity-50"
            >
              {isSending && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
              Save edit
            </button>
          </div>
        </form>
      </dialog>

      {reportTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-5 py-8"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSavingReport) {
              setReportTarget(null);
              setReportError("");
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-response-title"
            className="w-full max-w-sm rounded-3xl border border-[#e2e4e8] bg-white p-5 shadow-xl"
          >
            <h2 id="report-response-title" className="text-base font-semibold text-[#22242a]">
              Report this response
            </h2>
            <label htmlFor="response-report-details" className="mt-4 block text-sm text-[#43454b]">
              What went wrong?
            </label>
            <textarea
              id="response-report-details"
              maxLength={2000}
              rows={4}
              defaultValue={reportDetailsRef.current}
              onChange={(event) => {
                reportDetailsRef.current = event.currentTarget.value;
              }}
              className="mt-2 w-full resize-y rounded-xl border border-[#e5e6e9] p-3 text-sm outline-none focus:border-[#229fe3]"
            />
            {reportError && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {reportError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={isSavingReport}
                onClick={() => {
                  setReportTarget(null);
                  setReportError("");
                }}
                className="h-10 rounded-full border border-[#e5e6e9] px-4 text-sm font-medium text-[#34363b] hover:bg-[#f7f8fa] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingReport}
                onClick={() => void submitAssistantReport()}
                className="flex h-10 items-center gap-2 rounded-full bg-[#28292e] px-4 text-sm font-medium text-white hover:bg-[#3b3d43] disabled:opacity-50"
              >
                {isSavingReport && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                Send report
              </button>
            </div>
          </section>
        </div>
      )}

      {deleteConfirmation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-5 py-8"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) resolveDeleteConfirmation(false);
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-confirmation-title"
            aria-describedby="delete-confirmation-description"
            className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl"
          >
            <h2 id="delete-confirmation-title" className="text-base font-semibold text-[#22242a]">
              Confirm deletion
            </h2>
            <p id="delete-confirmation-description" className="mt-2 text-sm leading-6 text-[#64666d]">
              CheyaVerse wants to delete this {deleteConfirmation.label}:
            </p>
            <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-[#f5f6f8] p-3 text-sm text-[#34363b]">
              {deleteConfirmation.preview.slice(0, 500)}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => resolveDeleteConfirmation(false)}
                className="h-10 rounded-full border border-[#e5e6e9] px-4 text-sm font-medium text-[#34363b] hover:bg-[#f7f8fa]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => resolveDeleteConfirmation(true)}
                className="h-10 rounded-full bg-[#bd3030] px-4 text-sm font-medium text-white hover:bg-[#a92929]"
              >
                Delete
              </button>
            </div>
          </section>
        </div>
      )}

      {attachmentToast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-[80] flex justify-center px-4 sm:bottom-6">
          <div
            role="alert"
            aria-live="assertive"
            className="pointer-events-auto flex max-w-lg items-start gap-2.5 rounded-2xl border border-red-200 bg-[#fff8f7] px-3.5 py-3 text-sm text-red-900 shadow-[0_8px_28px_rgba(30,20,20,0.22)]"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-700" />
            <p className="min-w-0 flex-1 whitespace-pre-line leading-5">{attachmentToast}</p>
            <button
              type="button"
              aria-label="Dismiss attachment notification"
              onClick={() => {
                if (attachmentToastTimerRef.current) {
                  clearTimeout(attachmentToastTimerRef.current);
                  attachmentToastTimerRef.current = null;
                }
                setAttachmentToast("");
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-red-800 transition hover:bg-red-100"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
      )}

      {isCameraOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-0 backdrop-blur-sm sm:p-6"
          onClick={closeCamera}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Camera capture"
            className="camera-capture-dialog relative overflow-hidden bg-[#090a0c] sm:rounded-3xl sm:shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <video
                ref={cameraVideoRef}
                autoPlay
                muted
                playsInline
                aria-label="Live camera preview"
                className="size-full object-cover"
              />
            </div>
            <button
              type="button"
              aria-label="Close camera"
              onClick={closeCamera}
              className="camera-desktop-close absolute right-4 top-4 z-10 size-11 items-center justify-center rounded-full border border-white/35 bg-black/50 text-white shadow-lg backdrop-blur-md transition hover:bg-black/70 sm:right-5 sm:top-5"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
            {isCameraSwitchSupported && (
              <button
                type="button"
                aria-label="Switch camera"
                title="Switch camera"
                onClick={() =>
                  setCameraFacing((facing) => (facing === "environment" ? "user" : "environment"))
                }
                className="camera-mobile-control camera-desktop-switch-control absolute bottom-[max(38px,env(safe-area-inset-bottom))] left-5 z-10 flex size-12 items-center justify-center rounded-full border border-white/30 bg-black/45 text-white shadow-lg backdrop-blur-md transition hover:bg-black/65 active:scale-95"
              >
                <SwitchCamera aria-hidden="true" className="size-5" />
              </button>
            )}
            {isCameraTorchSupported && (
              <button
                type="button"
                aria-label={isCameraTorchOn ? "Turn camera light off" : "Turn camera light on"}
                title={isCameraTorchOn ? "Turn light off" : "Turn light on"}
                aria-pressed={isCameraTorchOn}
                onClick={() => void toggleCameraTorch()}
                className="camera-mobile-control absolute bottom-[max(38px,env(safe-area-inset-bottom))] right-5 z-10 flex size-12 items-center justify-center rounded-full border border-white/30 bg-black/45 text-white shadow-lg backdrop-blur-md transition hover:bg-black/65 active:scale-95"
              >
                {isCameraTorchOn ? (
                  <FlashlightOff aria-hidden="true" className="size-5" />
                ) : (
                  <Flashlight aria-hidden="true" className="size-5" />
                )}
              </button>
            )}
            <button
              type="button"
              aria-label="Take photo"
              onClick={() => void captureCameraPhoto()}
              className="absolute bottom-[max(28px,env(safe-area-inset-bottom))] left-1/2 z-10 flex size-[68px] -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-white bg-white/15 shadow-[0_4px_18px_rgba(0,0,0,0.18)] transition active:scale-95"
            >
              <span aria-hidden="true" className="size-[50px] rounded-full bg-white" />
            </button>
          </section>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        aria-label="Choose photos and videos"
        className="sr-only"
        onChange={(event) => {
          addPickedFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={filesInputRef}
        type="file"
        accept="*/*"
        multiple
        aria-label="Choose files"
        className="sr-only"
        onChange={(event) => {
          addPickedFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
    </main>
  );
}
