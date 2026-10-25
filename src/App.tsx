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
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  Crop,
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
  useRef,
  useState,
} from "react";
import cheyaLogo from "../assets/circle.png";
import sendMessageSound from "../assets/sounds/send.mp3";
import receivedMessageSound from "../assets/sounds/received.mp3";
import { AccountLogin } from "./AccountLogin";
import { ErrorPage } from "./ErrorPage";
import { LegalPage } from "./LegalPage";
import { ActionToast } from "./components/ActionToast";
import { BugReportDialog } from "./components/BugReportDialog";
import { ImageCropper } from "./components/ImageCropper";
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
  VOICE_NOTE_TRANSCRIPT_MARKER,
  formatChatAttachmentSize,
  isChatAttachmentExpired,
  loadChatAttachmentDrafts,
  removeChatAttachmentDraft,
  resolveChatAttachmentMimeType,
  saveChatAttachmentDraft,
  getChatAttachmentIdentityHash,
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
  DEFAULT_GEMINI_TTS_VOICE,
  generateGeminiSpeech,
  isGeminiTtsVoice,
} from "./lib/gemini-tts";
import {
  clearAccountSessionId,
  getAccountSessionId,
  getAccountSessionLocation,
} from "./lib/account-sessions";
import { subscribeWithReconnect } from "./lib/realtime";
import {
  createSpeechWordTimeline,
  speechTextFromMarkdown,
  speechWordIndexAtAudioTime,
  speechWordIndexAtCharacter,
  speechWordIndexAtProgress,
  type SpeechWordTimeline,
} from "./lib/speech-text";
import {
  ACCOUNT_AI_ACTION_NAMES,
  executeAccountAiActionFromClient,
  linkChatAttachmentsFromClient,
  reportAiFailureFromClient,
} from "./lib/account-ai-actions";
import { getSharedAttachmentId } from "./lib/chat-attachment-sharing";
import {
  clearGeminiSpeechCache,
  deleteChatWithGeminiSpeech,
  prepareAssistantSpeech,
} from "./lib/tts-playback";
import {
  clearPendingAuthProvider,
  getPendingAuthProvider,
  type AccountProvider,
  type AccountRole,
  type AccountInboxItem,
  type GeneralSettings,
  DEFAULT_GENERAL_SETTINGS,
  type AdminMessageRequest,
  type AppSupabaseClient,
  type ChatMessageJob,
  type ChatMessageVersion,
} from "./lib/supabase";
import type { ChatAttachment } from "./lib/chat-attachments";
import {
  enablePushForCurrentDevice,
  syncCurrentPushSubscription,
} from "./lib/push-client";

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

function consumeOAuthCallbackError(): string | null {
  const url = new URL(window.location.href);
  const callbackParams = new URLSearchParams(url.hash.slice(1));
  const error =
    url.searchParams.get("error_description") ??
    url.searchParams.get("error") ??
    callbackParams.get("error_description") ??
    callbackParams.get("error");
  if (!error) return null;

  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  url.searchParams.delete("error_code");
  url.hash = "";
  window.history.replaceState(window.history.state, "", url);
  return `GitHub sign-in could not be completed: ${error}`;
}

