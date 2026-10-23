import { ArrowLeft, ArrowRight, Pause, Play, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const totalSeconds = Math.floor(seconds);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function BugReportMediaPreview({
  file,
  src,
  onClose,
}: {
  file: File;
  src: string;
  onClose: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<{
    distance: number;
    scale: number;
    translateX: number;
    translateY: number;
    focalX: number;
    focalY: number;
  } | null>(null);
  const panStartRef = useRef<{
    x: number;
    y: number;
    translateX: number;
    translateY: number;
  } | null>(null);
  const transformRef = useRef({ scale: 1, translateX: 0, translateY: 0 });
  const clickTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; x: number } | null>(null);
  const seekTimerRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playError, setPlayError] = useState("");
  const [seekFeedback, setSeekFeedback] = useState<"back" | "forward" | null>(null);
  const isVideo = file.type.startsWith("video/");

  useEffect(
    () => () => {
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
      if (seekTimerRef.current !== null) window.clearTimeout(seekTimerRef.current);
    },
    [],
  );

  function applyTransform(scale: number, translateX: number, translateY: number) {
    const stage = stageRef.current;
    const media = mediaRef.current;
    if (!stage || !media) return;
    const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
    const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
    const aspect = width > 0 && height > 0 ? width / height : stage.clientWidth / stage.clientHeight;
    const fittedWidth = Math.min(stage.clientWidth, stage.clientHeight * aspect);
    const fittedHeight = Math.min(stage.clientHeight, stage.clientWidth / aspect);
    const maxX = Math.max(0, (fittedWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (fittedHeight * scale - stage.clientHeight) / 2);
    const boundedX = Math.max(-maxX, Math.min(maxX, translateX));
    const boundedY = Math.max(-maxY, Math.min(maxY, translateY));
    transformRef.current = { scale, translateX: boundedX, translateY: boundedY };
    media.style.transform = `translate3d(${boundedX}px, ${boundedY}px, 0) scale(${scale})`;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch" || !window.matchMedia("(pointer: coarse)").matches) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);

    if (pointersRef.current.size === 1 && transformRef.current.scale > 1) {
      panStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        translateX: transformRef.current.translateX,
        translateY: transformRef.current.translateY,
      };
    } else if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const stageBounds = stageRef.current?.getBoundingClientRect();
      if (!stageBounds || distance === 0) return;
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      const transform = transformRef.current;
      gestureRef.current = {
        distance,
        scale: transform.scale,
        translateX: transform.translateX,
        translateY: transform.translateY,
        focalX:
          (centerX - stageBounds.left - stageBounds.width / 2 - transform.translateX) /
          transform.scale,
        focalY:
          (centerY - stageBounds.top - stageBounds.height / 2 - transform.translateY) /
          transform.scale,
      };
      if (mediaRef.current) mediaRef.current.style.transition = "none";
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 1 && panStartRef.current) {
      applyTransform(
        transformRef.current.scale,
        panStartRef.current.translateX + event.clientX - panStartRef.current.x,
        panStartRef.current.translateY + event.clientY - panStartRef.current.y,
      );
      return;
    }
    const gesture = gestureRef.current;
    if (pointersRef.current.size !== 2 || !gesture) return;
    const [first, second] = [...pointersRef.current.values()];
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    const centerX = (first.x + second.x) / 2;
    const centerY = (first.y + second.y) / 2;
    const stageBounds = stageRef.current?.getBoundingClientRect();
    if (!stageBounds) return;
    const scale = Math.min(8, Math.max(1, gesture.scale * distance / gesture.distance));
    applyTransform(
      scale,
      centerX - stageBounds.left - stageBounds.width / 2 - gesture.focalX * scale,
      centerY - stageBounds.top - stageBounds.height / 2 - gesture.focalY * scale,
    );
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    panStartRef.current = null;
    if (pointersRef.current.size === 0) {
      gestureRef.current = null;
      if (mediaRef.current) mediaRef.current.style.transition = "transform 180ms ease-out";
      applyTransform(1, 0, 0);
      return;
    }
    if (pointersRef.current.size < 2) gestureRef.current = null;
    if (pointersRef.current.size === 1 && transformRef.current.scale > 1) {
      const [pointer] = [...pointersRef.current.values()];
      panStartRef.current = {
        x: pointer.x,
        y: pointer.y,
        translateX: transformRef.current.translateX,
        translateY: transformRef.current.translateY,
      };
    }
  }

  async function togglePlayback() {
    const video = mediaRef.current;
    if (!(video instanceof HTMLVideoElement)) return;
    setPlayError("");
    if (video.paused) {
      try {
        await video.play();
      } catch (error) {
        setPlayError(error instanceof Error ? error.message : "This video could not be played.");
      }
    } else {
      video.pause();
    }
  }

  function seekFromDoubleClick(clientX: number) {
    const video = mediaRef.current;
    const stage = stageRef.current;
    if (!(video instanceof HTMLVideoElement) || !stage) return;
    const bounds = stage.getBoundingClientRect();
    const direction = clientX < bounds.left + bounds.width / 2 ? "back" : "forward";
    video.currentTime = Math.min(
      Math.max(0, video.currentTime + (direction === "back" ? -5 : 5)),
      Number.isFinite(video.duration) ? video.duration : video.currentTime + 5,
    );
    setSeekFeedback(direction);
    if (seekTimerRef.current !== null) window.clearTimeout(seekTimerRef.current);
    seekTimerRef.current = window.setTimeout(() => setSeekFeedback(null), 650);
  }

  function handleMediaClick(event: ReactMouseEvent<HTMLImageElement | HTMLVideoElement>) {
    if (!isVideo) return;
    const now = performance.now();
    const previousTap = lastTapRef.current;
    if (
      event.detail >= 2 ||
      (previousTap && now - previousTap.time < 320 && Math.abs(event.clientX - previousTap.x) < 120)
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
    <main className="fixed inset-0 z-[80] flex flex-col bg-[#17181c] text-white">
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-white/10 px-4 pr-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-white/60">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
        </div>
        <button
          type="button"
          aria-label="Close media preview"
          onClick={onClose}
          className="flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </header>
      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
      >
        {isVideo ? (
          <video
            ref={(element) => {
              mediaRef.current = element;
            }}
            src={src}
            playsInline
            preload="metadata"
            aria-label={file.name}
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
            alt={file.name}
            draggable={false}
            onClick={handleMediaClick}
            className="size-full select-none object-contain"
          />
        )}
        {seekFeedback && (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute top-1/2 z-10 flex -translate-y-1/2 items-center justify-center text-white ${seekFeedback === "back" ? "left-[12%]" : "right-[12%]"}`}
          >
            {seekFeedback === "back" ? (
              <ArrowLeft className="size-12" strokeWidth={2.5} />
            ) : (
              <ArrowRight className="size-12" strokeWidth={2.5} />
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
                const video = mediaRef.current;
                if (!(video instanceof HTMLVideoElement)) return;
                video.currentTime = Number(event.currentTarget.value);
                setCurrentTime(video.currentTime);
              }}
              className="media-preview-seek h-2 w-full cursor-pointer accent-white"
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  aria-label={isPlaying ? "Pause video" : "Play video"}
                  onClick={() => void togglePlayback()}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25"
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