function PageLoadingSkeleton({ pathname }: { pathname: string }) {
  const isSettings = pathname.startsWith("/settings");
  const isSettingsHome = pathname === "/settings" || pathname === "/settings/";
  const settingsTitle = pathname.endsWith("/general")
    ? "General"
    : pathname.endsWith("/personal")
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
  const settingsActionPlaceholders =
    settingsTitle === "Settings"
      ? ["", "", ""]
      : settingsTitle === "Configure"
        ? ["", "lg:hidden", "lg:hidden", "hidden lg:block"]
        : ["", "lg:hidden", "lg:hidden"];

  if (isSettings) {
    return (
      <main className="fixed inset-0 flex justify-center bg-[#f5f6f8]">
        <section
          aria-label={`Loading ${settingsTitle.toLowerCase()} page`}
          className={`relative h-full w-full overflow-hidden bg-[#f5f6f8] ${
            isSettingsHome ? "max-w-[720px]" : ""
          }`}
        >
          <header
            className={`absolute inset-x-0 top-0 z-10 flex h-[68px] items-center gap-2 ${
              isSettingsHome
                ? "px-3 pr-[22px] sm:px-5 sm:pr-[29px]"
                : "px-3 pr-[22px] sm:px-6 sm:pr-[34px] lg:px-6 lg:pr-[34px]"
            }`}
          >
            <div className="chat-loading-skeleton size-11 rounded-full" />
            <div className="chat-loading-skeleton h-11 flex-1 rounded-full" />
            <div className="flex h-11 shrink-0 items-center gap-0.5 rounded-full border border-[#e8e9ec] bg-white p-0.5">
              {settingsActionPlaceholders.map((responsiveClass, item) => (
                <div
                  key={item}
                  className={`chat-loading-skeleton size-9 rounded-full ${responsiveClass}`}
                />
              ))}
            </div>
          </header>
          <div
            className={`absolute inset-0 overflow-hidden pb-8 pt-[68px] ${
              isSettingsHome ? "px-3 sm:px-5" : "px-3 sm:px-6 lg:px-6"
            }`}
          >
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
    <main className="fixed inset-0 flex justify-center bg-white p-0">
      <section
        aria-label="Loading chat"
        className="relative flex h-full w-full max-w-[480px] flex-col overflow-hidden bg-white"
      >
        <header className="flex h-[64px] shrink-0 items-center justify-between gap-2 px-2 py-1">
          <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-[#e8e9ec] bg-white py-1 pl-1 pr-2">
            <div className="size-10 rounded-full bg-[#eef0f3]" />
            <div className="space-y-2">
              <div className="h-3.5 w-28 rounded-full bg-[#eef0f3]" />
              <div className="h-2.5 w-20 rounded-full bg-[#eef0f3]" />
            </div>
            <div className="ml-auto size-8 rounded-full bg-[#f1f2f4]" />
          </div>
          <div className="flex h-12 shrink-0 items-center gap-0.5 rounded-full border border-[#e8e9ec] bg-white p-1">
            <div className="flex h-full justify-end gap-0.5">
              <div className="size-9 rounded-full bg-[#f1f2f4]" />
              <div className="size-9 rounded-full bg-[#f1f2f4]" />
            </div>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-5 px-4 pb-3 pt-2">
          <div className="chat-loading-skeleton ml-auto h-10 w-36 rounded-[18px] rounded-br-md" />
          <div className="space-y-3">
            <div className="chat-loading-skeleton h-3 w-28 rounded-full" />
            <div className="chat-loading-skeleton h-3 w-[92%] rounded-full" />
            <div className="chat-loading-skeleton h-3 w-[84%] rounded-full" />
            <div className="chat-loading-skeleton h-3 w-[68%] rounded-full" />
          </div>
          <div className="chat-loading-skeleton ml-auto h-10 w-48 rounded-[18px] rounded-br-md" />
        </div>
        <footer className="shrink-0 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2.5">
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

function getAudioWaveform(audio: AudioBuffer, barCount = 36): number[] {
  const bars = Array.from({ length: barCount }, () => 0);
  const samplesPerBar = Math.max(1, Math.floor(audio.length / barCount));
  let peak = 0;

  for (let bar = 0; bar < barCount; bar += 1) {
    const start = bar * samplesPerBar;
    const end = bar === barCount - 1 ? audio.length : Math.min(audio.length, start + samplesPerBar);
    let energy = 0;
    for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
      const samples = audio.getChannelData(channel);
      for (let index = start; index < end; index += 1) {
        const amplitude = samples[index] ?? 0;
        energy += amplitude * amplitude;
        peak = Math.max(peak, Math.abs(amplitude));
      }
    }
    const sampleCount = Math.max(1, (end - start) * audio.numberOfChannels);
    bars[bar] = Math.sqrt(energy / sampleCount);
  }

  return bars.map((amplitude) => {
    const normalized = peak > 0 ? Math.sqrt(amplitude) / Math.sqrt(peak) : 0;
    return Math.round(4 + normalized * 26);
  });
}

function voiceNoteWaveformCacheKey(attachmentId: string): string {
  return `chat-voice-note-waveform:${attachmentId}`;
}

function getCachedVoiceNoteWaveform(attachmentId: string): number[] | null {
  try {
    const cached = window.localStorage.getItem(voiceNoteWaveformCacheKey(attachmentId));
    if (!cached) return null;
    const waveform: unknown = JSON.parse(cached);
    if (
      !Array.isArray(waveform) ||
      waveform.length !== 36 ||
      !waveform.every(
        (height) => typeof height === "number" && Number.isInteger(height) && height >= 4 && height <= 30,
      )
    ) {
      window.localStorage.removeItem(voiceNoteWaveformCacheKey(attachmentId));
      return null;
    }
    return waveform;
  } catch (error) {
    console.warn("Could not load the cached voice note waveform.", error);
    return null;
  }
}

function saveCachedVoiceNoteWaveform(attachmentId: string, waveform: number[]): void {
  try {
    const key = voiceNoteWaveformCacheKey(attachmentId);
    window.localStorage.setItem(key, JSON.stringify(waveform));
    const cachedKeys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const currentKey = window.localStorage.key(index);
      if (currentKey?.startsWith("chat-voice-note-waveform:")) cachedKeys.push(currentKey);
    }
    while (cachedKeys.length > 100) {
      const oldestKey = cachedKeys.shift();
      if (oldestKey && oldestKey !== key) window.localStorage.removeItem(oldestKey);
    }
  } catch (error) {
    console.warn("Could not cache the voice note waveform in this browser.", error);
  }
}

function createVoiceNoteWaveformPlaceholder(attachmentId: string): number[] {
  let seed = 0;
  for (const character of attachmentId) seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  return Array.from({ length: 36 }, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return 8 + Math.round((seed / 0xffffffff) * 18);
  });
}

function encodeVoiceNoteWav(samples: Float32Array, sampleRate: number): Blob {
  const sourceSampleCount = samples.length;
  if (
    sourceSampleCount === 0 ||
    !Number.isInteger(sampleRate) ||
    sampleRate <= 0
  ) {
    throw new Error("The recording is empty. Please try recording again.");
  }

  const dataSize = sourceSampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let outputOffset = 44;
  for (const sample of samples) {
    const clippedSample = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      outputOffset,
      clippedSample < 0 ? clippedSample * 0x8000 : clippedSample * 0x7fff,
      true,
    );
    outputOffset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function MediaPreview({
  src,
  fileName,
  fileSize,
  isVideo,
  isLoading = false,
  downloadHref,
  onCrop,
  onClose,
}: {
  src: string;
  fileName: string;
  fileSize: number;
  isVideo: boolean;
  isLoading?: boolean;
  downloadHref?: string;
  onCrop?: () => void;
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
          {!isVideo && onCrop && (
            <button
              type="button"
              onClick={onCrop}
              className="flex h-9 items-center gap-2 rounded-full border border-white/20 px-3 text-xs font-medium hover:bg-white/10"
            >
              <Crop aria-hidden="true" className="size-4" />
              Crop
            </button>
          )}
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
        {isLoading ? (
          <div role="status" className="flex items-center gap-2 text-sm text-white/70">
            <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
            Preparing preview…
          </div>
        ) : isVideo ? (
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

const ChatMessageAudioNote = memo(function ChatMessageAudioNote({
  attachment,
  expired,
  isProcessing = false,
  getPreviewUrl,
  size = "default",
}: {
  attachment: ChatAttachment;
  expired: boolean;
  isProcessing?: boolean;
  getPreviewUrl: (attachment: ChatAttachment, refresh?: boolean) => Promise<string>;
  size?: "default" | "large";
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [waveform, setWaveform] = useState<number[]>(() => createVoiceNoteWaveformPlaceholder(attachment.id));
  const lastRefreshedSourceRef = useRef("");
  const pendingPlaybackRef = useRef(false);
  const audioNoteRef = useRef<HTMLDivElement>(null);
  const lastPositionSaveAtRef = useRef(0);

  useEffect(() => {
    if (expired) return;
    const cachedWaveform = getCachedVoiceNoteWaveform(attachment.id);
    if (cachedWaveform) setWaveform(cachedWaveform);
  }, [attachment.id, expired]);

  function voiceNotePositionKey() {
    return `chat-voice-note-position:${attachment.id}`;
  }

  function savePlaybackPosition(audio: HTMLAudioElement) {
    try {
      if (audio.currentTime > 0 && Number.isFinite(audio.currentTime)) {
        window.localStorage.setItem(voiceNotePositionKey(), String(audio.currentTime));
      } else {
        window.localStorage.removeItem(voiceNotePositionKey());
      }
    } catch (error) {
      console.warn("Could not cache voice note playback position in this browser.", error);
    }
  }

  function clearPlaybackPosition() {
    try {
      window.localStorage.removeItem(voiceNotePositionKey());
    } catch (error) {
      console.warn("Could not clear the cached voice note playback position.", error);
    }
  }

  function claimAudioPlayback(audio: HTMLAudioElement) {
    const activeAudio = document.querySelector<HTMLAudioElement>(
      "audio[data-chat-voice-note-audio='active']",
    );
    if (activeAudio && activeAudio !== audio) {
      activeAudio.setAttribute("data-chat-voice-note-restart", "true");
      activeAudio.pause();
      activeAudio.removeAttribute("data-chat-voice-note-audio");
    }
    audio.setAttribute("data-chat-voice-note-audio", "active");
  }

  function advanceToNextVoiceNote() {
    const currentMessage = audioNoteRef.current?.closest<HTMLElement>("[data-chat-message]");
    let nextMessage = currentMessage?.nextElementSibling;
    while (nextMessage?.hasAttribute("data-chat-message")) {
      if (nextMessage.hasAttribute("data-has-visible-text")) return;
      if (nextMessage.hasAttribute("data-voice-note-message")) {
        nextMessage
          .querySelector<HTMLElement>("[data-chat-voice-note-player]")
          ?.dispatchEvent(new Event("chat-voice-note-autoplay"));
        return;
      }
      nextMessage = nextMessage.nextElementSibling;
    }
  }

  useEffect(() => {
    if (expired) return;
    let cancelled = false;
    setIsLoading(true);
    void getPreviewUrl(attachment)
      .then((url) => {
        if (!cancelled) {
          setAudioUrl(url);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) console.warn("Could not load voice note playback URL.", error);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
      audioRef.current?.pause();
    };
  }, [attachment.id, expired, getPreviewUrl]);

  useEffect(() => {
    const player = audioNoteRef.current;
    if (!player) return;
    const handleAutoplay = () => {
      if (expired || isProcessing) return;
      const audio = audioRef.current;
      pendingPlaybackRef.current = true;
      if (audio) {
        claimAudioPlayback(audio);
        if (!audio.paused) return;
        void audio.play().catch((error: unknown) => {
          pendingPlaybackRef.current = false;
          audio.removeAttribute("data-chat-voice-note-audio");
          console.warn("Could not autoplay the next voice note.", error);
        });
        return;
      }
      if (isLoading) return;
      setIsLoading(true);
      void getPreviewUrl(attachment)
        .then((url) => setAudioUrl(url))
        .catch((error: unknown) => {
          pendingPlaybackRef.current = false;
          console.warn("Could not load the next voice note.", error);
        })
        .finally(() => setIsLoading(false));
    };
    player.addEventListener("chat-voice-note-autoplay", handleAutoplay);
    return () => player.removeEventListener("chat-voice-note-autoplay", handleAutoplay);
  }, [attachment, expired, getPreviewUrl, isLoading, isProcessing]);

  useEffect(() => {
    if (!audioUrl) return;
    let cancelled = false;
    let context: AudioContext | null = null;
    void (async () => {
      try {
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error(`Could not load audio waveform (${response.status}).`);
        const audioData = await response.arrayBuffer();
        context = new AudioContext();
        const decodedAudio = await context.decodeAudioData(audioData);
        if (!cancelled) {
          const nextWaveform = getAudioWaveform(decodedAudio);
          setWaveform(nextWaveform);
          saveCachedVoiceNoteWaveform(attachment.id, nextWaveform);
        }
      } catch (error) {
        if (!cancelled) console.warn("Could not render the voice note waveform.", error);
      } finally {
        if (context && context.state !== "closed") {
          await context.close().catch((error: unknown) => {
            console.warn("Could not close the waveform audio context.", error);
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment.id, audioUrl]);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        if (!audioUrl) {
          setIsLoading(true);
          pendingPlaybackRef.current = true;
          claimAudioPlayback(audio);
          const refreshedUrl = await getPreviewUrl(attachment, true);
          setAudioUrl(refreshedUrl);
          return;
        }
        if (audio.hasAttribute("data-chat-voice-note-restart")) {
          audio.currentTime = 0;
          audio.removeAttribute("data-chat-voice-note-restart");
          clearPlaybackPosition();
        }
        claimAudioPlayback(audio);
        await audio.play();
      } catch (error) {
        audio.removeAttribute("data-chat-voice-note-audio");
        console.warn("Could not play the voice note.", error);
        void refreshAudioUrl(true);
      }
    } else {
      audio.pause();
    }
  }

  async function refreshAudioUrl(resumePlayback = false) {
    if (expired || lastRefreshedSourceRef.current === audioUrl) return;
    lastRefreshedSourceRef.current = audioUrl;
    setIsLoading(true);
    pendingPlaybackRef.current = resumePlayback;
    try {
      const refreshedUrl = await getPreviewUrl(attachment, true);
      setAudioUrl(refreshedUrl);
    } catch (error) {
      console.warn("Could not refresh the voice note playback URL.", error);
    } finally {
      setIsLoading(false);
    }
  }

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      ref={audioNoteRef}
      data-chat-voice-note-player
      dir="ltr"
      className={`user-message-bubble col-span-full flex w-full select-none ${
        size === "large" ? "max-w-[360px]" : "max-w-[320px]"
      } items-center gap-2 rounded-2xl bg-[#28292e] px-2.5 py-1.5 text-white shadow-sm ${
        expired ? "opacity-65" : ""
      }`}
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
      aria-label={`Voice message, ${formatChatAttachmentSize(attachment.size_bytes)}`}
    >
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          className="hidden"
          onLoadedMetadata={(event) => {
            event.currentTarget.volume = 1;
            setDuration(event.currentTarget.duration || 0);
            try {
              const cachedPosition = Number(
                window.localStorage.getItem(voiceNotePositionKey()),
              );
              if (
                Number.isFinite(cachedPosition) &&
                cachedPosition > 0 &&
                cachedPosition < event.currentTarget.duration
              ) {
                event.currentTarget.currentTime = cachedPosition;
              }
            } catch (error) {
              console.warn("Could not restore the cached voice note position.", error);
            }
          }}
          onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
          onTimeUpdate={(event) => {
            const audio = event.currentTarget;
            setCurrentTime(audio.currentTime);
            if (audio.currentTime - lastPositionSaveAtRef.current >= 1) {
              savePlaybackPosition(audio);
              lastPositionSaveAtRef.current = audio.currentTime;
            }
          }}
          onPlay={(event) => {
            claimAudioPlayback(event.currentTarget);
            setIsPlaying(true);
          }}
          onPause={(event) => {
            savePlaybackPosition(event.currentTarget);
            if (event.currentTarget.hasAttribute("data-chat-voice-note-audio")) {
              event.currentTarget.removeAttribute("data-chat-voice-note-audio");
            }
            setIsPlaying(false);
          }}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(0);
            audioRef.current?.removeAttribute("data-chat-voice-note-audio");
            audioRef.current?.removeAttribute("data-chat-voice-note-restart");
            clearPlaybackPosition();
            advanceToNextVoiceNote();
          }}
          onCanPlay={() => {
            setIsLoading(false);
            if (!pendingPlaybackRef.current) return;
            pendingPlaybackRef.current = false;
            if (audioRef.current) claimAudioPlayback(audioRef.current);
            void audioRef.current?.play().catch((error: unknown) => {
              audioRef.current?.removeAttribute("data-chat-voice-note-audio");
              console.warn("Could not start voice note playback.", error);
            });
          }}
          onError={() => void refreshAudioUrl(isPlaying)}
        />
      )}
      <button
        type="button"
        data-chat-voice-note-play
        aria-label={
          isProcessing
            ? "Sending voice message"
            : isLoading
            ? "Loading voice message"
            : isPlaying
              ? "Pause voice message"
              : "Play voice message"
        }
        disabled={expired || isLoading || isProcessing}
        onClick={() => void togglePlayback()}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#a77bd0] text-white transition hover:bg-[#b78ce0] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading || isProcessing ? (
          <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
        ) : isPlaying ? (
          <Pause aria-hidden="true" className="size-5 fill-current" />
        ) : (
          <Play aria-hidden="true" className="size-5 fill-current" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div
          role="img"
          aria-label="Audio waveform"
          className="flex h-7 items-center gap-[3px] overflow-hidden"
        >
          {waveform.map((height, index) => (
            <span
              key={index}
              className={`w-[3px] shrink-0 rounded-full ${
                index / waveform.length <= progress ? "bg-[#c39ae8]" : "bg-white/45"
              }`}
              style={{ height: `${Math.round(height * 0.75)}px` }}
            />
          ))}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-white/75">
          <span className="tabular-nums">{formatMediaTime(isPlaying ? currentTime : duration)}</span>
          <span>{formatChatAttachmentSize(attachment.size_bytes)}</span>
        </div>
      </div>
    </div>
  );
});

const ChatMessageAttachmentTile = memo(function ChatMessageAttachmentTile({
  attachment,
  expired,
  isProcessing = false,
  onOpen,
  getPreviewUrl,
  size = "default",
}: {
  attachment: ChatAttachment;
  expired: boolean;
  isProcessing?: boolean;
  onOpen: (attachment: ChatAttachment) => void;
  getPreviewUrl: (attachment: ChatAttachment) => Promise<string>;
  size?: "default" | "large";
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const isImage = attachment.mime_type.startsWith("image/");
  const isVideo = attachment.mime_type.startsWith("video/");
  const isAudio = attachment.mime_type.startsWith("audio/");
  const isMedia = isImage || isVideo;

  if (isAudio) {
    return (
      <ChatMessageAudioNote
        attachment={attachment}
        expired={expired}
        isProcessing={isProcessing}
        getPreviewUrl={getPreviewUrl}
        size={size}
      />
    );
  }

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
  }, [attachment.id, attachment.mime_type, expired, getPreviewUrl, isMedia]);

  return (
    <button
      type="button"
      disabled={expired}
      onClick={() => onOpen(attachment)}
      dir="ltr"
      className={`group/attachment relative flex ${
        size === "large" ? "size-[200px]" : "size-[96px]"
      } shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-[#e5e6e9] bg-white text-[#3d4148] shadow-sm transition hover:border-[#cdd3da] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-65`}
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
  enterKeyBehavior,
  fontSize,
  onDraftInput,
  onSubmitMessage,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  defaultValue: string;
  disabled: boolean;
  placeholder: string;
  enterKeyBehavior: GeneralSettings["enter_key_behavior_desktop"];
  fontSize: number;
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
      enterKeyHint={
        enterKeyBehavior === "submit" ||
        (enterKeyBehavior === "system" && !window.matchMedia("(pointer: coarse)").matches)
          ? "send"
          : "enter"
      }
      autoCapitalize="sentences"
      autoCorrect="on"
      spellCheck
      onInput={(event) => onDraftInput(event.currentTarget.value, event.currentTarget)}
      onKeyDown={(event) => {
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.nativeEvent.isComposing ||
          !(
            enterKeyBehavior === "submit" ||
            (enterKeyBehavior === "system" && !window.matchMedia("(pointer: coarse)").matches)
          )
        ) {
          return;
        }
        event.preventDefault();
        onSubmitMessage();
      }}
      style={{ fontSize }}
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
  adminMessageId?: string | null;
  isReminder?: boolean;
  attachments?: ChatAttachment[];
}

interface ChatSubmissionPayload {
  clientRequestId: string;
  content: string;
  thinkingMode: boolean;
  attachmentIds: string[];
  barcodeReadings: AiBarcodeReading[];
}

const VOICE_NOTE_MESSAGE_TEXT =
  "Please listen to the attached voice note and respond to its content.";

function isVoiceNoteMessage(message: ChatMessage): boolean {
  return Boolean(message.attachments?.some((attachment) => attachment.mime_type.startsWith("audio/")));
}

interface FailedChatSubmission {
  error: string;
  retryable: boolean;
  retrying: boolean;
}

class ChatSubmissionError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ChatSubmissionError";
    this.retryable = retryable;
  }
}

let chatNotificationAudioContext: AudioContext | null = null;
const chatNotificationAudioBuffers = new Map<string, Promise<AudioBuffer>>();

function getChatNotificationAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  chatNotificationAudioContext ??= new window.AudioContext();
  return chatNotificationAudioContext;
}

function loadChatNotificationSound(source: string): Promise<AudioBuffer> {
  const existing = chatNotificationAudioBuffers.get(source);
  if (existing) return existing;
  const context = getChatNotificationAudioContext();
  if (!context) return Promise.reject(new Error("Web Audio is not supported by this browser."));
  const buffer = fetch(source)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load notification sound (${response.status}).`);
      return response.arrayBuffer();
    })
    .then((data) => context.decodeAudioData(data))
    .then((buffer) => {
      let peak = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        for (const sample of buffer.getChannelData(channel)) {
          peak = Math.max(peak, Math.abs(sample));
        }
      }
      if (peak > 0) {
        const normalizationGain = 0.95 / peak;
        for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
          const samples = buffer.getChannelData(channel);
          for (let index = 0; index < samples.length; index += 1) {
            samples[index] = Math.max(-0.95, Math.min(0.95, samples[index] * normalizationGain));
          }
        }
      }
      return buffer;
    });
  chatNotificationAudioBuffers.set(source, buffer);
  void buffer.catch(() => chatNotificationAudioBuffers.delete(source));
  return buffer;
}

function unlockChatNotificationSounds() {
  const context = getChatNotificationAudioContext();
  if (!context) return;
  if (context.state !== "running") {
    void context.resume().catch((error: unknown) => {
      console.warn("Could not enable chat notification sounds:", error);
    });
  }
  for (const source of [sendMessageSound, receivedMessageSound]) {
    void loadChatNotificationSound(source).catch((error: unknown) => {
      console.warn("Could not preload chat notification sound:", error);
    });
  }
}

function playChatSound(source: string) {
  const context = getChatNotificationAudioContext();
  if (!context) return;
  void (async () => {
    if (context.state !== "running") await context.resume();
    const buffer = await loadChatNotificationSound(source);
    if (context.state !== "running") return;
    const sound = context.createBufferSource();
    const volume = context.createGain();
    sound.buffer = buffer;
    volume.gain.value = 1;
    sound.connect(volume);
    volume.connect(context.destination);
    sound.start();
  })().catch((error: unknown) => {
    console.warn("Could not play chat notification sound:", error);
  });
}

interface PendingChatAttachment {
  id: string;
  file: File;
  mimeType: string;
  isAutoSentVoiceNote?: boolean;
  draftSavedAt?: number;
  isUploading: boolean;
  isBlocked: boolean;
  isPreprocessed?: boolean;
  identitySha256?: string;
  processingStage?: "upload";
  uploadError: string | null;
  uploaded: ChatAttachment | null;
}

interface AttachmentView {
  index: number;
  mode: "media" | "editor" | "crop";
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

function formatAccountDate(
  value: string,
  timeFormat: GeneralSettings["time_format"] = DEFAULT_GENERAL_SETTINGS.time_format,
): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        ...(timeFormat === "12h" ? { hourCycle: "h12" as const } : {}),
        ...(timeFormat === "24h" ? { hourCycle: "h23" as const } : {}),
      }).format(date);
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
  adminMessageId?: string;
}

interface TtsPlayback {
  messageId: string;
  versionNumber: number;
  text: string;
  engine: "loading" | "audio" | "browser";
  status: "loading" | "ready" | "playing" | "paused" | "ended" | "error";
  durationSeconds: number;
  elapsedSeconds: number;
  activeWordIndex?: number | null;
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

async function decodeSpeechAudio(audio: Blob): Promise<AudioBuffer> {
  if (!window.AudioContext) throw new Error("Audio validation is not supported by this browser.");
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(await audio.arrayBuffer());
    let peak = 0;
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const samples = decoded.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        peak = Math.max(peak, Math.abs(samples[index]));
      }
    }
    if (peak < 0.0001) throw new Error("The generated audio contains no audible signal.");
    return decoded;
  } finally {
    await audioContext.close();
  }
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
  return (
    likelyFemale ??
    indonesianVoices[0] ??
    voices.find((voice) => /google/i.test(voice.name)) ??
    voices[0] ??
    null
  );
}

function isTextAttachment(mimeType: string, fileName: string): boolean {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return (
    mimeType.startsWith("text/") ||
    /\/(json|javascript|xml|x-sql|x-yaml)$/.test(mimeType) ||
    textFileExtensions.has(extension)
  );
}

function isPreparedAdminMessageResult(
  value: unknown,
): value is {
  pendingApproval: true;
  request: Pick<
    AdminMessageRequest,
    "id" | "recipient_user_ids" | "all_accounts" | "title" | "body"
  >;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("pendingApproval" in value) ||
    value.pendingApproval !== true ||
    !("request" in value) ||
    typeof value.request !== "object" ||
    value.request === null
  ) {
    return false;
  }
  const request = value.request;
  return (
    "id" in request &&
    typeof request.id === "string" &&
    "recipient_user_ids" in request &&
    Array.isArray(request.recipient_user_ids) &&
    request.recipient_user_ids.every((id) => typeof id === "string") &&
    "all_accounts" in request &&
    typeof request.all_accounts === "boolean" &&
    "title" in request &&
    typeof request.title === "string" &&
    "body" in request &&
    typeof request.body === "string"
  );
}

export function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const pathnameRef = useRef(window.location.pathname);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [authClient, setAuthClient] = useState<AppSupabaseClient | null>(null);
  const [authUser, setAuthUser] = useState<{
    id: string;
    email: string | null;
    provider: AccountProvider;
    githubUsername: string | null;
    role: AccountRole;
  } | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [isPushPanelDismissed, setIsPushPanelDismissed] = useState(false);
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings>(DEFAULT_GENERAL_SETTINGS);
  const [inboxItems, setInboxItems] = useState<AccountInboxItem[]>([]);
  const [expandedInboxIds, setExpandedInboxIds] = useState<Set<string>>(() => new Set());
  const [pendingAdminRequests, setPendingAdminRequests] = useState<AdminMessageRequest[]>([]);
  const [adminApprovalToast, setAdminApprovalToast] = useState<Pick<
    AdminMessageRequest,
    "id" | "title" | "body"
  > | null>(null);
  const [isLoadingInbox, setIsLoadingInbox] = useState(false);
  const [inboxError, setInboxError] = useState("");
  const [inboxRefresh, setInboxRefresh] = useState(0);
  const [isMarkingInboxRead, setIsMarkingInboxRead] = useState(false);
  const [isClearingInbox, setIsClearingInbox] = useState(false);
  const [activeApprovalRequestId, setActiveApprovalRequestId] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<
    "checking" | "needs-permission" | "denied" | "enabled" | "unsupported" | "error"
  >("checking");
  const [pushBannerError, setPushBannerError] = useState("");
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatJobs, setChatJobs] = useState<ChatMessageJob[]>([]);
  const [failedChatSubmissions, setFailedChatSubmissions] = useState<
    Record<string, FailedChatSubmission>
  >({});
  const [messageVersions, setMessageVersions] = useState<Record<string, ChatMessageVersion[]>>({});
  const [selectedMessageVersions, setSelectedMessageVersions] = useState<Record<string, number>>({});
  const [isRestoringMessageVersion, setIsRestoringMessageVersion] = useState(false);
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
  const [adminRelayRatings, setAdminRelayRatings] = useState<Record<string, AssistantRating>>({});
  const [regeneratingAdminRelayId, setRegeneratingAdminRelayId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [ttsPlayback, setTtsPlayback] = useState<TtsPlayback | null>(null);
  const [isTtsErrorExpanded, setIsTtsErrorExpanded] = useState(false);
  const [isTtsWarningCopied, setIsTtsWarningCopied] = useState(false);
  const [isBugReportOpen, setIsBugReportOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const reportDetailsRef = useRef("");
  const reportCharacterCountRef = useRef<HTMLParagraphElement>(null);
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
  const [toast, setToast] = useState<{
    id: number;
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const toastIdRef = useRef(0);
  const [isDraggingAttachments, setIsDraggingAttachments] = useState(false);
  const [attachedMedia, setAttachedMedia] = useState<PendingChatAttachment[]>([]);
  const [mediaPreviews, setMediaPreviews] = useState<Map<File, string>>(() => new Map());
  const mediaPreviewUrlsRef = useRef(new Map<File, string>());
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
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceRecordingSeconds, setVoiceRecordingSeconds] = useState(0);
  const [voiceRecordingWaveform, setVoiceRecordingWaveform] = useState<number[]>(
    () => Array.from({ length: 36 }, () => 4),
  );
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
    isLoading: boolean;
  } | null>(null);
  const remoteAttachmentViewRequestRef = useRef(0);
  const [attachmentView, setAttachmentView] = useState<AttachmentView | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const editorOriginalContentRef = useRef<string | null>(null);
  const [editorError, setEditorError] = useState("");
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const chatFooterObserverRef = useRef<ResizeObserver | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsWordTimelineRef = useRef<SpeechWordTimeline | null>(null);
  const ttsUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const ttsAudioUrlRef = useRef("");
  const ttsRequestControllerRef = useRef<AbortController | null>(null);
  const ttsStartTimeoutRef = useRef<number | null>(null);
  const ttsTokenRef = useRef(0);
  const pendingConversationScrollRestoreRef = useRef<number | null>(null);
  const pendingHistoryScrollRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const oldestHistoryCursorRef = useRef<{ id: string; created_at: string } | null>(null);
  const hasOlderHistoryRef = useRef(false);
  const loadingOlderHistoryRef = useRef(false);
  const historyGenerationRef = useRef(0);
  const versionRestoreGenerationRef = useRef(0);
  const isRestoringMessageVersionRef = useRef(false);
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const jobRefreshTimerRef = useRef<number | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceRecordingStreamRef = useRef<MediaStream | null>(null);
  const voiceRecordingAudioContextRef = useRef<AudioContext | null>(null);
  const voiceRecordingAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceRecordingChunksRef = useRef<Blob[]>([]);
  const voiceRecordingStartAtRef = useRef(0);
  const voiceRecordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceRecordingWaveformTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceRecordingCancelledRef = useRef(false);
  const autoSendVoiceMessageIdRef = useRef<string | null>(null);
  const localVoicePreviewUrlsRef = useRef(new Map<string, string>());
  const voiceNoteRenderKeysRef = useRef(new Map<string, string>());
  const preparingAttachmentsRef = useRef(false);
  const cameraHistoryEntryRef = useRef(false);
  const messageDraftRef = useRef("");
  const messageDraftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageDraftUserIdRef = useRef<string | null>(null);
  const dragEnterDepthRef = useRef(0);
  const pendingAssistantAnchorRef = useRef<string | null>(null);
  const directReplyProcessingRef = useRef(false);
  const hiddenChatMessageIdsRef = useRef(new Set<string>());
  const attachmentPreviewUrlCacheRef = useRef(
    new Map<string, { url: string; expiresAt: number }>(),
  );
  const attachmentPreviewRequestRef = useRef(new Map<string, Promise<string>>());
  const shouldScrollToLatestRef = useRef(true);
  const followLatestRef = useRef(true);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const observeChatFooter = useCallback((footer: HTMLElement | null) => {
    chatFooterObserverRef.current?.disconnect();
    chatFooterObserverRef.current = null;
    if (!footer) {
      if (conversationRef.current) conversationRef.current.style.paddingBottom = "";
      return;
    }

    const updateFooterHeight = () => {
      const conversation = conversationRef.current;
      if (!conversation) return;
      conversation.style.paddingBottom = `${Math.ceil(footer.getBoundingClientRect().height)}px`;
      if (followLatestRef.current) {
        requestAnimationFrame(() => {
          const current = conversationRef.current;
          if (current) current.scrollTop = current.scrollHeight;
        });
      }
    };

    updateFooterHeight();
    const observer = new ResizeObserver(updateFooterHeight);
    observer.observe(footer);
    chatFooterObserverRef.current = observer;
  }, []);
  const pendingOptimisticMessageIdsRef = useRef(new Set<string>());
  useEffect(() => {
    const visibleMessageIds = new Set(messages.map((message) => message.id));
    for (const messageId of pendingOptimisticMessageIdsRef.current) {
      if (!visibleMessageIds.has(messageId)) {
        pendingOptimisticMessageIdsRef.current.delete(messageId);
      }
    }
  }, [messages]);
  const pendingChatSubmissionsRef = useRef(new Map<string, ChatSubmissionPayload>());
  const chatSubmissionRetryAttemptsRef = useRef(new Map<string, number>());
  const chatSubmissionNextRetryAtRef = useRef(new Map<string, number>());
  const retryingChatSubmissionsRef = useRef(new Set<string>());
  const retryingAttachmentUploadsRef = useRef(new Set<string>());
  const attachmentUploadRetryAttemptsRef = useRef(new Map<string, number>());
  const attachmentUploadNextRetryAtRef = useRef(new Map<string, number>());
  const receivedMessageSoundsRef = useRef(new Set<string>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const knownAdminRequestIdsRef = useRef<Set<string> | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const nextApiIndexRef = useRef(0);
  const thinkingModeRef = useRef(false);
  const attachmentViewRequestRef = useRef(0);
  const cancelledAttachmentsRef = useRef(new Set<string>());
  const deleteConfirmationResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const wasSettingsRef = useRef(window.location.pathname === "/settings");
  const pendingAssistantAnchorIndex = messages.findIndex(
    (message) => message.id === pendingAssistantAnchorRef.current,
  );
  const hasAssistantReplyAfterAnchor =
    pendingAssistantAnchorIndex >= 0 &&
    messages
      .slice(pendingAssistantAnchorIndex + 1)
      .some((message) => message.role === "assistant");
  const activeChatJob =
    chatJobs.find(
      (job) =>
        job.message_id === pendingAssistantAnchorRef.current &&
        !hasAssistantReplyAfterAnchor &&
        (job.status === "queued" || job.status === "processing"),
    ) ??
    chatJobs.find(
      (job) =>
        job.status === "completed" &&
        job.message_id === pendingAssistantAnchorRef.current &&
        job.assistant_message_id !== null &&
        !messages.some((message) => message.id === job.assistant_message_id),
    );
  const isAwaitingAssistantResponse =
    pendingAssistantAnchorIndex >= 0 &&
    !hasAssistantReplyAfterAnchor;
  const isAssistantBusy =
    isSending || Boolean(typingAssistant) || isAwaitingAssistantResponse;
  const unreadInboxMessageCount = inboxItems.filter((item) => !item.read_at).length;
  const unreadInboxCount =
    unreadInboxMessageCount +
    (authUser?.role === "admin" ? pendingAdminRequests.length : 0);
  const showPushBanner =
    pathname === "/" &&
    !isPushPanelDismissed &&
    (pushStatus === "needs-permission" || pushStatus === "denied" || pushStatus === "error");
  const chatFontScale =
    generalSettings.font_size / DEFAULT_GENERAL_SETTINGS.font_size;

  useEffect(() => {
    if (!authClient || !authenticatedUserId) return;
    let isActive = true;
    let sessionId: string;
    try {
      sessionId = getAccountSessionId(authenticatedUserId);
    } catch (error) {
      console.error("Could not initialize this account session tracker.", error);
      return;
    }
    let hasRegisteredSession = false;

    const reportSession = async (
      isVisible = document.visibilityState === "visible",
    ) => {
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
              is_active: isVisible,
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
          .update({
            origin,
            path,
            user_agent: navigator.userAgent,
            last_seen_at: lastSeenAt,
            is_active: isVisible,
          })
          .eq("id", sessionId)
          .eq("user_id", authenticatedUserId)
          .select("id");
        if (error) throw new Error(error.message);
        if (data.length === 0) {
          isActive = false;
          clearAccountSessionId(authenticatedUserId);
          const { error: signOutError } = await authClient.auth.signOut({ scope: "local" });
          if (signOutError) throw new Error(signOutError.message);
        }
      } catch (error) {
        console.error("Could not update the active account session.", error);
      }
    };

    void reportSession();
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") void reportSession();
    }, 15_000);
    const handleVisibilityChange = () => void reportSession();
    const handlePageHide = () => void reportSession(false);
    const handleWindowFocus = () => {
      if (document.visibilityState === "visible") void reportSession(true);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      isActive = false;
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [authClient, authenticatedUserId, pathname]);

  useEffect(() => {
    setIsPushPanelDismissed(false);
  }, [pathname]);

  useEffect(() => {
    if (!authClient || !authenticatedUserId) {
      setGeneralSettings(DEFAULT_GENERAL_SETTINGS);
      return;
    }
    let isActive = true;
    setGeneralSettings(DEFAULT_GENERAL_SETTINGS);
    void (async () => {
      try {
        const { data, error } = await authClient
          .from("user_settings")
          .select("enter_key_behavior_desktop, enter_key_behavior_mobile, time_format, font_size, web_search_enabled")
          .eq("user_id", authenticatedUserId)
          .maybeSingle();
        if (error) throw error;
        if (!isActive || !data) return;
        setGeneralSettings({
          enter_key_behavior_desktop:
            data.enter_key_behavior_desktop === "newline" || data.enter_key_behavior_desktop === "submit"
              ? data.enter_key_behavior_desktop
              : "system",
          enter_key_behavior_mobile:
            data.enter_key_behavior_mobile === "newline" || data.enter_key_behavior_mobile === "submit"
              ? data.enter_key_behavior_mobile
              : "system",
          time_format:
            data.time_format === "12h" || data.time_format === "24h"
              ? data.time_format
              : "system",
          font_size:
            typeof data.font_size === "number" && Number.isFinite(data.font_size)
              ? Math.min(20, Math.max(12, data.font_size))
              : 14,
          web_search_enabled: data.web_search_enabled !== false,
        });
      } catch (error) {
        if (isActive) {
          setSendError(
            `Could not load General settings. Apply the latest supabase/schema.sql. ${
              error instanceof Error ? error.message : "Unknown database error."
            }`,
          );
        }
      }
    })();
    return () => {
      isActive = false;
    };
  }, [authClient, authenticatedUserId]);

  useEffect(() => {
    if (!authClient || !authenticatedUserId) {
      setPushStatus("checking");
      return;
    }
    let isActive = true;
    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setPushStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPushStatus("denied");
      return;
    }
    if (Notification.permission !== "granted") {
      setPushStatus("needs-permission");
      return;
    }
    void syncCurrentPushSubscription(authClient)
      .then((enabled) => {
        if (isActive) setPushStatus(enabled ? "enabled" : "needs-permission");
      })
      .catch((error: unknown) => {
        console.error("Could not synchronize this device's push subscription.", error);
        if (isActive) {
          setPushBannerError(error instanceof Error ? error.message : "Could not check push notification status.");
          setPushStatus("error");
        }
      });
    return () => {
      isActive = false;
    };
  }, [authClient, authenticatedUserId]);

  useEffect(() => {
    knownAdminRequestIdsRef.current = null;
    setAdminApprovalToast(null);
  }, [authenticatedUserId]);

  useEffect(() => {
    if ((!notificationsOpen && pathname !== "/") || !authClient || !authenticatedUserId) return;
    let isActive = true;
    setIsLoadingInbox(true);
    setInboxError("");
    void (async () => {
      const { data: items, error: inboxLoadError } = await authClient
        .from("account_inbox")
        .select("id, recipient_user_id, sender_user_id, source_job_id, kind, title, body, created_at, read_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (inboxLoadError) throw new Error(`Could not load your notification inbox: ${inboxLoadError.message}`);

      let requests: AdminMessageRequest[] = [];
      if (authUser?.role === "admin") {
        const { data, error } = await authClient
          .from("admin_message_requests")
          .select("id, admin_user_id, recipient_user_ids, all_accounts, title, body, status, created_at, sent_at")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw new Error(`Could not load pending message approvals: ${error.message}`);
        requests = data;
      }
      if (!isActive) return;
      if (authUser?.role === "admin") {
        const knownRequestIds = knownAdminRequestIdsRef.current;
        if (knownRequestIds) {
          const newRequest = requests.find((request) => !knownRequestIds.has(request.id));
          if (newRequest) {
            setAdminApprovalToast({
              id: newRequest.id,
              title: newRequest.title,
              body: newRequest.body,
            });
          }
        }
        knownAdminRequestIdsRef.current = new Set(requests.map((request) => request.id));
      } else {
        knownAdminRequestIdsRef.current = null;
      }
      setInboxItems(items);
      setPendingAdminRequests(requests);
    })()
      .catch((error: unknown) => {
        if (isActive) setInboxError(error instanceof Error ? error.message : "Could not load notifications.");
      })
      .finally(() => {
        if (isActive) setIsLoadingInbox(false);
      });

    return subscribeWithReconnect(
      authClient,
      `chat-inbox-${authenticatedUserId}`,
      (initialChannel) => {
        let channel = initialChannel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "account_inbox",
            filter: `recipient_user_id=eq.${authenticatedUserId}`,
          },
          () => setInboxRefresh((value) => value + 1),
        );
        if (authUser?.role === "admin") {
          channel = channel.on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "admin_message_requests",
              filter: `admin_user_id=eq.${authenticatedUserId}`,
            },
            () => setInboxRefresh((value) => value + 1),
          );
        }
        return channel;
      },
      (status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setInboxError(`Live inbox updates are unavailable: ${error?.message ?? status}.`);
        }
      },
    );
  }, [authClient, authUser?.role, authenticatedUserId, inboxRefresh, notificationsOpen, pathname]);

  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);

  useEffect(() => {
    const openInboxFromPush = (event: MessageEvent<unknown>) => {
      if (
        typeof event.data === "object" &&
        event.data !== null &&
        "type" in event.data &&
        event.data.type === "OPEN_NOTIFICATION_INBOX"
      ) {
        setNotificationsOpen(true);
      }
    };
    navigator.serviceWorker?.addEventListener("message", openInboxFromPush);
    if (new URLSearchParams(window.location.search).get("inbox") === "1") {
      setNotificationsOpen(true);
    }
    return () => navigator.serviceWorker?.removeEventListener("message", openInboxFromPush);
  }, []);

  function closeTts() {
    ttsTokenRef.current += 1;
    if (ttsStartTimeoutRef.current !== null) {
      window.clearTimeout(ttsStartTimeoutRef.current);
      ttsStartTimeoutRef.current = null;
    }
    ttsRequestControllerRef.current?.abort();
    ttsRequestControllerRef.current = null;
    ttsAudioRef.current?.pause();
    ttsAudioRef.current = null;
    ttsWordTimelineRef.current = null;
    ttsUtteranceRef.current = null;
    window.speechSynthesis?.cancel();
    if (ttsAudioUrlRef.current) URL.revokeObjectURL(ttsAudioUrlRef.current);
    ttsAudioUrlRef.current = "";
    setIsTtsErrorExpanded(false);
    setIsTtsWarningCopied(false);
    setTtsPlayback(null);
  }

  async function copyTtsWarning(details: string) {
    try {
      await navigator.clipboard.writeText(details);
      setIsTtsWarningCopied(true);
      showActionToast("Speech warning copied.");
      window.setTimeout(() => setIsTtsWarningCopied(false), 1800);
    } catch (error) {
      showAttachmentToast(
        error instanceof Error
          ? `Could not copy the speech warning: ${error.message}`
          : "Could not copy the speech warning.",
      );
    }
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

    const synthesis = window.speechSynthesis;
    synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice?.lang || "id-ID";
    utterance.rate = 1;
    utterance.pitch = 1.05;
    ttsUtteranceRef.current = utterance;
    let hasStarted = false;
    const clearStartTimeout = () => {
      if (ttsStartTimeoutRef.current !== null) {
        window.clearTimeout(ttsStartTimeoutRef.current);
        ttsStartTimeoutRef.current = null;
      }
    };
    utterance.onstart = () => {
      if (ttsTokenRef.current !== token) return;
      hasStarted = true;
      clearStartTimeout();
      setTtsPlayback((current) =>
        current?.messageId === messageId && current.status === "loading"
          ? { ...current, status: "playing" }
          : current,
      );
    };
    utterance.onboundary = (event) => {
      if (ttsTokenRef.current !== token || !text.length) return;
      hasStarted = true;
      clearStartTimeout();
      const progress = Math.min(1, Math.max(0, event.charIndex / text.length));
      setTtsPlayback((current) =>
        current?.messageId === messageId
          ? {
              ...current,
              status: "playing",
              elapsedSeconds: durationSeconds * progress,
              activeWordIndex: speechWordIndexAtCharacter(text, event.charIndex),
            }
          : current,
      );
    };
    utterance.onend = () => {
      if (ttsTokenRef.current !== token) return;
      clearStartTimeout();
      ttsUtteranceRef.current = null;
      setTtsPlayback((current) =>
        current?.messageId === messageId
          ? {
              ...current,
              status: "ended",
              elapsedSeconds: durationSeconds,
              activeWordIndex: null,
            }
          : current,
      );
    };
    utterance.onerror = (event) => {
      clearStartTimeout();
      if (
        ttsTokenRef.current !== token ||
        event.error === "canceled" ||
        event.error === "interrupted"
      ) {
        return;
      }
      const details = [
        ...previousErrors,
        `Browser speech synthesis (${voice?.name ?? "default system voice"}) failed: ${event.error}.`,
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
    setTtsPlayback({
      messageId,
      versionNumber,
      text,
      engine: "browser",
      status: "loading",
      durationSeconds,
      elapsedSeconds: 0,
      browserVoiceName: voice?.name,
      errorSummary: previousErrors.length
        ? "Remote TTS failed; using the browser voice."
        : undefined,
      errorDetails: previousErrors.length ? previousErrors.join("\n\n") : undefined,
    });
    synthesis.speak(utterance);
    ttsStartTimeoutRef.current = window.setTimeout(() => {
      ttsStartTimeoutRef.current = null;
      if (ttsTokenRef.current !== token || hasStarted) return;
      synthesis.cancel();
      ttsUtteranceRef.current = null;
      const details = [
        ...previousErrors,
        `Browser speech synthesis (${voice?.name ?? "default system voice"}) did not start.`,
      ].join("\n\n");
      setTtsPlayback((current) =>
        current?.messageId === messageId && current.status === "loading"
          ? {
              ...current,
              status: "error",
              errorSummary: summarizeSpeechError(details),
              errorDetails: details,
            }
          : current,
      );
    }, 8000);
    return voice?.name;
  }

  async function fallbackToBrowserSpeech(
    messageId: string,
    versionNumber: number,
    text: string,
    durationSeconds: number,
    previousErrors: string[],
    preferredVoiceName?: string,
  ) {
    const token = ttsTokenRef.current;
    setTtsPlayback((current) =>
      current?.messageId === messageId
        ? {
            ...current,
            engine: "browser",
            status: "loading",
            elapsedSeconds: 0,
            activeWordIndex: null,
            errorSummary: undefined,
            errorDetails: undefined,
          }
        : current,
    );
    try {
      await startBrowserSpeech(
        messageId,
        versionNumber,
        text,
        token,
        durationSeconds,
        previousErrors,
        preferredVoiceName,
      );
    } catch (error) {
      if (ttsTokenRef.current !== token) return;
      const details = [
        ...previousErrors,
        error instanceof Error ? error.message : "Browser speech synthesis failed.",
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
    }
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
        if (ttsPlayback.status === "playing") {
          if (synthesis.speaking && !synthesis.paused) {
            synthesis.pause();
            setTtsPlayback((current) =>
              current?.messageId === messageId
                ? { ...current, status: "paused", activeWordIndex: null }
                : current,
            );
            return;
          }
          if (ttsUtteranceRef.current && synthesis.paused) {
            synthesis.resume();
            return;
          }
        }
        if (
          ttsPlayback.status === "paused" &&
          ttsUtteranceRef.current &&
          (synthesis.paused || synthesis.speaking)
        ) {
          synthesis.resume();
          setTtsPlayback((current) =>
            current?.messageId === messageId
              ? { ...current, status: "playing", activeWordIndex: null }
              : current,
          );
          return;
        }
        const previousErrors = ttsPlayback.errorDetails
          ? ttsPlayback.errorDetails.split("\n\n")
          : [];
        await fallbackToBrowserSpeech(
          messageId,
          versionNumber,
          text,
          ttsPlayback.durationSeconds,
          previousErrors,
          ttsPlayback.browserVoiceName,
        );
        return;
      }
      const audio = ttsAudioRef.current;
      if (audio?.error) {
        const previousErrors = [
          ...(ttsPlayback.errorDetails ? ttsPlayback.errorDetails.split("\n\n") : []),
          "The generated audio could not be played by this browser.",
        ];
        await fallbackToBrowserSpeech(
          messageId,
          versionNumber,
          text,
          ttsPlayback.durationSeconds,
          previousErrors,
          ttsPlayback.browserVoiceName,
        );
        return;
      }
      if (audio && !audio.paused) {
        audio.pause();
        setTtsPlayback((current) =>
          current?.messageId === messageId
            ? {
                ...current,
                elapsedSeconds: audio.currentTime,
                status: "paused",
                activeWordIndex: null,
              }
            : current,
        );
        return;
      }
      if (audio) {
        if (audio.ended) audio.currentTime = 0;
        const playbackToken = ttsTokenRef.current;
        const playPromise = audio.play();
        void playPromise.catch((error: unknown) => {
          if (ttsTokenRef.current !== playbackToken) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          const details = error instanceof Error ? error.message : "Browser playback was blocked.";
          void fallbackToBrowserSpeech(
            messageId,
            versionNumber,
            text,
            ttsPlayback.durationSeconds,
            [
              ...(ttsPlayback.errorDetails ? ttsPlayback.errorDetails.split("\n\n") : []),
              details,
            ],
            ttsPlayback.browserVoiceName,
          );
        });
        return;
      }
      const previousErrors = ttsPlayback.errorDetails
        ? ttsPlayback.errorDetails.split("\n\n")
        : [];
      await fallbackToBrowserSpeech(
        messageId,
        versionNumber,
        text,
        ttsPlayback.durationSeconds,
        previousErrors,
        ttsPlayback.browserVoiceName,
      );
      return;
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
      let prepared = await prepareAssistantSpeech(
        authClient,
        messageId,
        versionNumber,
        text,
        requestController.signal,
      );
      errors = prepared.errors;
      if (ttsTokenRef.current !== token) return;

      let decodedAudio: AudioBuffer | null = null;
      if (prepared.audio && prepared.audio.size <= 12 * 1024 * 1024 && window.AudioContext) {
        try {
          decodedAudio = await decodeSpeechAudio(prepared.audio);
        } catch (error) {
          const reason = error instanceof Error
            ? error.message
            : "The generated audio could not be decoded.";
          errors.push(`${prepared.source === "gemini" ? "Gemini TTS" : "Sound of Text"} audio could not be played: ${reason}`);
          decodedAudio = null;
          if (prepared.source === "gemini") {
            prepared = await prepareAssistantSpeech(
              authClient,
              messageId,
              versionNumber,
              text,
              requestController.signal,
              true,
            );
            errors.push(...prepared.errors);
            if (ttsTokenRef.current !== token) return;
            if (prepared.audio) {
              try {
                decodedAudio = await decodeSpeechAudio(prepared.audio);
              } catch (fallbackError) {
                errors.push(
                  `Sound of Text audio could not be played: ${
                    fallbackError instanceof Error
                      ? fallbackError.message
                      : "The generated audio could not be decoded."
                  }`,
                );
                prepared = { ...prepared, audio: null, source: null };
                decodedAudio = null;
              }
            }
          } else {
            prepared = { ...prepared, audio: null, source: null };
          }
        }
      }

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
          () => {
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
              resolve(audio.duration);
            } else {
              reject(new Error("The generated audio has no valid playback duration."));
            }
          },
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

      let wordTimeline: SpeechWordTimeline | null = null;
      if (decodedAudio && actualDuration <= 300) {
        wordTimeline = createSpeechWordTimeline(decodedAudio, text);
        if (!wordTimeline) {
          console.warn(
            `Local speech timing analysis found too few reliable sound peaks for message ${messageId}; using estimated word timing instead.`,
          );
        }
      } else {
        console.warn(
          `Local speech timing analysis was skipped for message ${messageId} because the browser, audio size, or duration is unsupported.`,
        );
      }
      if (ttsTokenRef.current !== token) return;
      ttsWordTimelineRef.current = wordTimeline;

      audio.addEventListener("timeupdate", () => {
        if (ttsTokenRef.current !== token) return;
        const progress = actualDuration > 0 ? audio.currentTime / actualDuration : 0;
        setTtsPlayback((current) =>
          current?.messageId === messageId
            ? {
                ...current,
                elapsedSeconds: audio.currentTime,
                activeWordIndex: audio.paused
                  ? null
                  : wordTimeline
                    ? speechWordIndexAtAudioTime(wordTimeline, audio.currentTime)
                    : speechWordIndexAtProgress(text, progress),
              }
            : current,
        );
      });
      audio.addEventListener("playing", () => {
        if (ttsTokenRef.current !== token) return;
        setTtsPlayback((current) =>
            current?.messageId === messageId
              ? {
                  ...current,
                  status: "playing",
                  elapsedSeconds: audio.currentTime,
                  activeWordIndex: wordTimeline
                    ? speechWordIndexAtAudioTime(wordTimeline, audio.currentTime)
                    : speechWordIndexAtProgress(
                        text,
                        actualDuration > 0 ? audio.currentTime / actualDuration : 0,
                      ),
                }
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
                activeWordIndex: null,
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
      audio.addEventListener("pause", () => {
        if (ttsTokenRef.current !== token || audio.ended) return;
        setTtsPlayback((current) =>
            current?.messageId === messageId && current.status === "playing"
              ? {
                  ...current,
                  status: "paused",
                  elapsedSeconds: audio.currentTime,
                  activeWordIndex: null,
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
      await fallbackToBrowserSpeech(
        messageId,
        versionNumber,
        text,
        durationSeconds,
        [allErrors],
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
        if (ttsTokenRef.current !== token || audio.paused) return;
        setTtsPlayback((current) =>
          current?.messageId === messageId && current.status === "ready"
            ? {
                ...current,
                status: "playing",
                elapsedSeconds: audio.currentTime,
              }
            : current,
        );
      },
      (error: unknown) => {
        if (ttsTokenRef.current !== token) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        const details = error instanceof Error
          ? error.message
          : "Browser playback was blocked.";
        const current = ttsPlayback;
        void fallbackToBrowserSpeech(
          messageId,
          current.versionNumber,
          current.text,
          current.durationSeconds,
          [
            ...(current.errorDetails ? current.errorDetails.split("\n\n") : []),
            details,
          ],
          current.browserVoiceName,
        );
      },
    );
  }, [ttsPlayback]);

  useEffect(() => {
    if (
      !ttsPlayback ||
      ttsPlayback.engine !== "audio" ||
      ttsPlayback.status !== "playing"
    ) {
      return;
    }
    const audio = ttsAudioRef.current;
    if (!audio) return;

    let frameId = 0;
    const updateActiveWord = () => {
      if (!audio.paused && !audio.ended && audio.duration > 0) {
        const activeWordIndex = ttsWordTimelineRef.current
          ? speechWordIndexAtAudioTime(ttsWordTimelineRef.current, audio.currentTime)
          : speechWordIndexAtProgress(
              ttsPlayback.text,
              audio.currentTime / audio.duration,
            );
        setTtsPlayback((current) =>
          current?.messageId === ttsPlayback.messageId &&
          current.activeWordIndex !== activeWordIndex
            ? { ...current, activeWordIndex }
            : current,
        );
        frameId = window.requestAnimationFrame(updateActiveWord);
      }
    };
    frameId = window.requestAnimationFrame(updateActiveWord);
    return () => window.cancelAnimationFrame(frameId);
  }, [ttsPlayback?.engine, ttsPlayback?.messageId, ttsPlayback?.status, ttsPlayback?.text]);

  useEffect(() => {
    if (pathname.startsWith("/settings")) closeTts();
  }, [pathname]);

  useEffect(
    () => () => {
      ttsTokenRef.current += 1;
      if (ttsStartTimeoutRef.current !== null) {
        window.clearTimeout(ttsStartTimeoutRef.current);
        ttsStartTimeoutRef.current = null;
      }
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
      const adminRelayMessageIds = [
        ...new Set(page.messages.flatMap((message) => message.admin_message_id ?? [])),
      ];
      let loadedAdminRelayRatings: Record<string, AssistantRating> = {};
      if (adminRelayMessageIds.length > 0) {
        const { data, error } = await client
          .from("admin_message_feedback")
          .select("admin_message_id, kind")
          .in("admin_message_id", adminRelayMessageIds);
        if (error) {
          throw new Error(`Could not load saved relay feedback: ${error.message}`);
        }
        loadedAdminRelayRatings = Object.fromEntries(
          data.flatMap((item) =>
            item.kind === "like" || item.kind === "dislike"
              ? [[item.admin_message_id, item.kind]]
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
      setAdminRelayRatings((current) => ({ ...current, ...loadedAdminRelayRatings }));
      setMessages((current) => {
        const currentIds = new Set(current.map((message) => message.id));
        const olderMessages = page.messages
          .filter((message) => !currentIds.has(message.id))
          .map(({ id, role, content, created_at, version_number, thinking_summary, is_reminder, admin_message_id }) => ({
            id,
            role,
            text: content,
            createdAt: created_at,
            versionNumber: version_number,
            thinkingSummary: thinking_summary,
            adminMessageId: admin_message_id,
            isReminder: is_reminder,
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
    setToast({ id: ++toastIdRef.current, message, tone: "error" });
  }

  function showActionToast(message: string) {
    setToast({ id: ++toastIdRef.current, message, tone: "success" });
  }

  function handleConversationScroll() {
    const conversation = conversationRef.current;
    if (!conversation) return;
    if (shouldScrollToLatestRef.current) {
      conversation.scrollTop = conversation.scrollHeight;
      followLatestRef.current = true;
      setShowScrollToLatest(false);
      return;
    }
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
  const previewableAttachments = attachedMedia.filter(
    ({ mimeType }) => mimeType.startsWith("image/") || mimeType.startsWith("video/"),
  );
  function getMediaPreviewUrl(file: File): string {
    const existingUrl = mediaPreviewUrlsRef.current.get(file);
    if (existingUrl) return existingUrl;
    const url = URL.createObjectURL(file);
    mediaPreviewUrlsRef.current.set(file, url);
    return url;
  }

  const mediaPreviewSignature = previewableAttachments
    .map(({ id, file, mimeType }) =>
      [id, file.name, file.size, file.lastModified, mimeType].join(":"),
    )
    .join("|");
  useEffect(() => {
    const activeFiles = new Set(previewableAttachments.map(({ file }) => file));
    for (const [file, url] of mediaPreviewUrlsRef.current) {
      if (activeFiles.has(file)) continue;
      URL.revokeObjectURL(url);
      mediaPreviewUrlsRef.current.delete(file);
    }
    const nextPreviews = new Map<File, string>();
    for (const file of activeFiles) {
      nextPreviews.set(file, getMediaPreviewUrl(file));
    }
    setMediaPreviews(nextPreviews);
  }, [mediaPreviewSignature]);
  useEffect(
    () => () => {
      for (const url of mediaPreviewUrlsRef.current.values()) URL.revokeObjectURL(url);
      mediaPreviewUrlsRef.current.clear();
      for (const url of localVoicePreviewUrlsRef.current.values()) URL.revokeObjectURL(url);
      localVoicePreviewUrlsRef.current.clear();
      voiceRecordingCancelledRef.current = true;
      if (voiceRecordingTimerRef.current) clearInterval(voiceRecordingTimerRef.current);
      if (voiceRecordingWaveformTimerRef.current) {
        clearInterval(voiceRecordingWaveformTimerRef.current);
      }
      voiceRecorderRef.current?.stop();
      voiceRecordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      void voiceRecordingAudioContextRef.current?.close().catch((error: unknown) => {
        console.warn("Could not close the voice recording audio context.", error);
      });
    },
    [],
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

  function messageVersionsForDisplay(chatMessage: ChatMessage): ChatMessageVersion[] {
    const versions = messageVersions[chatMessage.id] ?? [];
    if (chatMessage.role !== "assistant") return versions;

    const messageIndex = messages.findIndex((item) => item.id === chatMessage.id);
    const sourceMessage = messages
      .slice(0, messageIndex)
      .reverse()
      .find((item) => item.role === "user");
    if (!sourceMessage) return versions;

    const contextualVersions = versions.filter(
      (version) =>
        version.source_message_id === sourceMessage.id &&
        version.source_message_version_number === displayedVersionNumber(sourceMessage),
    );
    return contextualVersions.length > 0 ||
      versions.some((version) => version.source_message_id !== null)
      ? contextualVersions
      : versions;
  }

  function displayedMessageText(chatMessage: ChatMessage): string {
    const versionNumber = displayedVersionNumber(chatMessage);
    let content =
      messageVersions[chatMessage.id]?.find((item) => item.version_number === versionNumber)
        ?.content ?? chatMessage.text;
    if (isVoiceNoteMessage(chatMessage)) {
      if (content === VOICE_NOTE_MESSAGE_TEXT) return "";
      const transcriptStart = content.lastIndexOf(`\n\n${VOICE_NOTE_TRANSCRIPT_MARKER}`);
      if (transcriptStart >= 0) {
        content = `${content.slice(0, transcriptStart)}\n${content.slice(
          transcriptStart + 2 + VOICE_NOTE_TRANSCRIPT_MARKER.length,
        )}`;
      } else if (content.startsWith(VOICE_NOTE_TRANSCRIPT_MARKER)) {
        content = content.slice(VOICE_NOTE_TRANSCRIPT_MARKER.length);
      }
    }
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
    if (isSending || isRestoringMessageVersionRef.current) return;
    const messageIndex = messages.findIndex((item) => item.id === chatMessage.id);
    const versions = messageVersionsForDisplay(chatMessage);
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
      isRestoringMessageVersionRef.current = true;
      setIsRestoringMessageVersion(true);
      setSendError("");
      setTypingAssistant(null);
      try {
        const {
          restoreChatBranch,
          loadMessageAttachments,
          loadMessageVersions,
        } = await import("./lib/chat-data");
        const branch = await restoreChatBranch(
          authClient,
          chatMessage.id,
          nextVersion.version_number,
        );
        if (versionRestoreGenerationRef.current !== restoreGeneration) return;
        if (branch.length === 0) {
          throw new Error("No saved conversation branch was returned for this message version.");
        }
        setMessages(
          (current) => {
            const existingAttachments = new Map(
              current.map((message) => [message.id, message.attachments ?? []]),
            );
            return branch.map(
              ({
                id,
                role,
                content,
                created_at,
                version_number,
                thinking_summary,
                is_reminder,
                admin_message_id,
              }) => ({
                id,
                role,
                text: content,
                createdAt: created_at,
                versionNumber: version_number,
                thinkingSummary: thinking_summary,
                adminMessageId: admin_message_id,
                isReminder: is_reminder,
                attachments: existingAttachments.get(id) ?? [],
              }),
            );
          },
        );
        branch.forEach((item) => hiddenChatMessageIdsRef.current.delete(item.id));
        setSelectedMessageVersions(
          Object.fromEntries(branch.map((item) => [item.id, item.version_number])),
        );
        setSendError("");
        isRestoringMessageVersionRef.current = false;
        setIsRestoringMessageVersion(false);

        const branchMessageIds = branch.map((item) => item.id);
        const [versionsResult, attachmentsResult] = await Promise.allSettled([
          loadMessageVersions(authClient, branchMessageIds),
          loadMessageAttachments(authClient, branchMessageIds),
        ]);
        if (versionRestoreGenerationRef.current !== restoreGeneration) return;

        const loadErrors: string[] = [];
        if (versionsResult.status === "fulfilled") {
          setMessageVersions((current) => ({ ...current, ...versionsResult.value }));
        } else {
          loadErrors.push(
            versionsResult.reason instanceof Error
              ? versionsResult.reason.message
              : "Could not load message versions for this branch.",
          );
        }
        if (attachmentsResult.status === "fulfilled") {
          setMessages((current) =>
            current.map((message) => ({
              ...message,
              attachments: attachmentsResult.value[message.id] ?? [],
            })),
          );
        } else {
          loadErrors.push(
            attachmentsResult.reason instanceof Error
              ? attachmentsResult.reason.message
              : "Could not load attachments for this branch.",
          );
        }
        if (loadErrors.length > 0) setSendError(loadErrors.join("\n"));
      } catch (error) {
        if (versionRestoreGenerationRef.current === restoreGeneration) {
          setSendError(
            error instanceof Error ? error.message : "Could not restore this conversation branch.",
          );
        }
      } finally {
        if (versionRestoreGenerationRef.current === restoreGeneration) {
          isRestoringMessageVersionRef.current = false;
          setIsRestoringMessageVersion(false);
        }
      }
      return;
    }

    setSendError("");
    setTypingAssistant(null);
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
      if (
        !(event.target instanceof Element) ||
        (!event.target.closest("[data-user-actions]") &&
          !event.target.closest("[data-user-selection-overlay]"))
      ) {
        setActiveUserActions(null);
      }
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveUserActions(null);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [activeUserActions]);

  useEffect(() => () => clearLongPressTimer(), []);

  useEffect(() => {
    if (!isSending) return;
    clearLongPressTimer();
    setActiveUserActions(null);
  }, [isSending]);

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
    const retryPendingMessages = (force = false) => {
      if (!navigator.onLine) return;
      for (const [requestId, submission] of Object.entries(failedChatSubmissions)) {
        if (
          submission.retryable &&
          !submission.retrying &&
          (force || (chatSubmissionNextRetryAtRef.current.get(requestId) ?? 0) <= Date.now())
        ) {
          void retryChatSubmission(requestId, force);
        }
      }
    };
    const retryOnReconnect = () => retryPendingMessages(true);
    const retryOnTimer = () => retryPendingMessages();
    window.addEventListener("online", retryOnReconnect);
    const retryTimer = window.setInterval(retryOnTimer, 3000);
    return () => {
      window.removeEventListener("online", retryOnReconnect);
      window.clearInterval(retryTimer);
    };
  }, [failedChatSubmissions]);

  useEffect(() => {
    const retryFailedUploads = () => {
      if (!navigator.onLine) return;
      const now = Date.now();
      for (const attachment of attachedMedia) {
        if (
          !attachment.uploadError ||
          attachment.isBlocked ||
          attachment.isUploading ||
          attachment.uploaded ||
          !/(network|fetch|timeout|connection|offline|temporar|502|503|504)/i.test(
            attachment.uploadError,
          ) ||
          (attachmentUploadNextRetryAtRef.current.get(attachment.id) ?? 0) > now
        ) {
          continue;
        }
        setAttachedMedia((current) =>
          current.map((item) =>
            item.id === attachment.id
              ? { ...item, isUploading: true, uploadError: null }
              : item,
          ),
        );
        void retryPendingAttachment(attachment);
      }
    };
    window.addEventListener("online", retryFailedUploads);
    const retryTimer = window.setInterval(retryFailedUploads, 3000);
    return () => {
      window.removeEventListener("online", retryFailedUploads);
      window.clearInterval(retryTimer);
    };
  }, [attachedMedia]);

  useEffect(() => {
    if (!isSending || !followLatestRef.current) return;
    const viewport = window.visualViewport;
    const scrollToLatest = () => {
      if (!followLatestRef.current) return;
      window.requestAnimationFrame(() => scrollConversationToLatest("auto"));
    };
    viewport?.addEventListener("resize", scrollToLatest);
    viewport?.addEventListener("scroll", scrollToLatest);
    window.addEventListener("resize", scrollToLatest);
    return () => {
      viewport?.removeEventListener("resize", scrollToLatest);
      viewport?.removeEventListener("scroll", scrollToLatest);
      window.removeEventListener("resize", scrollToLatest);
    };
  }, [isSending]);

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
      if (conversation.scrollHeight === previousHeight) stableFrames += 1;
      else stableFrames = 0;
      previousHeight = conversation.scrollHeight;

      if (stableFrames < 3) {
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
    if (!anchorId || isSending) return;
    const anchorIndex = messages.findIndex((item) => item.id === anchorId);
    if (anchorIndex < 0) return;
    const response = messages.slice(anchorIndex + 1).find((item) => item.role === "assistant");
    if (!response) return;
    pendingAssistantAnchorRef.current = null;
    if (!receivedMessageSoundsRef.current.has(response.id)) {
      receivedMessageSoundsRef.current.add(response.id);
      playChatSound(receivedMessageSound);
    }
    setTypingAssistant({ id: response.id, content: displayedMessageText(response) });
  }, [isSending, messages]);

  useEffect(() => {
    const anchorId = pendingAssistantAnchorRef.current;
    if (!isSending || !anchorId || directReplyProcessingRef.current) return;
    const anchorIndex = messages.findIndex((item) => item.id === anchorId);
    if (
      anchorIndex < 0 ||
      !messages.slice(anchorIndex + 1).some((item) => item.role === "assistant")
    ) {
      return;
    }
    setIsSending(false);
  }, [isSending, messages]);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | null = null;
    const oauthCallbackError = consumeOAuthCallbackError();
    if (oauthCallbackError) setAuthError(oauthCallbackError);
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
        setIsLoadingHistory(false);
        setMessages([]);
        setChatJobs([]);
        setHasGeminiApiKey(false);
        return;
      }

      let waitForChatHistory = false;
      setIsAuthLoading(true);
      try {
        const requestedProvider = getPendingAuthProvider();
        const { ensureSupabaseSession } = await import("./lib/supabase");
        await ensureSupabaseSession(client);
        const provider =
          requestedProvider ??
          (session.user.app_metadata.provider === "github" ? "github" : "google");
        const providerIdentity = session.user.identities?.find(
          (identity) => identity.provider === provider,
        );
        const identityData = providerIdentity?.identity_data;
        const githubUsername =
          provider === "github"
            ? [
                identityData?.user_name,
                identityData?.username,
                identityData?.preferred_username,
                identityData?.login,
              ].find((value): value is string => typeof value === "string" && value.length > 0) ??
              null
            : null;
        const googleEmail =
          provider === "google" &&
          typeof identityData?.email === "string" &&
          identityData.email.length > 0
            ? identityData.email
            : session.user.email ?? null;
        const { data: accountProfile, error: profileError } = await client
          .from("account_profiles")
          .select("role")
          .eq("user_id", session.user.id)
          .single();
        if (profileError) {
          throw new Error(
            `Could not load the account role. Apply the latest supabase/schema.sql. ${profileError.message}`,
          );
        }
        if (accountProfile.role !== "admin" && accountProfile.role !== "user") {
          throw new Error("The account role stored in the database is invalid.");
        }
        if (!isMounted) return;
        setAuthError("");
        setIsLoadingHistory(true);
        waitForChatHistory = true;
        setAuthUser({
          id: session.user.id,
          email: googleEmail,
          provider,
          githubUsername,
          role: accountProfile.role,
        });
        const accountAge = Date.now() - Date.parse(session.user.created_at);
        if (Number.isFinite(accountAge) && accountAge >= 0 && accountAge <= 24 * 60 * 60 * 1000) {
          const { access_token: authToken } = session;
          void fetch("/api/account-welcome-email", {
            method: "POST",
            headers: { Authorization: "Bearer " + authToken },
          })
            .then(async (response) => {
              if (!response.ok) {
                const payload: unknown = await response.json().catch(() => null);
                const message =
                  typeof payload === "object" &&
                  payload !== null &&
                  "statusMessage" in payload &&
                  typeof payload.statusMessage === "string"
                    ? payload.statusMessage
                    : `Welcome email request failed (${response.status}).`;
                console.error(message);
              }
            })
            .catch((error: unknown) => {
              console.error(
                "Could not request the new-account welcome email.",
                error instanceof Error ? error.message : "Network request failed.",
              );
            });
        }
        clearPendingAuthProvider();
      } catch (error) {
        if (!isMounted) return;
        setAuthUser(null);
        setAuthError(error instanceof Error ? error.message : "Could not prepare account data.");
      } finally {
        if (isMounted && !waitForChatHistory) setIsAuthLoading(false);
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
        if (!data.session && oauthCallbackError) {
          setAuthError(oauthCallbackError);
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
    hiddenChatMessageIdsRef.current.clear();
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
    void (async () => {
      try {
        const chatData = await import("./lib/chat-data");
        const {
          loadChatMessagePage,
          loadMessageAttachments,
          loadMessageVersions,
        } = chatData;
        const messagePage = await loadChatMessagePage(authClient, {
          userId: authenticatedUserId,
        });
        if (!isMounted) return;
        const savedMessages = messagePage.messages;
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
            ({ id, role, content, created_at, version_number, thinking_summary, is_reminder, admin_message_id }) => ({
              id,
              role,
              text: content,
              createdAt: created_at,
              versionNumber: version_number,
              thinkingSummary: thinking_summary,
              adminMessageId: admin_message_id,
              isReminder: is_reminder,
              attachments: currentAttachments.get(id) ?? [],
            }),
          );
        });
        shouldScrollToLatestRef.current = true;
        setIsLoadingHistory(false);
        setIsAuthLoading(false);

        const assistantMessages = savedMessages.filter((item) => item.role === "assistant");
        const adminRelayMessageIds = [
          ...new Set(savedMessages.flatMap((item) => item.admin_message_id ?? [])),
        ];
        const [
          keyResult,
          jobsResult,
          loadedVersions,
          loadedAttachments,
          loadedRatings,
          loadedAdminRelayRatings,
        ] =
          await Promise.all([
          authClient
            .from("ai_api_keys")
            .select("id")
            .order("created_at", { ascending: true })
            .limit(1),
          authClient
            .from("chat_message_jobs")
            .select("*")
            .or("status.in.(queued,processing,completed,failed),error.not.is.null")
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
          (async () => {
            if (adminRelayMessageIds.length === 0) return {};
            const { data: feedback, error } = await authClient
              .from("admin_message_feedback")
              .select("admin_message_id, kind")
              .in("admin_message_id", adminRelayMessageIds);
            if (error) {
              throw new Error(`Could not load saved relay feedback. Run the latest server schema. ${error.message}`);
            }
            return Object.fromEntries(
              feedback.flatMap((item) =>
                item.kind === "like" || item.kind === "dislike"
                  ? [[item.admin_message_id, item.kind]]
                  : [],
              ),
            ) as Record<string, AssistantRating>;
          })(),
          ]);
        if (keyResult.error) throw keyResult.error;
        if (jobsResult.error) throw jobsResult.error;
        if (isMounted) {
          setHasGeminiApiKey(keyResult.data.length > 0);
          setChatJobs(jobsResult.data);
          const latestUserMessageId = [...savedMessages]
            .reverse()
            .find((message) => message.role === "user")?.id;
          const latestUserMessageIndex = savedMessages.findIndex(
            (message) => message.id === latestUserMessageId,
          );
          const latestUserHasAssistantReply =
            latestUserMessageIndex >= 0 &&
            savedMessages
              .slice(latestUserMessageIndex + 1)
              .some((message) => message.role === "assistant");
          const pendingJob = jobsResult.data.find(
            (job) =>
              job.message_id === latestUserMessageId &&
              !latestUserHasAssistantReply &&
              (job.status === "queued" || job.status === "processing"),
          );
          const completedReplyAwaitingDisplay = jobsResult.data.find(
            (job) =>
              job.status === "completed" &&
              job.message_id ===
                [...savedMessages].reverse().find((message) => message.role === "user")?.id &&
              job.assistant_message_id !== null &&
              !savedMessages.some((message) => message.id === job.assistant_message_id),
          );
          if (pendingJob || completedReplyAwaitingDisplay) {
            pendingAssistantAnchorRef.current =
              pendingJob?.message_id ?? completedReplyAwaitingDisplay?.message_id ?? null;
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
            Boolean(pendingJob || completedReplyAwaitingDisplay) ||
              directReplyProcessingRef.current,
          );
          setRatings(loadedRatings);
          setAdminRelayRatings(loadedAdminRelayRatings);
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
          if (pathname === "/") setHistoryLoadError(message);
          setSendError(
            message,
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingHistory(false);
          setIsAuthLoading(false);
        }
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
            .select("id, user_id, message_id, storage_path, file_name, mime_type, size_bytes, identity_sha256, created_at, expires_at, deleted_at")
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
                .select("id, user_id, message_id, storage_path, file_name, mime_type, size_bytes, identity_sha256, created_at, expires_at, deleted_at")
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
            identitySha256: draft.identitySha256 ?? uploaded?.identity_sha256 ?? undefined,
            processingStage: uploaded ? undefined : "upload",
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
            identitySha256: row.identity_sha256 ?? undefined,
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
          .forEach((attachment) => {
            void uploadPendingAttachment(attachment);
          });
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
      "chat_message_attachment_links",
      "message_feedback",
      "admin_messages",
      "admin_message_feedback",
      "ai_api_keys",
    ] as const;
    let hasConnected = false;
    let isSyncingChatData = false;
    let chatSyncRequested = false;
    let isRefreshingJobStatus = false;
    let jobStatusRefreshRequested = false;
    let previousJobState = "";
    let jobStatusPoll: number | null = null;
    let generalSettingsRefreshFrame: number | null = null;
    let isRefreshingGeneralSettings = false;
    let generalSettingsRefreshRequested = false;
    const setJobStatusPolling = (enabled: boolean) => {
      if (enabled && jobStatusPoll === null) {
        jobStatusPoll = window.setInterval(() => void refreshJobStatus(), 5_000);
      } else if (!enabled && jobStatusPoll !== null) {
        window.clearInterval(jobStatusPoll);
        jobStatusPoll = null;
      }
    };
    const refreshGeneralSettings = async () => {
      if (!isMounted) return;
      if (isRefreshingGeneralSettings) {
        generalSettingsRefreshRequested = true;
        return;
      }
      isRefreshingGeneralSettings = true;
      try {
        const { data, error } = await authClient
          .from("user_settings")
          .select("enter_key_behavior_desktop, enter_key_behavior_mobile, time_format, font_size, web_search_enabled")
          .eq("user_id", authUser.id)
          .maybeSingle();
        if (error) throw error;
        if (!isMounted) return;
        const nextSettings: GeneralSettings = data
          ? {
              enter_key_behavior_desktop:
                data.enter_key_behavior_desktop === "newline" ||
                data.enter_key_behavior_desktop === "submit"
                  ? data.enter_key_behavior_desktop
                  : "system",
              enter_key_behavior_mobile:
                data.enter_key_behavior_mobile === "newline" ||
                data.enter_key_behavior_mobile === "submit"
                  ? data.enter_key_behavior_mobile
                  : "system",
              time_format:
                data.time_format === "12h" || data.time_format === "24h"
                  ? data.time_format
                  : "system",
              font_size:
                typeof data.font_size === "number" && Number.isFinite(data.font_size)
                  ? Math.min(20, Math.max(12, data.font_size))
                  : 14,
              web_search_enabled: data.web_search_enabled !== false,
            }
          : DEFAULT_GENERAL_SETTINGS;
        setGeneralSettings((current) =>
          current.enter_key_behavior_desktop === nextSettings.enter_key_behavior_desktop &&
          current.enter_key_behavior_mobile === nextSettings.enter_key_behavior_mobile &&
          current.time_format === nextSettings.time_format &&
          current.font_size === nextSettings.font_size &&
          current.web_search_enabled === nextSettings.web_search_enabled
            ? current
            : nextSettings,
        );
      } catch (error) {
        if (isMounted) {
          setSendError(
            `Could not sync General settings: ${
              error instanceof Error ? error.message : "Unknown database error."
            }`,
          );
        }
      } finally {
        isRefreshingGeneralSettings = false;
        if (generalSettingsRefreshRequested && isMounted) {
          generalSettingsRefreshRequested = false;
          scheduleGeneralSettingsRefresh();
        }
      }
    };
    const scheduleGeneralSettingsRefresh = () => {
      if (!isMounted || generalSettingsRefreshFrame !== null) return;
      generalSettingsRefreshFrame = window.requestAnimationFrame(() => {
        generalSettingsRefreshFrame = null;
        void refreshGeneralSettings();
      });
    };
    const syncChatData = async () => {
      if (!isMounted) return;
      if (isSyncingChatData) {
        chatSyncRequested = true;
        return;
      }
      isSyncingChatData = true;
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
        let syncMessages = [...page.messages];
        const messageIds = syncMessages.map((message) => message.id);
        const assistantMessageIds = syncMessages
          .filter((message) => message.role === "assistant")
          .map((message) => message.id);
        const adminRelayMessageIds = [
          ...new Set(syncMessages.flatMap((message) => message.admin_message_id ?? [])),
        ];
        let [
          attachments,
          versions,
          feedbackResult,
          adminRelayFeedbackResult,
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
          adminRelayMessageIds.length > 0
            ? authClient
                .from("admin_message_feedback")
                .select("admin_message_id, kind")
                .in("admin_message_id", adminRelayMessageIds)
            : Promise.resolve({ data: [], error: null }),
          authClient.from("ai_api_keys").select("id").limit(1),
          authClient
            .from("chat_message_jobs")
            .select("*")
            .or("status.in.(queued,processing,completed,failed),error.not.is.null")
            .order("created_at", { ascending: false })
            .limit(50),
        ]);
        if (feedbackResult.error) throw feedbackResult.error;
        if (adminRelayFeedbackResult.error) throw adminRelayFeedbackResult.error;
        if (keysResult.error) throw keysResult.error;
        if (jobsResult.error) throw jobsResult.error;
        if (!isMounted) return;

        const completedAnchorJob = jobsResult.data.find(
          (job) =>
            job.status === "completed" &&
            job.message_id === pendingAssistantAnchorRef.current &&
            job.assistant_message_id !== null,
        );
        if (completedAnchorJob?.assistant_message_id) {
          hiddenChatMessageIdsRef.current.delete(completedAnchorJob.assistant_message_id);
        }
        if (
          completedAnchorJob?.assistant_message_id &&
          !syncMessages.some((message) => message.id === completedAnchorJob.assistant_message_id)
        ) {
          const { data: recoveredAssistant, error: recoveryError } = await authClient
            .from("chat_messages")
            .select("id, user_id, role, content, embedding, created_at, version_number, thinking_summary, is_reminder, is_active, revision_reason, admin_message_id")
            .eq("id", completedAnchorJob.assistant_message_id)
            .eq("user_id", authUser.id)
            .eq("is_active", true)
            .maybeSingle();
          if (recoveryError) {
            throw new Error(`Could not recover the completed AI response: ${recoveryError.message}`);
          }
          if (recoveredAssistant) {
            syncMessages = [...syncMessages, recoveredAssistant].sort(
              (left, right) =>
                new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
            );
            const [recoveredAttachments, recoveredVersions] = await Promise.all([
              loadMessageAttachments(authClient, [recoveredAssistant.id]),
              loadMessageVersions(authClient, [recoveredAssistant.id]),
            ]);
            attachments = { ...attachments, ...recoveredAttachments };
            versions = { ...versions, ...recoveredVersions };
          }
        }

        const persistedIds = new Set(syncMessages.map((message) => message.id));
        for (const messageId of persistedIds) {
          pendingOptimisticMessageIdsRef.current.delete(messageId);
        }
        const syncedAssistantIds = syncMessages
          .filter((message) => message.role === "assistant")
          .map((message) => message.id);
        const serverMessages: ChatMessage[] = syncMessages.map(
          ({ id, role, content, created_at, version_number, thinking_summary, is_reminder, admin_message_id }) => ({
            id,
            role,
            text: content,
            createdAt: created_at,
            versionNumber: version_number,
            thinkingSummary: thinking_summary,
            adminMessageId: admin_message_id,
            isReminder: is_reminder,
            attachments: attachments[id] ?? [],
          }),
        );
        for (const job of jobsResult.data) {
          if (
            (job.assistant_message_id !== null &&
              persistedIds.has(job.assistant_message_id)) ||
            (job.status === "completed" &&
              job.assistant_message_id === null &&
              persistedIds.has(job.message_id))
          ) {
            pendingOptimisticMessageIdsRef.current.delete(job.message_id);
          }
        }
        const loadedRatings = Object.fromEntries(
          feedbackResult.data.flatMap((item) =>
            item.kind === "like" || item.kind === "dislike"
              ? [[`${item.message_id}:${item.version_number}`, item.kind]]
              : [],
          ),
        ) as Record<string, AssistantRating>;
        const loadedAdminRelayRatings = Object.fromEntries(
          adminRelayFeedbackResult.data.flatMap((item) =>
            item.kind === "like" || item.kind === "dislike"
              ? [[item.admin_message_id, item.kind]]
              : [],
          ),
        ) as Record<string, AssistantRating>;
        const loadedSelections = Object.fromEntries(
          syncMessages.map((message) => [message.id, message.version_number]),
        );

        setMessages((current) => {
          const pendingMessages = current.filter(
            (message) =>
              pendingOptimisticMessageIdsRef.current.has(message.id) &&
              !persistedIds.has(message.id),
          );
          return [...serverMessages, ...pendingMessages]
            .filter((message) => !hiddenChatMessageIdsRef.current.has(message.id))
            .sort(
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
        setAdminRelayRatings((current) => ({
          ...Object.fromEntries(
            Object.entries(current).filter(([adminMessageId]) => !adminRelayMessageIds.includes(adminMessageId)),
          ),
          ...loadedAdminRelayRatings,
        }));
        setHasGeminiApiKey(keysResult.data.length > 0);
        previousJobState = JSON.stringify(
          jobsResult.data.map((job) => [job.id, job.status, job.progress, job.error, job.updated_at]),
        );
        setChatJobs(jobsResult.data);
        const activeAnchorIndex = messagesRef.current.findIndex(
          (message) => message.id === pendingAssistantAnchorRef.current,
        );
        const activeAnchorHasAssistantReply =
          activeAnchorIndex >= 0 &&
          messagesRef.current
            .slice(activeAnchorIndex + 1)
            .some((message) => message.role === "assistant");
        const hasPendingJob = jobsResult.data.some(
          (job) =>
            job.message_id === pendingAssistantAnchorRef.current &&
            activeAnchorIndex >= 0 &&
            !activeAnchorHasAssistantReply &&
            (job.status === "queued" || job.status === "processing"),
        );
        const completedReplyAwaitingDisplay = jobsResult.data.some(
          (job) =>
            job.status === "completed" &&
            job.message_id === pendingAssistantAnchorRef.current &&
            job.assistant_message_id !== null &&
            !syncedAssistantIds.includes(job.assistant_message_id),
        );
        setJobStatusPolling(hasPendingJob || completedReplyAwaitingDisplay);
        setIsSending(
          hasPendingJob || completedReplyAwaitingDisplay || directReplyProcessingRef.current,
        );
        oldestHistoryCursorRef.current = syncMessages[0]
          ? {
              id: syncMessages[0].id,
              created_at: syncMessages[0].created_at,
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
      } finally {
        isSyncingChatData = false;
        if (chatSyncRequested && isMounted) {
          chatSyncRequested = false;
          scheduleChatSync();
        }
      }
    };
    const scheduleChatSync = () => {
      if (!isMounted) return;
      if (realtimeRefreshTimerRef.current !== null) return;
      realtimeRefreshTimerRef.current = window.requestAnimationFrame(() => {
        realtimeRefreshTimerRef.current = null;
        if (isMounted) void syncChatData();
      });
    };
    const scheduleJobRefresh = () => {
      if (!isMounted) return;
      if (jobRefreshTimerRef.current !== null) return;
      jobRefreshTimerRef.current = window.requestAnimationFrame(() => {
        jobRefreshTimerRef.current = null;
        void refreshJobStatus();
      });
    };
    let previousPendingJob = false;
    const refreshJobStatus = async () => {
      if (!isMounted) return;
      if (isRefreshingJobStatus) {
        jobStatusRefreshRequested = true;
        return;
      }
      isRefreshingJobStatus = true;
      try {
        const { data, error } = await authClient
          .from("chat_message_jobs")
          .select("*")
          .or("status.in.(queued,processing,completed,failed),error.not.is.null")
          .order("created_at", { ascending: false })
          .limit(50);
        if (!isMounted) return;
        if (error) {
          setSendError(`Could not refresh chat job status: ${error.message}`);
          return;
        }
        const anchorMessageId = pendingAssistantAnchorRef.current;
        const anchorIndex = messagesRef.current.findIndex(
          (message) => message.id === anchorMessageId,
        );
        const assistantReplyExistsAfterAnchor =
          anchorIndex >= 0 &&
          messagesRef.current
            .slice(anchorIndex + 1)
            .some((message) => message.role === "assistant");
        const hasPendingJob = data.some(
          (job) =>
            job.message_id === anchorMessageId &&
            anchorIndex >= 0 &&
            !assistantReplyExistsAfterAnchor &&
            (job.status === "queued" || job.status === "processing"),
        );
        const anchoredJob = data.find((job) => job.message_id === anchorMessageId);
        if (
          anchoredJob &&
          (anchoredJob.status === "failed" ||
            (anchoredJob.status === "completed" && anchoredJob.assistant_message_id === null))
        ) {
          pendingAssistantAnchorRef.current = null;
        }
        const completedReplyAwaitingDisplay = data.some(
          (job) =>
            job.status === "completed" &&
            job.message_id === pendingAssistantAnchorRef.current &&
            job.assistant_message_id !== null &&
            !messagesRef.current.some((message) => message.id === job.assistant_message_id),
        );
        const isChatStillInProgress = hasPendingJob || completedReplyAwaitingDisplay;
        const jobState = JSON.stringify(
          data.map((job) => [job.id, job.status, job.progress, job.error, job.updated_at]),
        );
        if (jobState !== previousJobState) {
          previousJobState = jobState;
          setChatJobs(data);
        }
        setJobStatusPolling(isChatStillInProgress);
        setIsSending(isChatStillInProgress || directReplyProcessingRef.current);
        if (
          (previousPendingJob && !isChatStillInProgress) ||
          completedReplyAwaitingDisplay
        ) {
          void syncChatData();
        }
        previousPendingJob = isChatStillInProgress;
      } catch (error) {
        if (isMounted) {
          setSendError(
            error instanceof Error
              ? `Could not refresh chat job status: ${error.message}`
              : "Could not refresh chat job status.",
          );
        }
      } finally {
        isRefreshingJobStatus = false;
        if (jobStatusRefreshRequested && isMounted) {
          jobStatusRefreshRequested = false;
          scheduleJobRefresh();
        }
      }
    };
    const refreshOnVisible = () => {
      if (document.visibilityState !== "visible") return;
      scheduleJobRefresh();
      scheduleChatSync();
    };
    document.addEventListener("visibilitychange", refreshOnVisible);
    window.addEventListener("pageshow", refreshOnVisible);
    void refreshJobStatus();
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
        return channel
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "user_settings",
              filter: `user_id=eq.${authUser.id}`,
            },
            scheduleGeneralSettingsRefresh,
          )
          .on(
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
          scheduleGeneralSettingsRefresh();
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
        window.cancelAnimationFrame(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
      if (jobRefreshTimerRef.current !== null) {
        window.cancelAnimationFrame(jobRefreshTimerRef.current);
        jobRefreshTimerRef.current = null;
      }
      if (generalSettingsRefreshFrame !== null) {
        window.cancelAnimationFrame(generalSettingsRefreshFrame);
        generalSettingsRefreshFrame = null;
      }
      setJobStatusPolling(false);
      document.removeEventListener("visibilitychange", refreshOnVisible);
      window.removeEventListener("pageshow", refreshOnVisible);
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
      if (event.key === "Escape") closeAttachmentView();
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
    const closeOnBack = () => closeRemoteAttachmentView();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRemoteAttachmentView();
    };
    window.addEventListener("popstate", closeOnBack);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("popstate", closeOnBack);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [remoteAttachmentView?.attachment.id]);

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
      const currentPath = pathnameRef.current;
      if (currentPath.startsWith("/settings/")) {
        window.history.replaceState({ appRoute: "settings" }, "", "/settings");
        wasSettingsRef.current = true;
        pathnameRef.current = "/settings";
        setPathname("/settings");
        return;
      }
      if (currentPath === "/settings" || wasSettingsRef.current) {
        window.location.replace("/");
        return;
      }

      if (nextPath.startsWith("/settings")) {
        wasSettingsRef.current = true;
        pathnameRef.current = nextPath;
        setPathname(nextPath);
        return;
      }

      if (nextPath === "/") shouldScrollToLatestRef.current = true;
      pathnameRef.current = nextPath;
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
      pathnameRef.current = path;
      setPathname(path);
    } else {
      window.location.replace(path);
    }
  }

  async function enablePushNotifications() {
    if (!authClient || isEnablingPush) return;
    setIsEnablingPush(true);
    setPushBannerError("");
    try {
      await enablePushForCurrentDevice(authClient);
      setPushStatus("enabled");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not enable push notifications.";
      setPushBannerError(message);
      setPushStatus(
        "Notification" in window && Notification.permission === "denied"
          ? "denied"
          : "error",
      );
    } finally {
      setIsEnablingPush(false);
    }
  }

  async function markInboxItemRead(item: AccountInboxItem) {
    if (!authClient || item.read_at) return;
    const readAt = new Date().toISOString();
    const { error } = await authClient
      .from("account_inbox")
      .update({ read_at: readAt })
      .eq("id", item.id)
      .eq("recipient_user_id", item.recipient_user_id);
    if (error) {
      setInboxError(`Could not mark this notification as read: ${error.message}`);
      return;
    }
    setInboxItems((items) =>
      items.map((current) => (current.id === item.id ? { ...current, read_at: readAt } : current)),
    );
    showActionToast("Notification marked as read.");
  }

  async function markAllInboxItemsRead() {
    if (
      !authClient ||
      !authenticatedUserId ||
      isMarkingInboxRead ||
      unreadInboxMessageCount === 0
    ) {
      return;
    }
    setIsMarkingInboxRead(true);
    setInboxError("");
    const readAt = new Date().toISOString();
    try {
      const { error } = await authClient
        .from("account_inbox")
        .update({ read_at: readAt })
        .eq("recipient_user_id", authenticatedUserId)
        .is("read_at", null);
      if (error) throw new Error(`Could not mark notifications as read: ${error.message}`);
      setInboxItems((items) => items.map((item) => ({ ...item, read_at: item.read_at ?? readAt })));
      showActionToast("All notifications marked as read.");
    } catch (error) {
      setInboxError(error instanceof Error ? error.message : "Could not mark notifications as read.");
    } finally {
      setIsMarkingInboxRead(false);
    }
  }

  async function clearNotificationInbox() {
    if (!authClient || isClearingInbox || inboxItems.length === 0) return;
    if (
      !window.confirm(
        "Clear all notifications from this account's inbox? This does not delete chat messages or pending admin approvals.",
      )
    ) {
      return;
    }
    setIsClearingInbox(true);
    setInboxError("");
    try {
      const {
        data: { session },
        error: sessionError,
      } = await authClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error("Your account session has expired. Sign in again.");
      const response = await fetch("/api/account-inbox-clear", {
          method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "statusMessage" in payload &&
          typeof payload.statusMessage === "string"
            ? payload.statusMessage
            : `Could not clear notifications (${response.status}).`;
        throw new Error(message);
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("deletedCount" in payload) ||
        typeof payload.deletedCount !== "number"
      ) {
        throw new Error("The inbox service returned an invalid response.");
      }
      setInboxItems([]);
      setExpandedInboxIds(new Set());
      showActionToast(
        `${payload.deletedCount} notification${payload.deletedCount === 1 ? "" : "s"} cleared.`,
      );
    } catch (error) {
      setInboxError(error instanceof Error ? error.message : "Could not clear the notification inbox.");
    } finally {
      setIsClearingInbox(false);
    }
  }

  async function resolveAdminMessageRequest(requestId: string, approve: boolean) {
    if (!authClient || activeApprovalRequestId) return;
    setActiveApprovalRequestId(requestId);
    setInboxError("");
    try {
      const {
        data: { session },
        error: sessionError,
      } = await authClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error("Your account session has expired. Sign in again.");
      const response = await fetch("/api/admin-message-approval", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestId, approve }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "statusMessage" in payload &&
          typeof payload.statusMessage === "string"
            ? payload.statusMessage
            : `Could not ${approve ? "approve" : "cancel"} this message (${response.status}).`;
        throw new Error(message);
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("deliveredCount" in payload) ||
        typeof payload.deliveredCount !== "number"
      ) {
        throw new Error("The message delivery service returned an invalid response.");
      }
      if (!approve) {
        showActionToast("Pending message cancelled.");
      } else {
        const push =
          "push" in payload &&
          typeof payload.push === "object" &&
          payload.push !== null &&
          "sent" in payload.push &&
          typeof payload.push.sent === "number" &&
          "attempted" in payload.push &&
          typeof payload.push.attempted === "number" &&
          "failed" in payload.push &&
          Array.isArray(payload.push.failed)
            ? {
                sent: payload.push.sent,
                attempted: payload.push.attempted,
                failed: payload.push.failed.filter(
                  (detail): detail is string => typeof detail === "string",
                ),
                skippedActive:
                  "skippedActive" in payload.push && payload.push.skippedActive === true,
              }
            : null;
        const pushFailure =
          "pushError" in payload && typeof payload.pushError === "string"
            ? payload.pushError
            : null;
        const deliveryNote = pushFailure
          ? ` Push notification error: ${pushFailure}`
          : push
          ? push.failed.length > 0
            ? ` Push notifications reached ${push.sent} of ${push.attempted} devices. ${push.failed.join(" ")}`
            : push.attempted === 0 && push.skippedActive
              ? " Push notifications were skipped because the recipient accounts are active in chat."
            : push.attempted === 0
              ? " No notification-enabled devices are registered for the recipients yet."
              : ` Push notifications sent to ${push.sent} device${push.sent === 1 ? "" : "s"}.`
          : " Push delivery status was unavailable.";
        showActionToast(
          `Message delivered to ${payload.deliveredCount} account${payload.deliveredCount === 1 ? "" : "s"}.${deliveryNote}`,
        );
      }
      setPendingAdminRequests((current) => current.filter((request) => request.id !== requestId));
      setAdminApprovalToast((current) => (current?.id === requestId ? null : current));
      setInboxRefresh((value) => value + 1);
    } catch (error) {
      setInboxError(error instanceof Error ? error.message : "Could not update the pending message.");
    } finally {
      setActiveApprovalRequestId(null);
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
    async (attachment: ChatAttachment, refresh = false): Promise<string> => {
      const localPreview = localVoicePreviewUrlsRef.current.get(attachment.id);
      if (localPreview) return localPreview;
      const cached = attachmentPreviewUrlCacheRef.current.get(attachment.id);
      if (!refresh && cached && cached.expiresAt > Date.now()) return cached.url;
      const pending = refresh ? undefined : attachmentPreviewRequestRef.current.get(attachment.id);
      if (pending) return pending;

      const request = (async () => {
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
          typeof payload.signedUrl !== "string" ||
          !("expiresAt" in payload) ||
          typeof payload.expiresAt !== "number" ||
          !Number.isFinite(payload.expiresAt)
        ) {
          throw new Error("The attachment service returned an invalid preview link.");
        }
        attachmentPreviewUrlCacheRef.current.set(attachment.id, {
          url: payload.signedUrl,
          expiresAt: payload.expiresAt - 10_000,
        });
        return payload.signedUrl;
      })();
      attachmentPreviewRequestRef.current.set(attachment.id, request);
      try {
        return await request;
      } finally {
        if (attachmentPreviewRequestRef.current.get(attachment.id) === request) {
          attachmentPreviewRequestRef.current.delete(attachment.id);
        }
      }
    },
    [authClient],
  );

  async function registerChatAttachment(
    attachment: PendingChatAttachment,
  ): Promise<ChatAttachmentRegistration> {
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
          identitySha256: attachment.identitySha256 ?? sha256,
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
      if (!("storagePath" in payload) || typeof payload.storagePath !== "string") {
        throw new Error("The attachment service did not return a stored-file location.");
      }
      return {
        uploadRequired: false,
        reused: payload.reused,
        attachment: payload.attachment,
        storagePath: payload.storagePath,
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
      if (uploadError && /already exists|resource exists/i.test(uploadError.message)) {
        registration = await register("register");
      } else if (uploadError) {
        throw new Error(`Could not upload ${attachment.file.name}: ${uploadError.message}`);
      } else {
        registration = await register("register");
      }
    }

    if (registration.uploadRequired || !registration.attachment) {
      throw new Error("The attachment service did not finish registering the file.");
    }
    return registration;
  }

  async function findReusableAttachment(
    attachment: PendingChatAttachment,
    identitySha256: string,
  ): Promise<ChatAttachmentRegistration> {
    if (!authClient) throw new Error("Sign in before looking up uploaded attachments.");
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();
    if (userError) throw userError;
    if (!user || user.is_anonymous) throw new Error("Sign in before looking up uploaded attachments.");
    const digest = await crypto.subtle.digest("SHA-256", await attachment.file.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const accessToken = await getAccessToken();
    const response = await fetch("/api/chat-attachments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "lookup",
        id: attachment.id,
        fileName: attachment.file.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.file.size,
        sha256,
        identitySha256,
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
          : `Could not check for a previously uploaded file (${response.status}).`;
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
      throw new Error("The attachment service returned an invalid duplicate lookup.");
    }
    if (payload.uploadRequired) return { uploadRequired: true, reused: false };
    if (
      !("attachment" in payload) ||
      !isChatAttachment(payload.attachment) ||
      !("storagePath" in payload) ||
      typeof payload.storagePath !== "string"
    ) {
      throw new Error("The attachment service returned invalid reused-file metadata.");
    }
    return {
      uploadRequired: false,
      reused: payload.reused,
      attachment: payload.attachment,
      storagePath: payload.storagePath,
    };
  }

  async function retryPendingAttachment(attachment: PendingChatAttachment) {
    void uploadPendingAttachment({ ...attachment, isUploading: true, uploadError: null });
  }

  async function uploadImageAttachment(attachment: PendingChatAttachment) {
    const updateDraft = (update: Partial<PendingChatAttachment>) => {
      setAttachedMedia((current) =>
        current.map((item) => (item.id === attachment.id ? { ...item, ...update } : item)),
      );
    };
    try {
      if (cancelledAttachmentsRef.current.has(attachment.id)) {
        cancelledAttachmentsRef.current.delete(attachment.id);
        return;
      }
      const identitySha256 =
        attachment.identitySha256 ??
        (await getChatAttachmentIdentityHash(attachment.file, attachment.mimeType));
      const identified = {
        ...attachment,
        identitySha256,
        processingStage: "upload" as const,
      };
      if (cancelledAttachmentsRef.current.has(attachment.id)) {
        cancelledAttachmentsRef.current.delete(attachment.id);
        return;
      }
      updateDraft({ identitySha256, processingStage: "upload" });
      if (!authUser) throw new Error("Sign in before saving a photo.");
      await saveChatAttachmentDraft(
        authUser.id,
        attachment.id,
        attachment.file,
        attachment.mimeType,
        attachment.draftSavedAt,
        { identitySha256, processingStage: "upload" },
      );
      prepareAiBarcodeRead(attachment);

      const reusable = await findReusableAttachment(identified, identitySha256);
      if (cancelledAttachmentsRef.current.has(attachment.id)) {
        if (!reusable.uploadRequired) {
          await deleteStoredAttachments([attachment.id]);
          if (authUser) await removeChatAttachmentDraft(authUser.id, attachment.id);
        }
        cancelledAttachmentsRef.current.delete(attachment.id);
        return;
      }
      if (!reusable.uploadRequired) {
        if (!authClient || !reusable.attachment || !reusable.storagePath) {
          throw new Error("The attachment service returned incomplete reused-photo data.");
        }
        const { data: storedBlob, error } = await authClient.storage
          .from(CHAT_ATTACHMENT_BUCKET)
          .download(reusable.storagePath);
        if (error) throw new Error(`Could not load the previously saved photo: ${error.message}`);
        if (storedBlob.size !== reusable.attachment.size_bytes) {
          throw new Error("The previously saved photo did not match its stored size.");
        }
        if (cancelledAttachmentsRef.current.has(attachment.id)) {
          await deleteStoredAttachments([attachment.id]);
          await removeChatAttachmentDraft(authUser.id, attachment.id);
          cancelledAttachmentsRef.current.delete(attachment.id);
          return;
        }
        const storedFile = new File([storedBlob], reusable.attachment.file_name, {
          type: reusable.attachment.mime_type,
          lastModified: Date.parse(reusable.attachment.created_at) || Date.now(),
        });
        await saveChatAttachmentDraft(
          authUser.id,
          attachment.id,
          storedFile,
          reusable.attachment.mime_type,
          attachment.draftSavedAt,
          { identitySha256 },
        );
        updateDraft({
          file: storedFile,
          mimeType: reusable.attachment.mime_type,
          isPreprocessed: true,
          processingStage: undefined,
          isUploading: false,
          uploadError: null,
          uploaded: reusable.attachment,
        });
        return;
      }

      const ready = {
        ...identified,
        isPreprocessed: false,
        processingStage: "upload" as const,
        isUploading: true,
        uploadError: null,
      };
      updateDraft(ready);
      await saveChatAttachmentDraft(
        authUser.id,
        attachment.id,
        attachment.file,
        attachment.mimeType,
        attachment.draftSavedAt,
        { identitySha256, processingStage: "upload" },
      );
      await uploadPendingAttachment(ready);
    } catch (error) {
      if (cancelledAttachmentsRef.current.has(attachment.id)) {
        cancelledAttachmentsRef.current.delete(attachment.id);
        setSendError(
          error instanceof Error
            ? `The removed photo could not be fully cleaned up: ${error.message}`
            : "The removed photo could not be fully cleaned up.",
        );
        return;
      }
      const message =
        error instanceof Error ? error.message : `Could not save "${attachment.file.name}".`;
      updateDraft({
        isUploading: false,
        processingStage: "upload",
        uploadError: message,
      });
      setSendError(message);
    }
  }

  async function uploadPendingAttachment(
    attachment: PendingChatAttachment,
  ): Promise<ChatAttachment | null> {
    if (retryingAttachmentUploadsRef.current.has(attachment.id)) return null;
    retryingAttachmentUploadsRef.current.add(attachment.id);
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
          const message = `This file cannot be safely reduced to the ${formatChatAttachmentSize(MAX_CHAT_ATTACHMENT_BYTES)} per-file upload limit without risking media quality, so it was not uploaded.`;
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
      if (uploadable.mimeType.startsWith("image/") && !uploadable.identitySha256) {
        uploadable = {
          ...uploadable,
          identitySha256: await getChatAttachmentIdentityHash(
            uploadable.file,
            uploadable.mimeType,
          ),
        };
        setAttachedMedia((current) =>
          current.map((item) =>
            item.id === uploadable.id
              ? { ...item, identitySha256: uploadable.identitySha256 }
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
        {
          identitySha256: uploadable.identitySha256,
          processingStage: "upload",
        },
      );
      if (cancelledAttachmentsRef.current.has(uploadable.id)) {
        throw new Error("The attachment was removed from the composer.");
      }
      const registration = await registerChatAttachment(uploadable);
      if (registration.uploadRequired || !registration.attachment || !registration.storagePath) {
        throw new Error("The attachment service did not finish registering the file.");
      }
      let storedFile = uploadable.file;
      let storedMimeType = uploadable.mimeType;
      if (
        registration.reused &&
        uploadable.mimeType.startsWith("image/") &&
        registration.storagePath !== `${authUser.id}/${uploadable.id}`
      ) {
        if (!authClient) throw new Error("The account service is not available.");
        const { data: blob, error: downloadError } = await authClient.storage
          .from(CHAT_ATTACHMENT_BUCKET)
          .download(registration.storagePath);
        if (downloadError) {
          throw new Error(`Could not load the previously stored photo: ${downloadError.message}`);
        }
        storedMimeType = registration.attachment.mime_type;
        storedFile = new File([blob], registration.attachment.file_name, {
          type: storedMimeType,
          lastModified: Date.parse(registration.attachment.created_at) || Date.now(),
        });
        await saveChatAttachmentDraft(
          authUser.id,
          uploadable.id,
          storedFile,
          storedMimeType,
          uploadable.draftSavedAt,
          {
            identitySha256: uploadable.identitySha256,
          },
        );
      }
      await saveChatAttachmentDraft(
        authUser.id,
        uploadable.id,
        storedFile,
        storedMimeType,
        uploadable.draftSavedAt,
        {
          identitySha256: uploadable.identitySha256,
        },
      );
      const uploaded = registration.attachment;
      if (uploadable.isAutoSentVoiceNote) {
        const renderKey = voiceNoteRenderKeysRef.current.get(uploadable.id);
        if (renderKey) voiceNoteRenderKeysRef.current.set(uploaded.id, renderKey);
      }
      if (cancelledAttachmentsRef.current.has(uploadable.id)) {
        await deleteStoredAttachments([uploadable.id]);
        await removeChatAttachmentDraft(authUser.id, uploadable.id);
        cancelledAttachmentsRef.current.delete(uploadable.id);
        return null;
      }
      setAttachedMedia((current) =>
        current.map((item) =>
          item.id === uploadable.id
            ? {
                ...item,
                file: storedFile,
                mimeType: storedMimeType,
                isUploading: false,
                isBlocked: false,
                processingStage: undefined,
                uploadError: null,
                uploaded,
              }
            : item,
        ),
      );
      attachmentUploadRetryAttemptsRef.current.delete(uploadable.id);
      attachmentUploadNextRetryAtRef.current.delete(uploadable.id);
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
      if (!preprocessingFailed) {
        const attempts = (attachmentUploadRetryAttemptsRef.current.get(attachment.id) ?? 0) + 1;
        attachmentUploadRetryAttemptsRef.current.set(attachment.id, attempts);
        if (/(network|fetch|timeout|connection|offline|temporar|502|503|504)/i.test(message)) {
          attachmentUploadNextRetryAtRef.current.set(
            attachment.id,
            Date.now() + Math.min(30_000, 1500 * 2 ** Math.min(attempts, 5)),
          );
        }
      }
      if (preprocessingFailed) {
        setAttachedMedia((current) => current.filter((item) => item.id !== attachment.id));
        setSendError(message);
        return null;
      }
      setAttachedMedia((current) =>
        current.map((item) =>
          item.id === attachment.id
            ? {
                ...item,
                isUploading: false,
                isBlocked: false,
                processingStage: "upload",
                uploadError: message,
              }
            : item,
        ),
      );
      setSendError(message);
      return null;
    } finally {
      retryingAttachmentUploadsRef.current.delete(attachment.id);
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
    remoteAttachmentViewRequestRef.current += 1;
    setRemoteAttachmentView(null);
    const currentState = window.history.state;
    if (currentState && typeof currentState === "object" && "remoteAttachmentView" in currentState) {
      const { remoteAttachmentView: _remoteAttachmentView, ...nextState } = currentState;
      window.history.replaceState(nextState, "", window.location.href);
    }
  }

  async function openStoredAttachment(attachment: ChatAttachment) {
    if (isChatAttachmentExpired(attachment)) {
      setSendError(`"${attachment.file_name}" expired after 24 hours and is no longer available.`);
      return;
    }

    const requestId = ++remoteAttachmentViewRequestRef.current;
    const cachedPreview = attachmentPreviewUrlCacheRef.current.get(attachment.id);
    const cachedUrl =
      cachedPreview && cachedPreview.expiresAt > Date.now() ? cachedPreview.url : "";
    const isMedia =
      attachment.mime_type.startsWith("image/") || attachment.mime_type.startsWith("video/");
    pendingConversationScrollRestoreRef.current = conversationRef.current?.scrollTop ?? 0;
    setSendError("");
    setRemoteAttachmentView({
      attachment,
      signedUrl: cachedUrl,
      textContent: null,
      isLoading: !cachedUrl,
    });
    if (isMedia && cachedUrl) return;

    try {
      const signedUrl = await getAttachmentPreviewUrl(attachment);
      if (requestId !== remoteAttachmentViewRequestRef.current) return;

      let textContent: string | null = null;
      if (isTextAttachment(attachment.mime_type, attachment.file_name)) {
        const fileResponse = await fetch(signedUrl);
        if (!fileResponse.ok) {
          throw new Error(`Could not load file preview (${fileResponse.status}).`);
        }
        textContent = await fileResponse.text();
        if (textContent.includes("\0")) {
          throw new Error("This file contains binary data and cannot be previewed as text.");
        }
      }
      if (requestId !== remoteAttachmentViewRequestRef.current) return;
      setRemoteAttachmentView({
        attachment,
        signedUrl,
        textContent,
        isLoading: false,
      });
    } catch (error) {
      if (requestId === remoteAttachmentViewRequestRef.current) {
        setRemoteAttachmentView(null);
        setSendError(error instanceof Error ? error.message : "Could not open attachment.");
      }
    }
  }

  function addPickedFiles(
    fileList: FileList | File[] | null,
    alreadyProcessed = false,
    attachmentIds: string[] = [],
    autoSendVoiceNote = false,
  ) {
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
        id: attachmentIds[acceptedFiles.length] ?? crypto.randomUUID(),
        file,
        mimeType,
        isAutoSentVoiceNote: autoSendVoiceNote && mimeType.startsWith("audio/"),
        isUploading: true,
        isBlocked: false,
        isPreprocessed: alreadyProcessed,
        processingStage: "upload",
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
            if (attachment.mimeType.startsWith("image/") && !alreadyProcessed) {
              await uploadImageAttachment(attachment);
              continue;
            }
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
              const message = `This file cannot be safely reduced to the ${formatChatAttachmentSize(MAX_CHAT_ATTACHMENT_BYTES)} per-file upload limit without risking media quality, so it was not uploaded.`;
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
              rejectionReasons.push(`"${attachment.file.name}" cannot be safely reduced to the per-file upload limit.`);
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
              processingStage: "upload",
            };
            setAttachedMedia((current) =>
              current.map((item) =>
                item.id === attachment.id
                  ? {
                      ...item,
                      file: processed.file,
                      mimeType: processedMimeType,
                      isPreprocessed: true,
                      processingStage: "upload",
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

  async function releaseVoiceRecording() {
    if (voiceRecordingTimerRef.current) {
      clearInterval(voiceRecordingTimerRef.current);
      voiceRecordingTimerRef.current = null;
    }
    if (voiceRecordingWaveformTimerRef.current) {
      clearInterval(voiceRecordingWaveformTimerRef.current);
      voiceRecordingWaveformTimerRef.current = null;
    }
    voiceRecordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceRecordingStreamRef.current = null;
    voiceRecordingAnalyserRef.current = null;
    const audioContext = voiceRecordingAudioContextRef.current;
    voiceRecordingAudioContextRef.current = null;
    try {
      if (audioContext && audioContext.state !== "closed") await audioContext.close();
    } finally {
      voiceRecorderRef.current = null;
      setIsRecordingVoice(false);
      setVoiceRecordingSeconds(0);
      setVoiceRecordingWaveform(Array.from({ length: 36 }, () => 4));
    }
  }

  async function finishVoiceRecording() {
    const elapsedSeconds = Math.floor((Date.now() - voiceRecordingStartAtRef.current) / 1000);
    const chunks = voiceRecordingChunksRef.current;
    voiceRecordingChunksRef.current = [];
    const recorder = voiceRecorderRef.current;
    try {
      await releaseVoiceRecording();
    } catch (error) {
      setSendError(
        error instanceof Error
          ? `Could not finish voice recording: ${error.message}`
          : "Could not finish voice recording. Please try again.",
      );
      return;
    }
    if (voiceRecordingCancelledRef.current) return;
    if (elapsedSeconds < 1) {
      setSendError("Record a little longer before stopping the voice message.");
      return;
    }

    let blob: Blob;
    try {
      const recording = new Blob(chunks, {
        type: recorder?.mimeType || chunks[0]?.type || "audio/webm",
      });
      if (recording.size === 0) throw new Error("The microphone recording was empty. Try again.");
      const decoder = new AudioContext();
      try {
        const decoded = await decoder.decodeAudioData(await recording.arrayBuffer());
        const monoSamples = new Float32Array(decoded.length);
        for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
          const channelSamples = decoded.getChannelData(channel);
          for (let index = 0; index < decoded.length; index += 1) {
            monoSamples[index] += channelSamples[index] / decoded.numberOfChannels;
          }
        }
        blob = encodeVoiceNoteWav(monoSamples, decoded.sampleRate);
      } finally {
        await decoder.close();
      }
    } catch (error) {
      setSendError(
        error instanceof Error
          ? `Could not prepare the microphone recording: ${error.message}`
          : "Could not prepare the microphone recording. Please try again.",
      );
      return;
    }
    if (blob.size > MAX_CHAT_ATTACHMENT_SOURCE_BYTES) {
      setSendError(
        `The recording exceeds the ${formatChatAttachmentSize(MAX_CHAT_ATTACHMENT_SOURCE_BYTES)} file limit. Record a shorter voice message.`,
      );
      return;
    }
    const file = new File([blob], `voice-message-${Date.now()}.wav`, {
      type: "audio/wav",
      lastModified: Date.now(),
    });
    const id = crypto.randomUUID();
    const createdAt = new Date();
    const localPreviewUrl = URL.createObjectURL(file);
    localVoicePreviewUrlsRef.current.set(id, localPreviewUrl);
    voiceNoteRenderKeysRef.current.set(id, `voice-note:${id}`);
    autoSendVoiceMessageIdRef.current = id;
    setMessages((current) => [
      ...current,
      {
        id,
        role: "user",
        text: VOICE_NOTE_MESSAGE_TEXT,
        createdAt: createdAt.toISOString(),
        versionNumber: 1,
        thinkingSummary: null,
        attachments: [{
          id,
          user_id: authUser?.id ?? "",
          message_id: null,
          file_name: file.name,
          mime_type: "audio/wav",
          size_bytes: file.size,
          created_at: createdAt.toISOString(),
          expires_at: new Date(createdAt.getTime() + CHAT_ATTACHMENT_RETENTION_MS).toISOString(),
          deleted_at: null,
        }],
      },
    ]);
    addPickedFiles([file], false, [id], true);
  }

  async function startVoiceRecording() {
    if (isRecordingVoice || isAssistantBusy || isAttachmentUploadPending) return;
    if (!authUser) {
      setSendError("Sign in before recording a voice message.");
      return;
    }
    if (attachedMedia.length > 0) {
      setSendError("Send or remove the current attachments before recording a voice message.");
      return;
    }
    if (!window.isSecureContext) {
      setSendError(
        "Microphone access requires a secure connection. On a phone, open the app over HTTPS; the local network HTTP address cannot request microphone access.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      setSendError("Voice recording is not supported by this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const supportedMimeType = ["audio/webm;codecs=opus", "audio/mp4"].find((mimeType) =>
        MediaRecorder.isTypeSupported(mimeType),
      );
      const recorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType, audioBitsPerSecond: 128_000 })
        : new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceRecordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => void finishVoiceRecording();
      voiceRecordingStreamRef.current = stream;
      voiceRecordingAudioContextRef.current = audioContext;
      voiceRecordingAnalyserRef.current = analyser;
      voiceRecordingChunksRef.current = [];
      voiceRecorderRef.current = recorder;
      voiceRecordingCancelledRef.current = false;
      voiceRecordingStartAtRef.current = Date.now();
      await audioContext.resume();
      recorder.start(250);
      setIsRecordingVoice(true);
      setSendError("");
      voiceRecordingTimerRef.current = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - voiceRecordingStartAtRef.current) / 1000);
        setVoiceRecordingSeconds(elapsedSeconds);
        const maxRecordingSeconds = Math.floor(
          MAX_CHAT_ATTACHMENT_SOURCE_BYTES / (audioContext.sampleRate * 2),
        );
        if (elapsedSeconds >= maxRecordingSeconds) {
          stopVoiceRecording(true);
          setSendError(
            `Voice recordings are limited to ${formatMediaTime(maxRecordingSeconds)}. Please record a shorter message.`,
          );
        }
      }, 250);
      voiceRecordingWaveformTimerRef.current = setInterval(() => {
        const currentAnalyser = voiceRecordingAnalyserRef.current;
        if (!currentAnalyser) return;
        const samples = new Float32Array(currentAnalyser.fftSize);
        currentAnalyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        const rms = Math.sqrt(energy / samples.length);
        const height = Math.max(4, Math.min(30, Math.round(4 + Math.sqrt(rms) * 52)));
        setVoiceRecordingWaveform((current) => [...current.slice(1), height]);
      }, 60);
    } catch (error) {
      voiceRecordingChunksRef.current = [];
      await releaseVoiceRecording().catch((releaseError: unknown) => {
        console.warn("Could not clean up a failed voice recording.", releaseError);
      });
      setSendError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow microphone access for this site in your browser settings, then try again."
          : error instanceof DOMException && error.name === "NotFoundError"
            ? "No microphone was found on this device."
            : error instanceof DOMException && error.name === "NotReadableError"
              ? "The microphone is busy or unavailable. Close other apps using it, then try again."
              : error instanceof Error
                ? `Could not start voice recording: ${error.message}`
                : "Could not start voice recording. Check microphone permission and try again.",
      );
    }
  }

  function stopVoiceRecording(cancel = false) {
    const recorder = voiceRecorderRef.current;
    voiceRecordingCancelledRef.current = cancel;
    if (cancel) {
      voiceRecordingChunksRef.current = [];
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      } else {
        void releaseVoiceRecording().catch((error: unknown) => {
          console.warn("Could not cancel the voice recording cleanly.", error);
        });
      }
    } else if (recorder) {
      if (recorder.state !== "inactive") recorder.stop();
    } else {
      voiceRecordingChunksRef.current = [];
      void releaseVoiceRecording().catch((error: unknown) => {
        console.warn("Could not stop the voice recording cleanly.", error);
      });
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
    if (
      !pending ||
      !file ||
      pending.isBlocked ||
      pending.uploadError
    ) {
      return;
    }

    const requestId = ++attachmentViewRequestRef.current;
    const isMedia = pending.mimeType.startsWith("image/") || pending.mimeType.startsWith("video/");
    if (isMedia) getMediaPreviewUrl(file);
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
    const currentState = window.history.state;
    if (currentState && typeof currentState === "object" && "attachmentView" in currentState) {
      const { attachmentView: _attachmentView, ...nextState } = currentState;
      window.history.replaceState(nextState, "", window.location.href);
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

  async function saveProcessedDraftImage(
    original: PendingChatAttachment,
    processedFile: File,
    successMessage: string,
  ) {
    if (!attachmentView || attachedMedia[attachmentView.index]?.id !== original.id) {
      throw new Error("The selected photo changed before the edit could be saved.");
    }
    const mimeType = resolveChatAttachmentMimeType(processedFile);
    if (!mimeType || !mimeType.startsWith("image/")) {
      throw new Error("The processed file is not a supported photo format.");
    }
    if (processedFile.size > MAX_CHAT_ATTACHMENT_BYTES) {
      throw new Error(
        `The processed photo exceeds the ${formatChatAttachmentSize(MAX_CHAT_ATTACHMENT_BYTES)} upload limit. The original is unchanged.`,
      );
    }
    const replacement: PendingChatAttachment = {
      id: crypto.randomUUID(),
      file: processedFile,
      mimeType,
      isUploading: true,
      isBlocked: false,
      isPreprocessed: true,
      uploadError: null,
      uploaded: null,
    };
    const attachmentIndex = attachmentView.index;
    getMediaPreviewUrl(processedFile);
    setAttachedMedia((current) =>
      current.map((item, index) => (index === attachmentIndex ? replacement : item)),
    );
    setAttachmentView({ index: attachmentIndex, mode: "media" });
    const uploaded = await uploadPendingAttachment(replacement);
    if (!uploaded) {
      setAttachedMedia((current) =>
        current.map((item) => (item.id === replacement.id ? original : item)),
      );
      try {
        await deleteStoredAttachments([replacement.id]);
        if (authUser) await removeChatAttachmentDraft(authUser.id, replacement.id);
      } catch (cleanupError) {
        setSendError(
          `The processed photo could not be uploaded; the original is unchanged. Cleanup of the incomplete file also failed: ${
            cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error."
          }`,
        );
        return;
      }
      setSendError("The processed photo could not be uploaded. The original is unchanged.");
      return;
    }

    barcodeReadsRef.current.delete(original.id);
    attachmentPreviewUrlCacheRef.current.delete(original.id);
    try {
      await deleteStoredAttachments([original.id]);
      if (authUser) await removeChatAttachmentDraft(authUser.id, original.id);
    } catch (error) {
      setSendError(
        error instanceof Error
          ? `The processed photo was saved, but the original upload could not be removed: ${error.message}`
          : "The processed photo was saved, but the original upload could not be removed.",
      );
    }
    showActionToast(successMessage);
  }

  async function commitImageCrop(croppedFile: File) {
    if (!attachmentView || attachmentView.mode !== "crop") return;
    const original = attachedMedia[attachmentView.index];
    if (!original || original.isUploading) {
      throw new Error("Wait for the current upload to finish before cropping this photo.");
    }
    await saveProcessedDraftImage(
      original,
      croppedFile,
      "Cropped photo saved to attachments.",
    );
  }

  function formatFileSize(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function submitChatRequest(payload: ChatSubmissionPayload): Promise<{
    jobId: string;
    messageId: string;
  }> {
    const accessToken = await getAccessToken();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch("/api/chat-jobs", {
        method: "POST",
        headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
        body: JSON.stringify({
          content: payload.content,
          thinkingMode: payload.thinkingMode,
          attachmentIds: payload.attachmentIds,
          barcodeReadings: payload.barcodeReadings,
          clientRequestId: payload.clientRequestId,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ChatSubmissionError(
          "The connection timed out while sending your message. Cheya will retry safely.",
          true,
        );
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }

    const result = (await response.json().catch(() => null)) as
      | { jobId?: string; messageId?: string; statusMessage?: string; message?: string }
      | null;
    if (!response.ok) {
      const message =
        result?.statusMessage ??
        result?.message ??
        `The chat server could not queue your message (${response.status}).`;
      throw new ChatSubmissionError(
        message,
        !navigator.onLine ||
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500,
      );
    }
    if (!result?.jobId || !result.messageId) {
      throw new ChatSubmissionError(
        "The chat server accepted an invalid job response. Retry safely to check its status.",
        true,
      );
    }
    return { jobId: result.jobId, messageId: result.messageId };
  }

  function markChatSubmissionAccepted(
    requestId: string,
    messageId: string,
    submittedAttachments: PendingChatAttachment[],
  ) {
    pendingOptimisticMessageIdsRef.current.add(messageId);
    pendingChatSubmissionsRef.current.delete(requestId);
    chatSubmissionRetryAttemptsRef.current.delete(requestId);
    chatSubmissionNextRetryAtRef.current.delete(requestId);
    retryingChatSubmissionsRef.current.delete(requestId);
    setFailedChatSubmissions((current) => {
      const next = { ...current };
      delete next[requestId];
      return next;
    });
    pendingAssistantAnchorRef.current = messageId;
    setMessages((current) => {
      const optimisticMessageExists = current.some((item) => item.id === requestId);
      const serverMessageExists = current.some(
        (item) => item.id === messageId && item.id !== requestId,
      );
      if (requestId === messageId && optimisticMessageExists) {
        return current.map((item) =>
          item.id === messageId
            ? {
                ...item,
                attachments:
                  submittedAttachments.length > 0
                    ? submittedAttachments.flatMap((attachment) =>
                        attachment.uploaded ? [attachment.uploaded] : [],
                      )
                    : item.attachments,
              }
            : item,
        );
      }
      return current.flatMap((item) => {
        if (item.id !== requestId) return [item];
        if (serverMessageExists) return [];
        return [
          {
            ...item,
            id: messageId,
            attachments:
              submittedAttachments.length > 0
                ? submittedAttachments.flatMap((attachment) =>
                    attachment.uploaded ? [attachment.uploaded] : [],
                  )
                : item.attachments,
          },
        ];
      });
    });
    playChatSound(sendMessageSound);
  }

  async function retryChatSubmission(requestId: string, force = true) {
    const failedSubmission = failedChatSubmissions[requestId];
    const payload = pendingChatSubmissionsRef.current.get(requestId);
    if (
      !failedSubmission ||
      !payload ||
      retryingChatSubmissionsRef.current.has(requestId) ||
      directReplyProcessingRef.current ||
      (!force &&
        (chatSubmissionNextRetryAtRef.current.get(requestId) ?? 0) > Date.now())
    ) return;
    unlockChatNotificationSounds();
    if (!navigator.onLine && !failedSubmission.retrying) {
      setFailedChatSubmissions((current) => ({
        ...current,
        [requestId]: {
          ...current[requestId],
          error: "No internet connection. Cheya will retry when you are back online.",
          retrying: false,
        },
      }));
      return;
    }

    retryingChatSubmissionsRef.current.add(requestId);
    setFailedChatSubmissions((current) => ({
      ...current,
      [requestId]: { ...current[requestId], retrying: true },
    }));
    setIsSending(true);
    directReplyProcessingRef.current = true;
    try {
      const accepted = await submitChatRequest(payload);
      markChatSubmissionAccepted(requestId, accepted.messageId, []);
      directReplyProcessingRef.current = false;
      setThinkingSteps(payload.thinkingMode ? ["Membaca pesan dan konteks percakapan…"] : []);
    } catch (error) {
      const attempts = (chatSubmissionRetryAttemptsRef.current.get(requestId) ?? 0) + 1;
      chatSubmissionRetryAttemptsRef.current.set(requestId, attempts);
      chatSubmissionNextRetryAtRef.current.set(
        requestId,
        Date.now() + Math.min(30_000, 1500 * 2 ** Math.min(attempts, 5)),
      );
      setFailedChatSubmissions((current) => ({
        ...current,
        [requestId]: {
          error: error instanceof Error ? error.message : "Could not retry your message.",
          retryable:
            error instanceof ChatSubmissionError
              ? error.retryable
              : !navigator.onLine || error instanceof TypeError,
          retrying: false,
        },
      }));
      directReplyProcessingRef.current = false;
      setIsSending(false);
    } finally {
      retryingChatSubmissionsRef.current.delete(requestId);
    }
  }

  async function sendMessage(voiceMessageId?: string) {
    if (isAssistantBusy || directReplyProcessingRef.current) return;
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
    const attachmentBytes = attachedMedia.reduce(
      (total, attachment) => total + (attachment.uploaded?.size_bytes ?? attachment.file.size),
      0,
    );
    if (attachmentBytes > MAX_CHAT_MESSAGE_ATTACHMENT_BYTES) {
      setSendError(
        `Attachments in one message cannot exceed ${formatChatAttachmentSize(MAX_CHAT_MESSAGE_ATTACHMENT_BYTES)} total. Remove one or more files before sending.`,
      );
      return;
    }
    if (attachedMedia.some((attachment) => !attachment.uploaded)) {
      setSendError("Wait for every attachment to finish uploading, or remove failed uploads.");
      return;
    }

    unlockChatNotificationSounds();
    setSendError("");
    setIsSending(true);
    directReplyProcessingRef.current = true;
    followLatestRef.current = true;
    shouldScrollToLatestRef.current = true;
    const showThinking = thinkingModeRef.current;
    let jobAccepted = false;
    const clientRequestId = voiceMessageId ?? crypto.randomUUID();
    const submittedAttachments = attachedMedia;
    const hasVoiceNote = submittedAttachments.some((attachment) =>
      attachment.mimeType.startsWith("audio/"),
    );
    const messageContent =
      prompt ||
      (hasVoiceNote ? VOICE_NOTE_MESSAGE_TEXT : "Please review the attached files.");
    const submissionPayload: ChatSubmissionPayload = {
      clientRequestId,
      content: messageContent,
      thinkingMode: showThinking,
      attachmentIds: submittedAttachments.map((attachment) => attachment.id),
      barcodeReadings: [],
    };
    const optimisticMessage: ChatMessage = {
      id: clientRequestId,
      role: "user",
      text: messageContent,
      createdAt: new Date().toISOString(),
      versionNumber: 1,
      thinkingSummary: null,
      attachments: submittedAttachments.flatMap((attachment) =>
        attachment.uploaded ? [attachment.uploaded] : [],
      ),
    };
    pendingOptimisticMessageIdsRef.current.add(clientRequestId);
    pendingChatSubmissionsRef.current.set(clientRequestId, submissionPayload);
    setMessages((current) => {
      const existingIndex = current.findIndex((message) => message.id === clientRequestId);
      if (existingIndex < 0) return [...current, optimisticMessage];
      return current.map((message) =>
        message.id === clientRequestId ? optimisticMessage : message,
      );
    });
    setAttachedMedia([]);
    if (messageInputRef.current) {
      messageInputRef.current.value = "";
      resizeMessageInput(messageInputRef.current);
    }
    messageDraftRef.current = "";
    if (messageDraftSaveTimerRef.current) {
      clearTimeout(messageDraftSaveTimerRef.current);
      messageDraftSaveTimerRef.current = null;
    }
    try {
      localStorage.removeItem(messageDraftStorageKey(authUser.id));
    } catch (error) {
      console.warn("Could not clear the submitted chat draft:", error);
    }
    try {
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
      submissionPayload.barcodeReadings = barcodeReadings;
      const accepted = await submitChatRequest(submissionPayload);
      jobAccepted = true;
      directReplyProcessingRef.current = false;
      markChatSubmissionAccepted(clientRequestId, accepted.messageId, submittedAttachments);
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
        const retryable =
          error instanceof ChatSubmissionError
            ? error.retryable
            : !navigator.onLine || error instanceof TypeError;
        const attempts = (chatSubmissionRetryAttemptsRef.current.get(clientRequestId) ?? 0) + 1;
        chatSubmissionRetryAttemptsRef.current.set(clientRequestId, attempts);
        chatSubmissionNextRetryAtRef.current.set(
          clientRequestId,
          Date.now() + Math.min(30_000, 1500 * 2 ** Math.min(attempts, 5)),
        );
        setFailedChatSubmissions((current) => ({
          ...current,
          [clientRequestId]: {
            error: error instanceof Error ? error.message : "Could not send your message.",
            retryable,
            retrying: false,
          },
        }));
      }
      setSendError(error instanceof Error ? error.message : "Could not send your message.");
    } finally {
      setThinkingSteps([]);
      if (!jobAccepted) {
        directReplyProcessingRef.current = false;
        setIsSending(false);
      }
    }
  }

  useEffect(() => {
    const messageId = autoSendVoiceMessageIdRef.current;
    if (!messageId || isAttachmentUploadPending) return;
    const attachment = attachedMedia.find((item) => item.id === messageId);
    if (!attachment || attachment.isUploading) return;
    if (attachment.isBlocked) {
      autoSendVoiceMessageIdRef.current = null;
      setMessages((current) => current.filter((message) => message.id !== messageId));
      setSendError(attachment.uploadError ?? "The voice message could not be uploaded.");
      return;
    }
    if (!attachment.uploaded) return;
    autoSendVoiceMessageIdRef.current = null;
    void sendMessage(messageId);
  }, [attachedMedia, isAttachmentUploadPending]);

  async function handleAssistantRating(
    messageId: string,
    versionNumber: number,
    rating: AssistantRating,
  ) {
    const ratingKey = `${messageId}:${versionNumber}`;
    const previousRating = ratings[ratingKey] ?? null;
    const nextRating = previousRating === rating ? null : rating;
    setRatings((current) => {
      const updated = { ...current };
      if (nextRating) updated[ratingKey] = nextRating;
      else delete updated[ratingKey];
      return updated;
    });
    try {
      if (!authClient) throw new Error("The CheyaVerse account service is not configured.");
      const { saveAssistantRating } = await import("./lib/chat-data");
      await saveAssistantRating(authClient, messageId, versionNumber, nextRating);
      showActionToast(nextRating ? "Feedback saved." : "Feedback removed.");
    } catch (error) {
      setRatings((current) => {
        const updated = { ...current };
        if (previousRating) updated[ratingKey] = previousRating;
        else delete updated[ratingKey];
        return updated;
      });
      setSendError(error instanceof Error ? error.message : "Could not save feedback.");
    }
  }

  async function postAdminRelayAction(input: Record<string, unknown>): Promise<unknown> {
    if (!authClient) throw new Error("The CheyaVerse account service is not configured.");
    const {
      data: { session },
      error: sessionError,
    } = await authClient.auth.getSession();
    if (sessionError) throw new Error(`Could not verify your account session: ${sessionError.message}`);
    if (!session?.access_token) throw new Error("Sign in again before updating relay feedback.");
    const response = await fetch("/api/admin-relay-feedback", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "statusMessage" in payload &&
        typeof payload.statusMessage === "string"
          ? payload.statusMessage
          : `Could not update relay feedback (${response.status}).`;
      throw new Error(message);
    }
    if (typeof payload !== "object" || payload === null) {
      throw new Error("The relay feedback service returned an invalid response.");
    }
    return payload;
  }

  async function handleAdminRelayRating(
    adminMessageId: string,
    rating: AssistantRating,
  ) {
    const previousRating = adminRelayRatings[adminMessageId] ?? null;
    const nextRating = previousRating === rating ? null : rating;
    setAdminRelayRatings((current) => {
      const next = { ...current };
      if (nextRating) next[adminMessageId] = nextRating;
      else delete next[adminMessageId];
      return next;
    });
    try {
      await postAdminRelayAction({ action: "rate", adminMessageId, rating: nextRating });
      showActionToast(nextRating ? "Relay feedback saved" : "Relay feedback removed");
    } catch (error) {
      setAdminRelayRatings((current) => {
        const next = { ...current };
        if (previousRating) next[adminMessageId] = previousRating;
        else delete next[adminMessageId];
        return next;
      });
      setSendError(error instanceof Error ? error.message : "Could not save relay feedback.");
    }
  }

  async function regenerateAdminRelayMessage(adminMessageId: string) {
    if (regeneratingAdminRelayId) return;
    const client = authClient;
    if (!client) {
      setSendError("The CheyaVerse account service is not configured.");
      return;
    }
    setRegeneratingAdminRelayId(adminMessageId);
    setSendError("");
    try {
      const payload = await postAdminRelayAction({ action: "regenerate", adminMessageId });
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("regenerated" in payload) ||
        payload.regenerated !== true ||
        !("updatedCount" in payload) ||
        typeof payload.updatedCount !== "number" ||
        !("body" in payload) ||
        typeof payload.body !== "string"
      ) {
        throw new Error("The relay regeneration service returned an invalid response.");
      }
      const revisedBody = payload.body;
      const linkedMessageIds = messages
        .filter((message) => message.adminMessageId === adminMessageId)
        .map((message) => message.id);
      setMessages((current) =>
        current.map((message) =>
          message.adminMessageId === adminMessageId
            ? { ...message, text: revisedBody, versionNumber: message.versionNumber + 1 }
            : message,
        ),
      );
      try {
        const { loadMessageVersions } = await import("./lib/chat-data");
        const versions = await loadMessageVersions(client, linkedMessageIds);
        setMessageVersions((current) => ({ ...current, ...versions }));
        setSelectedMessageVersions((current) => ({
          ...current,
          ...Object.fromEntries(
            linkedMessageIds.map((messageId) => [
              messageId,
              Math.max(
                1,
                ...(versions[messageId] ?? []).map((version) => version.version_number),
              ),
            ]),
          ),
        }));
      } catch (refreshError) {
        setSendError(
          `The relay was updated, but its version history could not be refreshed: ${
            refreshError instanceof Error ? refreshError.message : "Unknown database error."
          }`,
        );
      }
      showActionToast("Admin relay regenerated");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not regenerate this admin relay.");
    } finally {
      setRegeneratingAdminRelayId(null);
    }
  }

  async function submitAssistantReport() {
    if (!reportTarget) return;
    const details = reportDetailsRef.current.trim();
    if (!details) {
      setReportError("Write a short description before sending a report.");
      return;
    }
    if (details.length > 2000) {
      setReportError("Feedback details cannot exceed 2000 characters.");
      return;
    }
    setIsSavingReport(true);
    setReportError("");
    try {
      if (reportTarget.adminMessageId) {
        await postAdminRelayAction({
          action: "report",
          adminMessageId: reportTarget.adminMessageId,
          details,
        });
        setReportTarget(null);
        reportDetailsRef.current = "";
        setReportError("");
        showActionToast("Relay feedback report saved");
        return;
      }
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
      showActionToast("Report submitted.");
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Could not save this report.");
    } finally {
      setIsSavingReport(false);
    }
  }

  async function copyMessageText(messageId: string, text: string) {
    setCopiedMessageId(messageId);
    showActionToast("Message copied.");
    try {
      await navigator.clipboard.writeText(text);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1800);
    } catch (error) {
      setCopiedMessageId((current) => (current === messageId ? null : current));
      showAttachmentToast(
        error instanceof Error ? `Could not copy this message: ${error.message}` : "Could not copy this message.",
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
      const removedMessages = messages.slice(targetIndex);
      const removedMessageIds = new Set(removedMessages.map((message) => message.id));
      const attachmentIds = [
        ...new Set(
          removedMessages
            .flatMap((message) => message.attachments ?? [])
            .map((attachment) => attachment.id),
        ),
      ];
      if (attachmentIds.length > 0) await deleteStoredAttachments(attachmentIds);

      closeTts();
      const deletion = await deleteChatWithGeminiSpeech(await getAccessToken(), {
        scope: "branch",
        messageId: targetId,
      });
      if (deletion.deletedMessageCount < 1) {
        throw new Error("The message branch was not found, so nothing was deleted.");
      }

      clearGeminiSpeechCache(deletion.messageIds);
      const removedIds = new Set([...removedMessageIds, ...deletion.messageIds]);
      const localDraftIds = new Set([...attachmentIds, ...removedMessageIds]);
      for (const attachmentId of attachmentIds) {
        const renderKey = voiceNoteRenderKeysRef.current.get(attachmentId);
        if (!renderKey?.startsWith("voice-note:")) continue;
        localDraftIds.add(renderKey.slice("voice-note:".length));
      }
      let draftCleanupError: unknown = null;
      if (authUser && localDraftIds.size > 0) {
        const cleanupResults = await Promise.allSettled(
          [...localDraftIds].map((id) => removeChatAttachmentDraft(authUser.id, id)),
        );
        draftCleanupError = cleanupResults.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        )?.reason;
      }
      for (const id of localDraftIds) {
        const previewUrl = localVoicePreviewUrlsRef.current.get(id);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        localVoicePreviewUrlsRef.current.delete(id);
        voiceNoteRenderKeysRef.current.delete(id);
      }
      for (const id of attachmentIds) voiceNoteRenderKeysRef.current.delete(id);
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
      if (draftCleanupError) {
        const message =
          draftCleanupError instanceof Error
            ? `The conversation was deleted, but a local attachment draft could not be removed: ${draftCleanupError.message}`
            : "The conversation was deleted, but a local attachment draft could not be removed.";
        setSendError(message);
        showAttachmentToast(message);
      } else {
        showActionToast("Message and following conversation deleted.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete this message branch.";
      setSendError(message);
      showAttachmentToast(message);
    } finally {
      setIsDeletingChatBranch(false);
    }
  }

  async function regenerateAssistantMessage(
    messageId: string,
    editedSource?: { text: string; versionNumber: number },
  ) {
    if (isSending && !editedSource) return;
    if (!authUser) {
      setSendError("Sign in before regenerating a response.");
      return;
    }
    const assistantIndex = messages.findIndex((item) => item.id === messageId);
    const sourceIndex = assistantIndex - 1;
    const previousMessages = messages;
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
    const previousAssistant = messages[assistantIndex];
    const previousAnswer = displayedMessageText(previousAssistant);
    const previousVersionNumber = displayedVersionNumber(previousAssistant);
    const previousVoiceNote = previousAssistant.attachments?.find((attachment) =>
      attachment.mime_type.startsWith("audio/"),
    );

    setIsSending(true);
    directReplyProcessingRef.current = true;
    followLatestRef.current = true;
    shouldScrollToLatestRef.current = true;
    setSendError("");
    pendingAssistantAnchorRef.current = sourceMessage.id;
    setTypingAssistant(null);
    messages
      .slice(assistantIndex + 1)
      .forEach((message) => hiddenChatMessageIdsRef.current.add(message.id));
    setMessages((current) => {
      const currentAssistantIndex = current.findIndex((item) => item.id === messageId);
      return currentAssistantIndex < 0 ? current : current.slice(0, currentAssistantIndex + 1);
    });
    const showThinking = thinkingModeRef.current;
    setThinkingSteps(["Checking the conversation and relevant context…"]);
    let responseSaved = false;
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
          loadMessageAttachments,
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
            .select("display_name, custom_prompt, chat_style, web_search_enabled, tts_api_key, tts_api_keys, tts_voice")
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
      let voiceNoteRequested = Boolean(previousVoiceNote);
      let includeVoiceNoteText = previousVoiceNote?.show_text ?? false;
      if (queryResult.status === "rejected") {
        console.warn(
          "Semantic retrieval was unavailable while regenerating a response.",
          queryResult.reason,
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
              undefined,
              sourceText,
            )
          : Promise.resolve({ messages: [], memories: [] }),
        targetCreatedAt
          ? loadRecentInsights(client, 12, sourceMessage.id, targetCreatedAt)
          : Promise.resolve([]),
      ]);
      if (contextResult.status === "rejected") {
        console.warn(
          "Related semantic context could not be loaded while regenerating a response.",
          contextResult.reason,
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
      setThinkingSteps(["Preparing the message and attachments for Cheya…"]);
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
      setThinkingSteps(["Preparing Cheya's response…"]);
      const sharedAttachmentIds = new Set<string>();

      const result = await generateGeminiConversation(
        keys,
        sourceText,
        startIndex,
        profile ?? DEFAULT_PERSONALIZATION,
        {
          accountRole: authUser?.role ?? "user",
          webSearchEnabled: profile?.web_search_enabled !== false,
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
          executeTool: async (name, input, key) => {
            if (name === "choose_voice_note") {
              voiceNoteRequested = true;
              if (
                typeof input === "object" &&
                input !== null &&
                "include_text" in input &&
                input.include_text === true
              ) {
                includeVoiceNoteText = true;
              }
              return { selected: true };
            }
            if (ACCOUNT_AI_ACTION_NAMES.has(name)) {
              if (!authClient) throw new Error("Sign in before using account AI actions.");
              const result = await executeAccountAiActionFromClient(
                authClient,
                name,
                input,
                sourceMessage.id,
              );
              if (name === "share_chat_attachment") {
                const attachmentId = getSharedAttachmentId(result);
                if (!attachmentId) {
                  throw new Error("The attachment share action returned an invalid reference.");
                }
                sharedAttachmentIds.add(attachmentId);
              }
              if (name === "prepare_admin_message" && isPreparedAdminMessageResult(result)) {
                const request = result.request;
                const requestToast = {
                  id: request.id,
                  title: request.title,
                  body: request.body,
                };
                setAdminApprovalToast(requestToast);
                setPendingAdminRequests((current) =>
                  current.some((request) => request.id === requestToast.id)
                    ? current
                    : [
                        {
                          id: requestToast.id,
                          admin_user_id: authUser?.id ?? "",
                          recipient_user_ids: request.recipient_user_ids,
                          all_accounts: request.all_accounts,
                          title: requestToast.title,
                          body: requestToast.body,
                          status: "pending",
                          created_at: new Date().toISOString(),
                          sent_at: null,
                        },
                        ...current,
                      ],
                );
                setInboxRefresh((current) => current + 1);
              }
              return result;
            }
            if (name === "search_web") {
              if (!generalSettings.web_search_enabled) {
                throw new Error("Web search is disabled in General settings.");
              }
              const query =
                typeof input === "object" &&
                input !== null &&
                "query" in input &&
                typeof input.query === "string"
                  ? input.query
                  : "";
              if (!query.trim()) throw new Error("The search query was empty.");
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
                setThinkingSteps(["Reviewing search results…"]);
                return payload;
              });
            }
            return executeChatDataTool(
              client,
              key.api_key,
              name,
              input,
              requestDeleteConfirmation,
              authUser.id,
              sourceMessage.id,
              async (id) => deleteStoredAttachments([id]),
            );
          },
        },
      );
      setThinkingSteps(["Saving Cheya's response…"]);
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
        console.warn(
          "Semantic search could not be updated after regenerating a response.",
          error,
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
        undefined,
        {
          id: sourceMessage.id,
          versionNumber: editedSource?.versionNumber ?? displayedVersionNumber(sourceMessage),
        },
      );
      if (!updatedMessage) throw new Error("This reply could not be found in the database.");
      responseSaved = true;
      hiddenChatMessageIdsRef.current.delete(messageId);
      let linkedAttachments = previousAssistant.attachments ?? [];
      if (voiceNoteRequested) {
        let registeredVoiceNoteId: string | null = null;
        let voiceNoteLinked = false;
        try {
          const configuredTtsKeys = Array.isArray(profile?.tts_api_keys)
            ? profile.tts_api_keys.filter(
                (key): key is string => typeof key === "string" && Boolean(key.trim()),
              )
            : [];
          const ttsKeys = configuredTtsKeys.length
            ? configuredTtsKeys
            : profile?.tts_api_key?.trim()
              ? [profile.tts_api_key]
              : [];
          if (ttsKeys.length === 0) {
            throw new Error("No Gemini TTS API key is configured in the user's settings.");
          }
          const voice = profile?.tts_voice && isGeminiTtsVoice(profile.tts_voice)
            ? profile.tts_voice
            : DEFAULT_GEMINI_TTS_VOICE;
          const audio = await generateGeminiSpeech(
            ttsKeys,
            speechTextFromMarkdown(result.text),
            voice,
          );
          if (audio.size > MAX_CHAT_ATTACHMENT_BYTES) {
            throw new Error("Generated voice note exceeds the 18 MB storage limit.");
          }
          const mimeType = audio.type.startsWith("audio/") ? audio.type : "audio/wav";
          const extension = mimeType === "audio/mpeg" ? "mp3" : "wav";
          const attachmentId = crypto.randomUUID();
          const registration = await registerChatAttachment({
            id: attachmentId,
            file: new File([audio], `cheya-voice-note.${extension}`, { type: mimeType }),
            mimeType,
            isUploading: false,
            isBlocked: false,
            uploadError: null,
            uploaded: null,
          });
          if (!registration.attachment) {
            throw new Error("The voice-note upload did not return attachment metadata.");
          }
          const generatedVoiceNoteId = registration.attachment.id;
          registeredVoiceNoteId = generatedVoiceNoteId;
          await linkChatAttachmentsFromClient(
            client,
            updatedMessage.id,
            [generatedVoiceNoteId],
            registration.reused && registration.attachment.message_id !== null
              ? undefined
              : includeVoiceNoteText,
          );
          voiceNoteLinked = true;
          const loadedAttachments = await loadMessageAttachments(client, [updatedMessage.id]);
          linkedAttachments = loadedAttachments[updatedMessage.id] ?? linkedAttachments;
          const replacedVoiceIds =
            previousAssistant.attachments
              ?.filter((attachment) => attachment.mime_type.startsWith("audio/"))
              .filter((attachment) => attachment.id !== generatedVoiceNoteId)
              .map((attachment) => attachment.id) ?? [];
          if (replacedVoiceIds.length > 0) {
            try {
              await deleteStoredAttachments(replacedVoiceIds);
              linkedAttachments = linkedAttachments.filter(
                (attachment) => !replacedVoiceIds.includes(attachment.id),
              );
            } catch (error) {
              regenerationWarnings.push(
                `The new voice note was saved, but the previous voice note could not be removed: ${
                  error instanceof Error ? error.message : "Unknown cleanup error."
                }`,
              );
            }
            linkedAttachments = linkedAttachments.filter(
              (attachment) => !replacedVoiceIds.includes(attachment.id),
            );
          }
        } catch (error) {
          if (registeredVoiceNoteId && !voiceNoteLinked) {
            try {
              await deleteStoredAttachments([registeredVoiceNoteId]);
            } catch (cleanupError) {
              regenerationWarnings.push(
                `The reply was regenerated, but an unlinked voice-note upload could not be cleaned up: ${
                  cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error."
                }`,
              );
            }
          }
          regenerationWarnings.push(
            `The reply was regenerated, but its voice note could not be created: ${
              error instanceof Error ? error.message : "Unknown voice-note error."
            }`,
          );
        }
      }
      if (sharedAttachmentIds.size > 0) {
        try {
          await linkChatAttachmentsFromClient(client, updatedMessage.id, [...sharedAttachmentIds]);
          const loadedAttachments = await loadMessageAttachments(client, [updatedMessage.id]);
          linkedAttachments = loadedAttachments[updatedMessage.id] ?? linkedAttachments;
        } catch (error) {
          regenerationWarnings.push(
            `Reply was regenerated, but its shared files could not be attached: ${
              error instanceof Error ? error.message : "Unknown database error."
            }`,
          );
        }
      }

      try {
        await saveChatBranch(
          client,
          editedSource ? sourceMessage.id : updatedMessage.id,
          editedSource?.versionNumber ?? updatedMessage.version_number,
          undefined,
          editedSource ? { [updatedMessage.id]: updatedMessage.version_number } : {},
        );
      } catch (error) {
        regenerationWarnings.push(
          `Reply was regenerated, but its conversation branch could not be preserved: ${
            error instanceof Error ? error.message : "Unknown database error."
          }`,
        );
      }

      setMessages((current) => {
        const sourceIndex = current.findIndex((item) => item.id === sourceMessage.id);
        const retained = sourceIndex >= 0 ? current.slice(0, sourceIndex + 1) : current;
        return [
          ...retained,
          {
            ...previousAssistant,
            text: updatedMessage.content,
            createdAt: updatedMessage.created_at,
            versionNumber: updatedMessage.version_number,
            thinkingSummary: updatedMessage.thinking_summary,
            attachments: linkedAttachments,
          },
        ];
      });
      const updatedVersions = await loadMessageVersions(client, [messageId]);
      setMessageVersions((current) => ({ ...current, ...updatedVersions }));
      setSelectedMessageVersions((current) => ({
        ...current,
        [messageId]: updatedMessage.version_number,
      }));
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
      showActionToast("Response regenerated.");
      if (regenerationWarnings.length > 0) {
        setSendError(regenerationWarnings.join("\n"));
      }
    } catch (error) {
      try {
        if (!authClient) throw new Error("Sign in again before saving this AI error.");
        const failureDetails =
          error instanceof Error
            ? `${error.name}: ${error.message}\n\n${
                error.stack?.split("\n").slice(1).join("\n") ?? "Stack trace unavailable."
              }`
            : "Unknown error while regenerating the response.";
        await reportAiFailureFromClient(
          authClient,
          failureDetails.slice(0, 10000),
        );
      } catch (inboxError) {
        setSendError(
          inboxError instanceof Error
            ? `Cheya could not reply, and the error could not be saved to your inbox: ${inboxError.message}`
            : "Cheya could not reply, and the error could not be saved to your inbox.",
        );
      }
      pendingAssistantAnchorRef.current = null;
      if (!responseSaved) {
        if (editedSource) {
          hiddenChatMessageIdsRef.current.add(messageId);
        } else {
          previousMessages.forEach((message) => hiddenChatMessageIdsRef.current.delete(message.id));
          setMessages(previousMessages);
        }
      }
    } finally {
      setThinkingSteps([]);
      directReplyProcessingRef.current = false;
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
    const previousMessages = messages;
    const originalMessage = messages[messageIndex];
    if (!originalMessage || originalMessage.role !== "user") {
      setSendError("Could not find the user message to edit.");
      return;
    }

    setIsSending(true);
    directReplyProcessingRef.current = true;
    followLatestRef.current = true;
    shouldScrollToLatestRef.current = true;
    setSendError("");
    setThinkingSteps(["Saving the edit and preparing a new reply…"]);
    let editSaved = false;
    messages
      .slice(messageIndex + 1)
      .forEach((message) => hiddenChatMessageIdsRef.current.add(message.id));
    try {
      const [
        { createSupabaseClient, ensureSupabaseSession, loadDatabaseConfig },
        { createEmbedding, loadMessageVersions, updateChatMessage },
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
      editSaved = true;
      setMessages([
        ...previousMessages.slice(0, messageIndex),
        {
          ...originalMessage,
          text: updatedMessage.content,
          createdAt: updatedMessage.created_at,
          versionNumber: updatedMessage.version_number,
          thinkingSummary: null,
        },
      ]);
      const versions = await loadMessageVersions(client, [userEditTarget]);
      setMessageVersions((current) => ({ ...current, ...versions }));
      setSelectedMessageVersions((current) => ({
        ...current,
        [userEditTarget]: updatedMessage.version_number,
      }));
      closeUserMessageEditor();
      userEditTextRef.current = "";
      setActiveUserActions(null);
      showActionToast("Message updated.");
      const nextAssistant = messages[messageIndex + 1];
      if (nextAssistant?.role === "assistant") {
        await regenerateAssistantMessage(nextAssistant.id, {
          text: updatedMessage.content,
          versionNumber: updatedMessage.version_number,
        });
      }
    } catch (error) {
      if (!editSaved) {
        messages
          .slice(messageIndex + 1)
          .forEach((message) => hiddenChatMessageIdsRef.current.delete(message.id));
      }
      const message = error instanceof Error ? error.message : "Could not edit this message.";
      setSendError(message);
      showAttachmentToast(message);
    } finally {
      directReplyProcessingRef.current = false;
      setIsSending(false);
    }
  }

  if (
    pathname !== "/" &&
    pathname !== "/privacy" &&
    pathname !== "/terms" &&
    !/^\/settings(?:\/(?:general|personal|configure|memory|messages|changelogs|account|privacy|terms))?\/?$/.test(pathname)
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

  if (pathname === "/privacy" || pathname === "/terms") {
    return (
      <LegalPage
        kind={pathname === "/privacy" ? "privacy" : "terms"}
        {...(authClient && authUser
          ? {
              reporter: {
                client: authClient,
                accountUserId: authUser.id,
                accountEmail: authUser.email,
                accountProvider: authUser.provider,
                githubUsername: authUser.githubUsername,
                accountRole: authUser.role,
              },
            }
          : {})}
      />
    );
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
        code=""
        title="Could not connect your account"
        description="CheyaAPP could not restore the account session. Check the connection and try again."
        details={authError}
        onHome={() => window.location.assign("/")}
        onRetry={() => window.location.reload()}
        showIcon={false}
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
          accountProvider={authUser.provider}
          githubUsername={authUser.githubUsername}
          accountRole={authUser.role}
          onGeminiKeyChange={setHasGeminiApiKey}
          onGeneralSettingsChange={setGeneralSettings}
        />
      </Suspense>
    );
  }

  if (pathname === "/" && isLoadingHistory) {
    return <PageLoadingSkeleton pathname={pathname} />;
  }

  const viewedAttachment = attachmentView ? attachedMedia[attachmentView.index] : undefined;
  const viewedFile = viewedAttachment?.file;
  const editorLines = editorContent.split(/\r\n|\r|\n/);
  const longestEditorLine = editorLines.reduce((longest, line) => Math.max(longest, line.length), 0);
  const selectedUserMessage = activeUserActions
    ? messages.find((message) => message.id === activeUserActions && message.role === "user")
    : undefined;
  const selectedUserMessageText = selectedUserMessage
    ? displayedMessageText(selectedUserMessage)
    : "";
  const selectedUserMessageIsVoiceNote =
    selectedUserMessage ? isVoiceNoteMessage(selectedUserMessage) : false;
  const selectedUserMessageAudio = selectedUserMessage?.attachments?.find((attachment) =>
    attachment.mime_type.startsWith("audio/"),
  );
  if (attachmentView && viewedFile && viewedAttachment) {
    const previewUrl = mediaPreviews.get(viewedFile) ?? mediaPreviewUrlsRef.current.get(viewedFile);
    const isMediaView =
      viewedAttachment.mimeType.startsWith("image/") ||
      viewedAttachment.mimeType.startsWith("video/");
    if (isMediaView) {
      if (
        attachmentView.mode === "crop" &&
        viewedAttachment.mimeType.startsWith("image/") &&
        previewUrl
      ) {
        return (
          <ImageCropper
            src={previewUrl}
            file={viewedFile}
            onCancel={() =>
              setAttachmentView({ index: attachmentView.index, mode: "media" })
            }
            onApply={commitImageCrop}
          />
        );
      }
      return previewUrl ? (
        <MediaPreview
          src={previewUrl}
          fileName={viewedFile.name}
          fileSize={viewedFile.size}
          isVideo={viewedAttachment.mimeType.startsWith("video/")}
          onCrop={
            viewedAttachment.mimeType.startsWith("image/") && !viewedAttachment.isUploading
              ? () => setAttachmentView({ index: attachmentView.index, mode: "crop" })
              : undefined
          }
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

  const pendingAssistantResponseId =
    pendingAssistantAnchorIndex >= 0
      ? messages
          .slice(pendingAssistantAnchorIndex + 1)
          .find((message) => message.role === "assistant")?.id
      : undefined;

  return (
    <main
      className="fixed inset-0 flex justify-center bg-[#f5f6f8] p-0"
    >
      <section
        aria-label="CheyaAPP chat"
        className="relative flex h-full w-full max-w-[480px] flex-col overflow-hidden bg-[#f5f6f8]"
        onPointerDownCapture={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(
              "[data-header-panel-dismissible], [data-tts-warning-panel]",
            )
          ) {
            return;
          }
          setNotificationsOpen(false);
          setAdminApprovalToast(null);
          setIsTtsErrorExpanded(false);
        }}
        onScrollCapture={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(
              "[data-header-panel-dismissible], [data-tts-warning-panel]",
            )
          ) {
            return;
          }
          setNotificationsOpen(false);
          setAdminApprovalToast(null);
          setIsTtsErrorExpanded(false);
        }}
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
        <header className="absolute inset-x-0 top-0 z-20 flex h-[64px] select-none items-center justify-between gap-2 bg-transparent px-2 py-1">
          <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-[#e8e9ec] bg-white py-1 pl-1 pr-2">
            <img
              src={cheyaLogo}
              alt="CheyaAPP logo"
              className="pointer-events-none size-10 shrink-0 rounded-full object-cover select-none"
              draggable={false}
            />
            <div className="pointer-events-none flex min-w-0 flex-col justify-center select-none">
              <div className="flex items-center gap-0.5">
                <h1 className="truncate text-base font-semibold leading-5 text-[#17181b]">
                  CheyaAPP
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
              aria-expanded={notificationsOpen}
              onClick={() => {
                setInboxError("");
                setNotificationsOpen((open) => !open);
              }}
              className="relative ml-auto flex size-9 shrink-0 items-center justify-center rounded-full text-[#303238] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
            >
              <Bell aria-hidden="true" className="size-5" strokeWidth={1.8} />
              {unreadInboxCount > 0 && (
                <span className="absolute right-0 top-0 flex size-[15px] items-center justify-center rounded-full bg-[#d84646] text-[8px] font-semibold leading-none text-white ring-2 ring-white">
                  {unreadInboxCount > 9 ? "9+" : unreadInboxCount}
                </span>
              )}
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
                  else setIsBugReportOpen(true);
                }}
                className="flex size-9 items-center justify-center rounded-full text-[#303238] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
              >
                <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
              </button>
            ))}
          </nav>
        </header>

        <div
          className="pointer-events-none absolute inset-x-3 top-[64px] z-50 flex max-h-[calc(100dvh-80px)] flex-col gap-1.5 overflow-y-auto"
        >
        {authUser?.role === "admin" && adminApprovalToast && (
          <section
            role="status"
            aria-label="AI message awaiting approval"
            data-header-panel-interactive
            data-header-panel-dismissible
            className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-[#e8d7b1] bg-[#fffaf0] px-3 py-2.5 shadow-lg"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f5e8ca] text-[#8d6418]">
              <BadgeCheck aria-hidden="true" className="size-[17px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[#503d1b]">AI draft needs your approval</p>
              <p className="truncate text-[11px] text-[#746446]">{adminApprovalToast.title}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setAdminApprovalToast(null);
                setNotificationsOpen(true);
              }}
              className="h-8 shrink-0 rounded-lg bg-[#302b22] px-2.5 text-xs font-medium text-white hover:bg-[#494132]"
            >
              Review
            </button>
            <button
              type="button"
              aria-label="Dismiss approval notification"
              onClick={() => setAdminApprovalToast(null)}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-[#746446] hover:bg-[#f5e8ca]"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </section>
        )}
        {notificationsOpen && (
          <div
            role="dialog"
            aria-label="Notification inbox"
            data-header-panel-dismissible
            className="chat-quick-panel pointer-events-auto flex max-h-[min(54vh,420px)] shrink-0 flex-col overflow-hidden rounded-2xl border border-[#e1e3e8] bg-white shadow-xl"
          >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[#eceef1] px-3 py-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <h2 className="text-sm font-semibold text-[#202126]">Inbox</h2>
                {(authUser?.role !== "admin" || unreadInboxMessageCount > 0 || pendingAdminRequests.length > 0) && (
                  <span className="truncate text-[11px] text-[#858890]">
                    {unreadInboxMessageCount > 0 || authUser?.role !== "admin"
                      ? `${unreadInboxMessageCount} unread`
                      : ""}
                    {authUser?.role === "admin" && pendingAdminRequests.length > 0
                      ? `${unreadInboxMessageCount > 0 ? " · " : ""}${pendingAdminRequests.length} approval${pendingAdminRequests.length === 1 ? "" : "s"}`
                      : ""}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  aria-label="Mark all notifications as read"
                  title={isMarkingInboxRead ? "Marking all as read" : "Mark all as read"}
                  disabled={isMarkingInboxRead || unreadInboxMessageCount === 0}
                  onClick={() => void markAllInboxItemsRead()}
                  className="flex size-7 items-center justify-center rounded-lg text-[#6c727c] transition hover:bg-[#eff8fc] hover:text-[#287ba3] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#229fe3] disabled:cursor-not-allowed disabled:text-[#c1c3c8]"
                >
                  {isMarkingInboxRead ? (
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <CheckCheck aria-hidden="true" className="size-[17px]" strokeWidth={1.8} />
                  )}
                </button>
                <button
                  type="button"
                  aria-label="Clear notification inbox"
                  title={isClearingInbox ? "Clearing inbox" : "Clear inbox"}
                  disabled={isClearingInbox || inboxItems.length === 0}
                  onClick={() => void clearNotificationInbox()}
                  className="flex size-7 items-center justify-center rounded-lg text-[#7b7373] transition hover:bg-red-50 hover:text-[#b43b3b] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#d84646] disabled:cursor-not-allowed disabled:text-[#c8c3c3]"
                >
                  {isClearingInbox ? (
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.8} />
                  )}
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#f7f8fa] p-2.5">
              {inboxError && (
                <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-800">
                  {inboxError}
                </p>
              )}
              {authUser?.role === "admin" && pendingAdminRequests.length > 0 && (
                <section aria-label="AI message approvals" className="space-y-2">
                  <div className="flex items-center justify-between px-1 pt-1">
                    <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#805d1b]">
                      AI message approvals
                    </h3>
                    <span className="rounded-full bg-[#f5e8ca] px-2 py-0.5 text-[10px] font-semibold text-[#805d1b]">
                      {pendingAdminRequests.length} pending
                    </span>
                  </div>
                  {pendingAdminRequests.map((request) => (
                    <article
                      key={request.id}
                      className="rounded-2xl border border-[#eadbbd] bg-[#fffdf8] p-3 shadow-[0_1px_2px_rgba(75,55,20,0.05)]"
                    >
                      <div className="mb-2 flex items-center gap-1.5">
                        <BadgeCheck aria-hidden="true" className="size-3.5 shrink-0 text-[#9a7125]" />
                        <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#896926]">
                          Requires your approval
                        </span>
                      </div>
                      <p className="text-[13px] font-semibold text-[#30291e]">{request.title}</p>
                      <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-[1.55] text-[#625a4c]">
                        {request.body}
                      </p>
                      <p className="mt-2.5 text-[10px] text-[#85785f]">
                        {request.all_accounts
                          ? "Broadcast · all accounts except you"
                          : `Selected audience · ${request.recipient_user_ids.length} account${request.recipient_user_ids.length === 1 ? "" : "s"}`}
                      </p>
                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#f0e6d2] pt-2.5">
                        <time className="text-[10px] tabular-nums text-[#94876e]">
                          {formatAccountDate(request.created_at, generalSettings.time_format)}
                        </time>
                        <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={activeApprovalRequestId !== null}
                          onClick={() => void resolveAdminMessageRequest(request.id, false)}
                          className="h-8 rounded-lg border border-[#e1e3e8] px-2.5 text-xs font-medium text-[#55575e] hover:bg-[#f7f8fa] disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={activeApprovalRequestId !== null}
                          onClick={() => void resolveAdminMessageRequest(request.id, true)}
                          className="h-8 rounded-lg bg-[#26272c] px-2.5 text-xs font-medium text-white hover:bg-[#3a3b41] disabled:opacity-50"
                        >
                          {activeApprovalRequestId === request.id ? "Sending…" : "Approve and send"}
                        </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </section>
              )}
              {isLoadingInbox ? (
                <div role="status" className="space-y-2">
                  <div className="h-16 animate-pulse rounded-xl bg-[#eceef1]" />
                  <div className="h-16 animate-pulse rounded-xl bg-[#eceef1]" />
                </div>
              ) : inboxItems.length > 0 ? (
                <section aria-label="Notifications" className="space-y-2">
                  {inboxItems.map((item) => (
                    <article
                      key={item.id}
                      className={`w-full overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgba(20,25,35,0.04)] transition ${
                        item.read_at
                          ? "border-[#e8e9ed] bg-white"
                          : "border-[#d8e7ef] bg-[#f3faff]"
                      }`}
                    >
                      <button
                        type="button"
                        aria-expanded={expandedInboxIds.has(item.id)}
                        onClick={() => {
                          setExpandedInboxIds((ids) => {
                            const next = new Set(ids);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          });
                          void markInboxItemRead(item);
                        }}
                        className="w-full px-3 py-3 text-left transition hover:bg-black/[0.015] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#229fe3]"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            {!item.read_at && (
                              <span
                                aria-label="Unread"
                                className="size-1.5 shrink-0 rounded-full bg-[#229fe3]"
                              />
                            )}
                            <span className="truncate text-[13px] font-semibold text-[#292a30]">
                              {item.title}
                            </span>
                          </span>
                          <time className="shrink-0 text-[10px] tabular-nums text-[#92959c]">
                            {formatAccountDate(item.created_at, generalSettings.time_format)}
                          </time>
                        </span>
                        {!expandedInboxIds.has(item.id) && (
                          <span className="mt-1 block line-clamp-2 break-words text-xs leading-[1.55] text-[#62656d]">
                            {item.body}
                          </span>
                        )}
                      </button>
                      {expandedInboxIds.has(item.id) && (
                        <div className="mx-3 mb-3 max-h-24 max-w-full overflow-auto border-t border-[#e8e9ed] pt-2">
                          <pre className="w-max min-w-full whitespace-pre font-mono text-[11px] leading-[1.65] text-[#555a63]">
                            {item.body}
                          </pre>
                        </div>
                      )}
                    </article>
                  ))}
                </section>
              ) : (
                !isLoadingInbox && (
                  <p className="rounded-xl border border-dashed border-[#dfe1e5] px-3 py-5 text-center text-xs text-[#858890]">
                    Your inbox is empty.
                  </p>
                )
              )}
            </div>
          </div>
        )}

        {showPushBanner && (
          <section
            aria-label="Push notification permission"
            data-header-panel-interactive
            className="pointer-events-auto flex h-12 shrink-0 items-center gap-2 overflow-hidden rounded-2xl border border-[#e6e7eb] bg-white px-2 shadow-sm"
          >
            <Bell aria-hidden="true" className="ml-1 size-4 shrink-0 text-[#596879]" />
            <p
              title={
                pushBannerError ||
                (pushStatus === "denied"
                  ? "Notifications are blocked. Allow them in your browser or device settings."
                  : "Enable notifications to receive messages and reminders on this device.")
              }
              className={`min-w-0 flex-1 truncate text-xs leading-5 ${
                pushBannerError ? "text-red-700" : "text-[#55575e]"
              }`}
            >
              {pushBannerError ||
                (pushStatus === "denied"
                  ? "Notifications are blocked. Allow them in your browser or device settings."
                  : "Enable notifications to receive messages and reminders on this device.")}
            </p>
            {pushStatus !== "denied" && (
              <button
                type="button"
                disabled={isEnablingPush}
                onClick={() => void enablePushNotifications()}
                className="h-8 shrink-0 whitespace-nowrap rounded-lg bg-[#26272c] px-3 text-xs font-medium text-white hover:bg-[#3a3b41] disabled:opacity-60"
              >
                {isEnablingPush ? "Enabling…" : "Enable"}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss notification panel"
              onClick={() => setIsPushPanelDismissed(true)}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[#858890] transition hover:bg-[#f1f2f4] hover:text-[#34363b]"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </section>
        )}

        {ttsPlayback && (
          <div className="pointer-events-auto shrink-0">
            <section
              aria-label="Text-to-speech player"
              data-header-panel-interactive
              className="flex min-h-12 items-center gap-0 rounded-2xl border border-[#e6e7eb] bg-white px-1.5 py-1.5 shadow-sm"
            >
              {ttsPlayback.status === "loading" || ttsPlayback.status === "ready" ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="ml-1 mr-2 size-4 shrink-0 animate-spin text-[#656871]"
                  />
                  <p role="status" className="min-w-0 flex-1 text-xs text-[#656871]">
                    {ttsPlayback.status === "ready" ? "Starting speech…" : "Preparing speech…"}
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
                      className="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-full text-amber-700 transition-colors hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
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
          </div>
        )}
        {ttsPlayback && isTtsErrorExpanded && ttsPlayback.errorDetails && (
          <div
            data-tts-warning-panel
            className="pointer-events-auto relative shrink-0"
          >
            <button
              type="button"
              aria-label={isTtsWarningCopied ? "Speech warning copied" : "Copy speech warning"}
              title={isTtsWarningCopied ? "Copied" : "Copy warning"}
              onClick={() => void copyTtsWarning(ttsPlayback.errorDetails ?? "")}
              className="absolute right-3 top-1.5 z-10 flex size-7 items-center justify-center rounded-md border border-[#e6e7eb] bg-white text-[#55575e] shadow-sm transition hover:bg-[#f1f2f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
            >
              {isTtsWarningCopied ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Copy aria-hidden="true" className="size-4" />
              )}
            </button>
            <div
              role="alert"
              className="chat-quick-panel max-h-40 overflow-auto overscroll-contain rounded-2xl border border-[#e6e7eb] bg-white px-3 py-2.5 pr-11 text-xs leading-5 text-[#55504a] shadow-sm"
            >
              <pre className="w-max min-w-full whitespace-pre font-sans">
                {ttsPlayback.errorDetails}
              </pre>
            </div>
          </div>
        )}
        </div>

        <div
          ref={conversationRef}
          aria-label="Conversation"
          aria-live="polite"
          onScroll={handleConversationScroll}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#f5f6f8] px-3 pt-[64px]"
        >
          <div className="space-y-0.5 sm:space-y-1">
            {messages.map((chatMessage) => {
              if (isSending && pendingAssistantResponseId === chatMessage.id) return null;
              const versionNumber = displayedVersionNumber(chatMessage);
              const versions = messageVersionsForDisplay(chatMessage);
              const versionIndex = versions.findIndex(
                (item) => item.version_number === versionNumber,
              );
              const visibleText = displayedMessageText(chatMessage);
              const isVoiceNote = isVoiceNoteMessage(chatMessage);
              const showAssistantText =
                chatMessage.role !== "assistant" ||
                !chatMessage.attachments?.some(
                  (attachment) =>
                    attachment.mime_type.startsWith("audio/") &&
                    attachment.show_text === false,
                );
              const isVoiceNoteUploading =
                isVoiceNote && autoSendVoiceMessageIdRef.current === chatMessage.id;
              const visibleThinkingSummary = displayedThinkingSummary(chatMessage);
              const failedSubmission = failedChatSubmissions[chatMessage.id];
              const animateAssistant =
                (typingAssistant?.id === chatMessage.id &&
                  typingAssistant.content === visibleText) ||
                pendingAssistantResponseId === chatMessage.id;
              const ratingKey = `${chatMessage.id}:${versionNumber}`;
              const versionLabel =
                chatMessage.role === "user" ? "user message" : "assistant response";
              const versionControls = versions.length > 1 ? (
                <div className="flex items-center gap-0.5 text-[11px] text-[#777a82]">
                  <button
                    type="button"
                    aria-label={`Show previous ${versionLabel} version`}
                    disabled={isSending || isRestoringMessageVersion || versionIndex <= 0}
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
                      isRestoringMessageVersion ||
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
                const voiceAttachmentId = isVoiceNote
                  ? chatMessage.attachments?.find((attachment) =>
                      attachment.mime_type.startsWith("audio/"),
                    )?.id
                  : null;
                return (
                  <article
                    data-chat-message
                    {...(isVoiceNote ? { "data-voice-note-message": "" } : {})}
                    {...(visibleText.trim() && !isVoiceNote
                      ? { "data-has-visible-text": "" }
                      : {})}
                    key={
                      voiceAttachmentId
                        ? voiceNoteRenderKeysRef.current.get(voiceAttachmentId) ??
                          `voice-note:${voiceAttachmentId}`
                        : chatMessage.id
                    }
                    className={`${
                      isVoiceNote ? "voice-message-action-group" : "user-message-action-group"
                    } relative flex w-full flex-col items-end`}
                  >
                    {chatMessage.attachments && chatMessage.attachments.length > 0 && (
                      <div
                        aria-label="Message attachments"
                        dir="rtl"
                        className={`${
                          chatMessage.attachments.some((attachment) =>
                            attachment.mime_type.startsWith("audio/"),
                          )
                            ? "mb-0 grid-cols-1"
                            : "mb-2 grid-cols-3"
                        } grid w-fit max-w-[min(94%,320px)] gap-2`}
                        onPointerDown={(event) => {
                          if (!isVoiceNote || isSending || event.pointerType !== "touch") return;
                          clearLongPressTimer();
                          longPressTriggeredRef.current = false;
                          longPressStartRef.current = { x: event.clientX, y: event.clientY };
                          longPressTimerRef.current = setTimeout(() => {
                            longPressTriggeredRef.current = true;
                            setActiveUserActions(chatMessage.id);
                            longPressTimerRef.current = null;
                          }, 200);
                        }}
                        onPointerMove={(event) => {
                          const start = longPressStartRef.current;
                          if (
                            isVoiceNote &&
                            event.pointerType === "touch" &&
                            start &&
                            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
                          ) {
                            clearLongPressTimer();
                            longPressStartRef.current = null;
                          }
                        }}
                        onPointerUp={() => {
                          if (!isVoiceNote) return;
                          clearLongPressTimer();
                          longPressStartRef.current = null;
                        }}
                        onPointerCancel={() => {
                          if (!isVoiceNote) return;
                          clearLongPressTimer();
                          longPressStartRef.current = null;
                        }}
                        onClickCapture={(event) => {
                          if (!longPressTriggeredRef.current) return;
                          event.preventDefault();
                          event.stopPropagation();
                          longPressTriggeredRef.current = false;
                        }}
                        onContextMenu={(event) => {
                          if (!isVoiceNote) return;
                          event.preventDefault();
                          if (isSending) return;
                          setActiveUserActions(chatMessage.id);
                        }}
                      >
                        {chatMessage.attachments.map((attachment) => (
                          <ChatMessageAttachmentTile
                            key={attachment.id}
                            attachment={attachment}
                            expired={isChatAttachmentExpired(attachment)}
                            isProcessing={isVoiceNoteUploading}
                            getPreviewUrl={getAttachmentPreviewUrl}
                            onOpen={(item) => void openStoredAttachment(item)}
                          />
                        ))}
                      </div>
                    )}
                    <div
                      className={`${
                        isVoiceNote ? "" : "user-message-action-group"
                      } ${isVoiceNote ? "" : "relative"} flex w-full max-w-full flex-col items-end`}
                    >
                    <div
                      className={`user-message-content ${
                        failedSubmission
                          ? "grid w-full grid-cols-[auto_minmax(0,1fr)] items-end gap-2"
                          : "flex w-full items-end justify-end"
                      }`}
                    >
                      {failedSubmission && (
                        <button
                          type="button"
                          aria-label="Retry sending this message"
                          title={failedSubmission.error}
                          disabled={failedSubmission.retrying || isSending}
                          onClick={() => void retryChatSubmission(chatMessage.id)}
                          className="mb-1 flex size-8 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#555963] shadow-sm transition-none hover:bg-[#f7f8fa] disabled:opacity-50"
                        >
                          {failedSubmission.retrying ? (
                            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                          ) : (
                            <RotateCw aria-hidden="true" className="size-4" />
                          )}
                        </button>
                      )}
                      {!isVoiceNote && <div
                        onPointerDown={(event) => {
                        if (isSending || event.pointerType !== "touch") return;
                        clearLongPressTimer();
                        longPressStartRef.current = { x: event.clientX, y: event.clientY };
                        longPressTimerRef.current = setTimeout(
                          () => {
                            if (isSending) return;
                            setActiveUserActions(chatMessage.id);
                            longPressTimerRef.current = null;
                          },
                          200,
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
                      if (isSending) return;
                      setActiveUserActions(chatMessage.id);
                      }}
                      onDragStart={(event) => event.preventDefault()}
                      className="user-message-bubble w-auto min-w-0 max-w-[94%] select-none rounded-[18px] rounded-br-md bg-[#28292e] px-3.5 py-1.5 text-[13px] leading-[1.35] text-white [webkit-touch-callout:none]"
                      style={{
                        WebkitTouchCallout: "none",
                        fontSize: Math.round(13 * chatFontScale),
                        lineHeight: 1.35,
                      }}
                    >
                      <Suspense fallback={null}>
                        <AssistantMarkdown content={visibleText} userMessage />
                      </Suspense>
                      <LinkPreviews
                        content={visibleText}
                        client={authClient}
                        userMessage
                      />
                      </div>}
                    </div>
                    {!isSending && <div
                      data-user-actions
                      aria-label="User message actions"
                      className={`user-message-actions absolute right-0 ${
                        isVoiceNote ? "top-[calc(100%-16px)]" : "top-[calc(100%-8px)]"
                      } z-10 mt-0 hidden h-4 w-full items-center justify-end gap-0.5 overflow-visible sm:flex`}
                    >
                      {!isVoiceNote && <button
                        type="button"
                        aria-label="Copy user message"
                        onClick={(event) => {
                          event.currentTarget.blur();
                          void copyMessageText(chatMessage.id, visibleText);
                        }}
                        className="flex size-4 items-center justify-center rounded-full bg-white/90 text-[#777a82] opacity-0 pointer-events-none transition-none hover:bg-[#f1f2f4] hover:text-[#34363b]"
                      >
                        {copiedMessageId === chatMessage.id ? (
                          <Check aria-hidden="true" className="size-3 text-[#398650]" />
                        ) : (
                          <Copy aria-hidden="true" className="size-3" />
                        )}
                      </button>}
                      {!isVoiceNote && <button
                        type="button"
                        aria-label="Edit user message"
                        onClick={(event) => {
                          event.currentTarget.blur();
                          openUserMessageEditor(chatMessage.id, visibleText);
                        }}
                        className="flex size-4 items-center justify-center rounded-full bg-white/90 text-[#777a82] opacity-0 pointer-events-none transition-none hover:bg-[#f1f2f4] hover:text-[#34363b]"
                      >
                        <Pencil aria-hidden="true" className="size-3" />
                      </button>}
                      <button
                        type="button"
                        aria-label="Delete this message and everything after it"
                        disabled={isSending || isDeletingChatBranch}
                        onClick={() => {
                          setDeleteChatTarget({ id: chatMessage.id, text: visibleText });
                          setActiveUserActions(null);
                        }}
                        className="pointer-events-none flex size-4 items-center justify-center rounded-full bg-white/90 text-[#b43b3b] opacity-0 transition-none hover:bg-red-50 disabled:opacity-40"
                      >
                        <Trash2 aria-hidden="true" className="size-3" />
                      </button>
                    </div>}
                    </div>
                    {failedSubmission && (
                      <p role="status" className="mt-1 max-w-[94%] text-right text-[11px] leading-4 text-[#a34444]">
                        Koneksi tidak stabil atau pesan gagal dikirim.{" "}
                        {failedSubmission.retrying
                          ? "Mencoba mengirim ulang…"
                          : failedSubmission.retryable
                            ? "Akan mencoba ulang saat koneksi kembali; tekan ikon untuk retry."
                            : `${failedSubmission.error} Tekan ikon untuk mencoba lagi.`}
                      </p>
                    )}
                    {versionControls && (
                      <div className="mt-0.5 flex min-h-7 w-full items-center justify-end">
                        {versionControls}
                      </div>
                    )}
                  </article>
                );
              }

              return (
                <article
                  data-chat-message
                  {...(isVoiceNote ? { "data-voice-note-message": "" } : {})}
                  {...(showAssistantText && visibleText.trim() && !isVoiceNote
                    ? { "data-has-visible-text": "" }
                    : {})}
                  key={chatMessage.id}
                  className="w-full min-w-0 text-[#27282d]"
                >
                  {showAssistantText && visibleThinkingSummary && (
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
                        <div className="mt-1 border-l border-[#e4e5e8] pl-3 text-xs leading-5 text-[#747780] [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_pre]:my-1">
                          <Suspense fallback={null}>
                            <AssistantMarkdown content={visibleThinkingSummary} />
                          </Suspense>
                        </div>
                      )}
                    </div>
                  )}
                  {showAssistantText && (
                    <div
                      className="max-w-full break-words leading-6"
                      style={{ fontSize: Math.round(14 * chatFontScale) }}
                    >
                      <Suspense fallback={null}>
                        <AssistantMarkdown
                          key={`${chatMessage.id}:${animateAssistant ? "typing" : "complete"}`}
                          content={visibleText}
                          animate={animateAssistant}
                          activeSpeechWordIndex={
                            ttsPlayback?.messageId === chatMessage.id &&
                            ttsPlayback.versionNumber === versionNumber &&
                            ttsPlayback.status === "playing"
                              ? ttsPlayback.activeWordIndex ?? null
                              : null
                          }
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
                  )}
                  {chatMessage.attachments && chatMessage.attachments.length > 0 && (
                    <div
                      aria-label="AI-shared attachments"
                      className="mt-1 grid w-fit max-w-[min(100%,420px)] grid-cols-2 gap-2 sm:mt-2"
                    >
                      {chatMessage.attachments.map((attachment) =>
                        attachment.mime_type.startsWith("audio/") ? (
                          <ChatMessageAudioNote
                            key={attachment.id}
                            attachment={attachment}
                            expired={isChatAttachmentExpired(attachment)}
                            getPreviewUrl={getAttachmentPreviewUrl}
                            size="large"
                          />
                        ) : (
                          <ChatMessageAttachmentTile
                            key={attachment.id}
                            attachment={attachment}
                            expired={isChatAttachmentExpired(attachment)}
                            getPreviewUrl={getAttachmentPreviewUrl}
                            onOpen={(item) => void openStoredAttachment(item)}
                            size="large"
                          />
                        ),
                      )}
                    </div>
                  )}
                  <div
                    aria-label="Assistant message actions"
                    className="mt-1 flex flex-wrap items-center gap-1"
                  >
                    {versionControls}
                    <button
                      type="button"
                      aria-label={chatMessage.adminMessageId ? "Like admin relay" : "Like response"}
                      aria-pressed={
                        chatMessage.adminMessageId
                          ? adminRelayRatings[chatMessage.adminMessageId] === "like"
                          : ratings[ratingKey] === "like"
                      }
                      onClick={() =>
                        chatMessage.adminMessageId
                          ? void handleAdminRelayRating(chatMessage.adminMessageId, "like")
                          : void handleAssistantRating(chatMessage.id, versionNumber, "like")
                      }
                      className={`flex size-8 items-center justify-center rounded-lg transition hover:bg-[#f1f2f4] ${
                        (chatMessage.adminMessageId
                          ? adminRelayRatings[chatMessage.adminMessageId]
                          : ratings[ratingKey]) === "like"
                          ? "text-[#2088bf]"
                          : "text-[#777a82]"
                      }`}
                    >
                      <ThumbsUp aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={chatMessage.adminMessageId ? "Dislike admin relay" : "Dislike response"}
                      aria-pressed={
                        chatMessage.adminMessageId
                          ? adminRelayRatings[chatMessage.adminMessageId] === "dislike"
                          : ratings[ratingKey] === "dislike"
                      }
                      onClick={() =>
                        chatMessage.adminMessageId
                          ? void handleAdminRelayRating(chatMessage.adminMessageId, "dislike")
                          : void handleAssistantRating(chatMessage.id, versionNumber, "dislike")
                      }
                      className={`flex size-8 items-center justify-center rounded-lg transition hover:bg-[#f1f2f4] ${
                        (chatMessage.adminMessageId
                          ? adminRelayRatings[chatMessage.adminMessageId]
                          : ratings[ratingKey]) === "dislike"
                          ? "text-[#bd4a4a]"
                          : "text-[#777a82]"
                      }`}
                    >
                      <ThumbsDown aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={copiedMessageId === chatMessage.id ? "Copied response" : "Copy response"}
                      onClick={() => void copyAssistantMessage(chatMessage)}
                      className="flex size-8 items-center justify-center rounded-lg text-[#777a82] transition hover:bg-[#f1f2f4]"
                    >
                      {copiedMessageId === chatMessage.id ? (
                        <Check aria-hidden="true" className="size-4 text-[#398650]" />
                      ) : (
                        <Copy aria-hidden="true" className="size-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={chatMessage.adminMessageId ? "Report admin relay" : "Report response"}
                      onClick={() => {
                        setReportTarget({
                          id: chatMessage.id,
                          versionNumber,
                          ...(chatMessage.adminMessageId
                            ? { adminMessageId: chatMessage.adminMessageId }
                            : {}),
                        });
                        reportDetailsRef.current = "";
                        setReportError("");
                        setSendError("");
                      }}
                      className="flex size-8 items-center justify-center rounded-lg text-[#777a82] transition hover:bg-[#f1f2f4]"
                    >
                      <TriangleAlert aria-hidden="true" className="size-4" />
                    </button>
                    {!isVoiceNote && (
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
                    )}
                    {!chatMessage.isReminder &&
                      (!chatMessage.adminMessageId || authUser?.role !== "admin") && (
                      <button
                        type="button"
                        aria-label={
                          chatMessage.adminMessageId ? "Regenerate admin relay" : "Regenerate response"
                        }
                        disabled={isSending || regeneratingAdminRelayId !== null}
                        onClick={() =>
                          chatMessage.adminMessageId
                            ? void regenerateAdminRelayMessage(chatMessage.adminMessageId)
                            : void regenerateAssistantMessage(chatMessage.id)
                        }
                        className="ml-auto flex size-8 items-center justify-center rounded-lg text-[#777a82] transition hover:bg-[#f1f2f4] disabled:opacity-50"
                      >
                        <RotateCw aria-hidden="true" className="size-4" />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
            {isAssistantBusy && !typingAssistant && (
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
                    {typingAssistant
                      ? "Cheya is writing the reply…"
                      : activeChatJob?.progress ||
                      thinkingSteps[thinkingSteps.length - 1] ||
                      "Reviewing the request…"}
                  </p>
                ) : (
                  <p><i>Processing...</i></p>
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
                className="chat-quick-panel whitespace-pre-line rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {sendError}
              </p>
            )}
          </div>
        </div>

        <footer
          ref={observeChatFooter}
          className="chat-footer absolute inset-x-0 bottom-0 z-20 bg-transparent px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2.5"
        >
          {showScrollToLatest && pathname === "/" && (
            <button
              type="button"
              aria-label="Scroll to latest message"
              title="Scroll to latest message"
              onClick={() => scrollConversationToLatest()}
              className="absolute right-4 z-30 flex size-9 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] shadow-[0_3px_14px_rgba(20,24,32,0.16)] transition hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3] sm:size-10"
              style={{ bottom: "calc(100% + 6px)" }}
            >
              <ArrowDown aria-hidden="true" className="size-4" />
            </button>
          )}
          <form
            aria-label="Send message"
            className="chat-composer rounded-[25px] border border-[#e5e6e9] bg-white p-1"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            {attachedMedia.some((attachment) => !attachment.isAutoSentVoiceNote) && (
              <div
                aria-label="Files ready to upload"
                className="grid max-w-full grid-flow-col auto-cols-[68px] gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain px-2 pb-0 pt-2 sm:auto-cols-[68px] sm:gap-1.5 sm:pb-1 sm:pt-2.5"
              >
                {attachedMedia.map((attachment, index) => {
                  if (attachment.isAutoSentVoiceNote) return null;
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
                        disabled={
                          attachment.isBlocked ||
                          Boolean(attachment.uploadError)
                        }
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
                          aria-label={`Saving ${file.name}`}
                          className="attachment-upload-progress pointer-events-none absolute inset-x-0 bottom-0 z-[5]"
                        />
                      )}
                      {attachment.uploadError && !attachment.isBlocked && (
                        <div
                          role="alert"
                          className="absolute inset-0 z-[6] flex flex-col items-center justify-center gap-1 bg-red-900/60 px-1 text-white"
                          title={attachment.uploadError}
                        >
                          <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
                          <span className="max-w-full truncate text-[8px] font-medium">
                            Save failed
                          </span>
                          <button
                            type="button"
                            aria-label={`Retry processing ${file.name}`}
                            title={`Retry: ${attachment.uploadError}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setAttachedMedia((current) =>
                                current.map((item) =>
                                  item.id === attachment.id
                                    ? { ...item, isUploading: true, uploadError: null }
                                    : item,
                                ),
                              );
                              void retryPendingAttachment(attachment);
                            }}
                            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/20 hover:bg-white/35"
                          >
                            <RotateCw aria-hidden="true" className="size-4" />
                          </button>
                        </div>
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
            <div className="flex min-h-11 items-start px-3 pb-2 pt-1">
              {isRecordingVoice ? (
                <div
                  role="status"
                  aria-label="Recording voice message"
                  className="flex min-h-11 w-full items-center gap-3 px-1 text-sm text-[#34363b]"
                >
                  <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
                  <div
                    role="img"
                    aria-label="Live voice waveform"
                    className="flex h-9 min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden"
                  >
                    {voiceRecordingWaveform.map((height, index) => (
                      <span
                        key={index}
                        className="w-[3px] shrink-0 rounded-full bg-[#7651a2] transition-[height] duration-150"
                        style={{ height: `${height}px` }}
                      />
                    ))}
                  </div>
                  <span className="ml-auto tabular-nums text-[#777a82]">
                    {formatMediaTime(voiceRecordingSeconds)}
                  </span>
                </div>
              ) : (
                <ChatMessageInput
                  inputRef={messageInputRef}
                  defaultValue={messageDraftRef.current}
                  disabled={!hasGeminiApiKey}
                  enterKeyBehavior={
                    window.matchMedia("(pointer: coarse)").matches
                      ? generalSettings.enter_key_behavior_mobile
                      : generalSettings.enter_key_behavior_desktop
                  }
                  fontSize={Math.round(generalSettings.font_size * 16 / 14)}
                  onDraftInput={handleMessageDraftInput}
                  onSubmitMessage={() => void sendMessage()}
                  placeholder={
                    hasGeminiApiKey ? "Ask anything..." : "Add a Gemini API key in Settings first"
                  }
                />
              )}
            </div>

            <div className="-mx-1 flex items-center justify-between gap-2 px-1 pb-1">
              {isRecordingVoice ? (
                null
              ) : (
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
              )}
              <div className="flex items-center gap-1">
                {!isRecordingVoice && (
                  <ThinkingModeToggle
                    disabled={!hasGeminiApiKey}
                    onToggle={(enabled) => {
                      thinkingModeRef.current = enabled;
                    }}
                  />
                )}
                {isRecordingVoice ? (
                  <>
                    <button
                      type="button"
                      aria-label="Cancel voice recording"
                      onClick={() => stopVoiceRecording(true)}
                      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] hover:bg-[#f7f8fa] sm:size-10"
                    >
                      <X aria-hidden="true" className="size-[18px]" />
                    </button>
                    <button
                      type="button"
                      aria-label="Send voice message"
                      onClick={() => stopVoiceRecording()}
                      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-red-600 bg-red-600 text-white hover:bg-red-700 sm:size-10"
                    >
                      <span aria-hidden="true" className="size-3.5 rounded-sm bg-current" />
                    </button>
                  </>
                ) : isAssistantBusy ? (
                  <>
                    <button
                      type="button"
                      aria-label="Microphone unavailable while Cheya is responding"
                      disabled
                      className="chat-composer-idle-control flex size-9 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-[#34363b] opacity-35 blur-[1px] sm:size-10"
                    >
                      <Mic aria-hidden="true" className="size-[19px]" strokeWidth={1.8} />
                    </button>
                    <button
                      type="button"
                      aria-label="Cheya is responding"
                      disabled
                      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#17181b] bg-[#17181b] text-white sm:size-10"
                    >
                      <LoaderCircle aria-hidden="true" className="size-[18px] animate-spin" />
                    </button>
                  </>
                ) : attachedMedia.length > 0 ? (
                  <button
                    type="button"
                    aria-label="Send message"
                    onPointerDown={(event) => {
                      if (event.pointerType === "touch") event.preventDefault();
                    }}
                    onClick={() => void sendMessage()}
                    disabled={
                      isAssistantBusy ||
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
                    {isAttachmentUploadPending ||
                    isRestoringDraftAttachments ? (
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
                      disabled={!hasGeminiApiKey || isRestoringDraftAttachments}
                      onClick={() => void startVoiceRecording()}
                      className="chat-composer-idle-control flex size-9 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3] disabled:opacity-40 sm:size-10"
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
                      onPointerDown={(event) => {
                        if (event.pointerType === "touch") event.preventDefault();
                      }}
                      onClick={() => void sendMessage()}
                      disabled={
                        isRestoringDraftAttachments ||
                        isAttachmentUploadPending ||
                        !hasGeminiApiKey
                      }
                      className="chat-composer-send hidden size-9 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3] disabled:opacity-40 sm:size-10"
                    >
                      {isRestoringDraftAttachments ||
                      isAttachmentUploadPending ? (
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

      {selectedUserMessage && (
        <div
          data-user-selection-overlay
          className="fixed inset-0 z-[70] hidden flex-col items-center justify-center gap-3 bg-black/45 px-5 py-8 backdrop-blur-md [touch-action:none] max-sm:flex"
          onPointerDown={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) setActiveUserActions(null);
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) setActiveUserActions(null);
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <section
            data-user-actions
            role="dialog"
            aria-modal="true"
            aria-label={selectedUserMessageIsVoiceNote ? "Selected voice message" : "Selected user message"}
            className="w-full max-w-sm"
          >
            {selectedUserMessageIsVoiceNote && selectedUserMessageAudio ? (
              <ChatMessageAudioNote
                attachment={selectedUserMessageAudio}
                expired={isChatAttachmentExpired(selectedUserMessageAudio)}
                getPreviewUrl={getAttachmentPreviewUrl}
                size="large"
              />
            ) : (
              <div
                className="max-h-40 overflow-hidden rounded-2xl bg-[#28292e] px-4 py-3 text-sm leading-5 text-white line-clamp-6 shadow-2xl"
                style={{ fontSize: Math.round(13 * chatFontScale), lineHeight: 1.4 }}
              >
                {selectedUserMessageText}
              </div>
            )}
          </section>
          <div
            data-user-actions
            aria-label="Message options"
            className="w-full max-w-sm select-none overflow-hidden rounded-[28px] bg-white py-2 shadow-2xl"
          >
            {!selectedUserMessageIsVoiceNote && <button
              type="button"
              onClick={() => {
                void copyMessageText(selectedUserMessage.id, selectedUserMessageText);
                setActiveUserActions(null);
              }}
              className="flex min-h-14 w-full items-center gap-4 px-5 text-left text-[15px] font-medium text-[#292a30] active:bg-[#f2f3f5]"
            >
              {copiedMessageId === selectedUserMessage.id ? (
                <Check aria-hidden="true" className="size-5 text-[#398650]" />
              ) : (
                <Copy aria-hidden="true" className="size-5" />
              )}
              Copy message
            </button>}
            {!selectedUserMessageIsVoiceNote && <div className="mx-5 h-px bg-[#eceef1]" />}
            {!selectedUserMessageIsVoiceNote && <button
              type="button"
              onClick={() => {
                openUserMessageEditor(selectedUserMessage.id, selectedUserMessageText);
                setActiveUserActions(null);
              }}
              className="flex min-h-14 w-full items-center gap-4 px-5 text-left text-[15px] font-medium text-[#292a30] active:bg-[#f2f3f5]"
            >
              <Pencil aria-hidden="true" className="size-5" />
              Edit message
            </button>}
            {!selectedUserMessageIsVoiceNote && <div className="mx-5 h-px bg-[#eceef1]" />}
            <button
              type="button"
              disabled={isSending || isDeletingChatBranch}
              onClick={() => {
                setDeleteChatTarget({
                  id: selectedUserMessage.id,
                  text: selectedUserMessageText,
                });
                setActiveUserActions(null);
              }}
              className="flex min-h-14 w-full items-center gap-4 px-5 text-left text-[15px] font-medium text-[#b43b3b] active:bg-red-50 disabled:opacity-40"
            >
              <Trash2 aria-hidden="true" className="size-5" />
              Delete message
            </button>
          </div>
        </div>
      )}

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
            className="chat-quick-panel w-full max-w-md rounded-3xl border border-[#e2e4e8] bg-white p-5 shadow-xl"
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
          className="chat-quick-panel w-full rounded-3xl bg-white p-5 shadow-xl"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-3 py-5"
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
            aria-label="Send feedback"
            className="chat-quick-panel feedback-construction-frame relative w-full max-w-[420px] shadow-[0_20px_56px_rgba(0,0,0,0.22)]"
          >
            <div aria-hidden="true" className="feedback-construction-stripe" />
            <div className="feedback-construction-content">
              <div className="bg-white px-1 py-1.5">
                <textarea
                  id="response-report-details"
                  aria-label="Feedback details"
                  aria-describedby="response-report-character-count"
                  maxLength={2000}
                  rows={4}
                  placeholder="Describe the feedback…"
                  defaultValue={reportDetailsRef.current}
                  onChange={(event) => {
                    const { currentTarget } = event;
                    const characterCount = currentTarget.value.length;
                    const isAtLimit = characterCount >= 2000;
                    reportDetailsRef.current = currentTarget.value;
                    currentTarget.classList.toggle("border-red-600", isAtLimit);
                    currentTarget.classList.toggle("focus:border-red-600", isAtLimit);
                    currentTarget.classList.toggle("focus:ring-red-200", isAtLimit);
                    currentTarget.classList.toggle("border-[#343434]", !isAtLimit);
                    currentTarget.classList.toggle("focus:border-[#b58a00]", !isAtLimit);
                    currentTarget.classList.toggle("focus:ring-[#facc15]/50", !isAtLimit);
                    if (reportCharacterCountRef.current) {
                      reportCharacterCountRef.current.textContent = isAtLimit
                        ? "0 characters remaining — limit reached; additional input is blocked."
                        : `${2000 - characterCount} characters remaining`;
                      reportCharacterCountRef.current.classList.toggle("font-semibold", isAtLimit);
                      reportCharacterCountRef.current.classList.toggle("text-red-700", isAtLimit);
                      reportCharacterCountRef.current.classList.toggle("text-[#777a82]", !isAtLimit);
                    }
                  }}
                  className="min-h-24 w-full resize-y rounded-lg border-2 border-[#343434] bg-white px-2 py-1 text-sm leading-5 text-[#252525] outline-none placeholder:text-[#898989] focus:border-[#b58a00] focus:ring-2 focus:ring-[#facc15]/50"
                />
                <p
                  ref={reportCharacterCountRef}
                  id="response-report-character-count"
                  aria-live="polite"
                  className="mt-1 text-right text-xs text-[#777a82]"
                >
                  2000 characters remaining
                </p>
                {reportError && (
                  <p role="alert" className="mt-2 text-xs font-medium text-red-700">
                    {reportError}
                  </p>
                )}
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={isSavingReport}
                    onClick={() => {
                      setReportTarget(null);
                      setReportError("");
                    }}
                    className="h-9 rounded-lg border border-[#4d4b42] bg-white px-3.5 text-xs font-semibold text-[#34332d] hover:bg-[#f5f1df] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSavingReport}
                    onClick={() => void submitAssistantReport()}
                    className="flex h-9 items-center gap-2 rounded-lg border-2 border-[#252525] bg-[#facc15] px-3.5 text-xs font-bold text-[#252525] shadow-[0_2px_0_#252525] transition hover:bg-[#f4bd00] disabled:opacity-50"
                  >
                    {isSavingReport && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                    Send feedback
                  </button>
                </div>
              </div>
            </div>
            <div aria-hidden="true" className="feedback-construction-stripe" />
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
            className="chat-quick-panel w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl"
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

      {toast && (
        <ActionToast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          onDismiss={() => setToast(null)}
        />
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

      {remoteAttachmentView &&
        (() => {
          const { attachment, signedUrl, textContent, isLoading } = remoteAttachmentView;
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
                isLoading={isLoading}
                downloadHref={signedUrl}
                onClose={closeRemoteAttachmentView}
              />
            );
          }
          const textLines = (textContent ?? "").split(/\r\n|\r|\n/);
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
                  {signedUrl && (
                    <a
                      href={signedUrl}
                      download={attachment.file_name}
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
                {isLoading ? (
                  <div role="status" className="flex items-center gap-2 text-sm text-white/70">
                    <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
                    Preparing preview…
                  </div>
                ) : isPdf ? (
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
                          value={textContent ?? ""}
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
        })()}

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
      {authClient && authUser && (
        <BugReportDialog
          open={isBugReportOpen}
          onClose={() => setIsBugReportOpen(false)}
          onDiscard={() => setIsBugReportOpen(false)}
          client={authClient}
          accountUserId={authUser.id}
          accountEmail={authUser.email}
          accountProvider={authUser.provider}
          githubUsername={authUser.githubUsername}
          accountRole={authUser.role}
        />
      )}
    </main>
  );
}
