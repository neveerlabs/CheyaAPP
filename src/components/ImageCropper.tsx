import { useRef, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { MAX_CHAT_ATTACHMENT_BYTES, formatChatAttachmentSize } from "../lib/chat-attachments";

type CropSelection = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
type CropDrag = {
  kind: "draw" | "move" | "resize";
  start: Point;
  initial: CropSelection;
  edges: { top: boolean; right: boolean; bottom: boolean; left: boolean };
};

const FULL_IMAGE_SELECTION: CropSelection = { x: 0, y: 0, width: 1, height: 1 };
const MIN_CROP_SIZE = 0.025;

function imagePoint(
  event: React.PointerEvent<HTMLDivElement>,
  image: HTMLImageElement,
  allowOutside = true,
): Point | null {
  const bounds = image.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  if (
    !allowOutside &&
    (event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom)
  ) {
    return null;
  }
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
}

function cropFileName(fileName: string, mimeType: string): string {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const extension =
    mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return `${baseName}.${extension}`;
}

export function ImageCropper({
  src,
  file,
  onCancel,
  onApply,
}: {
  src: string;
  file: File;
  onCancel: () => void;
  onApply: (croppedFile: File) => Promise<void>;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<CropDrag | null>(null);
  const [selection, setSelection] = useState<CropSelection | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState("");

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const image = imageRef.current;
    const point = image && imagePoint(event, image, false);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = selection ?? FULL_IMAGE_SELECTION;
    const bounds = image.getBoundingClientRect();
    const resizeToleranceX = Math.min(24 / bounds.width, 0.08);
    const resizeToleranceY = Math.min(24 / bounds.height, 0.08);
    const left = current.x;
    const right = current.x + current.width;
    const top = current.y;
    const bottom = current.y + current.height;
    const inside =
      point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
    const edges = {
      left: inside && Math.abs(point.x - left) <= resizeToleranceX,
      right: inside && Math.abs(point.x - right) <= resizeToleranceX,
      top: inside && Math.abs(point.y - top) <= resizeToleranceY,
      bottom: inside && Math.abs(point.y - bottom) <= resizeToleranceY,
    };
    const resizing = Object.values(edges).some(Boolean);
    dragRef.current = {
      kind: !inside ? "draw" : resizing ? "resize" : "move",
      start: point,
      initial: current,
      edges,
    };
    if (!inside) setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
    setError("");
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const image = imageRef.current;
    const point = image && imagePoint(event, image);
    if (!point) return;
    if (drag.kind === "draw") {
      setSelection({
        x: Math.min(drag.start.x, point.x),
        y: Math.min(drag.start.y, point.y),
        width: Math.abs(point.x - drag.start.x),
        height: Math.abs(point.y - drag.start.y),
      });
      return;
    }
    if (drag.kind === "move") {
      const x = Math.min(
        1 - drag.initial.width,
        Math.max(0, drag.initial.x + point.x - drag.start.x),
      );
      const y = Math.min(
        1 - drag.initial.height,
        Math.max(0, drag.initial.y + point.y - drag.start.y),
      );
      setSelection({ ...drag.initial, x, y });
      return;
    }

    let left = drag.initial.x;
    let right = drag.initial.x + drag.initial.width;
    let top = drag.initial.y;
    let bottom = drag.initial.y + drag.initial.height;
    if (drag.edges.left) left = Math.min(right - MIN_CROP_SIZE, Math.max(0, point.x));
    if (drag.edges.right) right = Math.max(left + MIN_CROP_SIZE, Math.min(1, point.x));
    if (drag.edges.top) top = Math.min(bottom - MIN_CROP_SIZE, Math.max(0, point.y));
    if (drag.edges.bottom) bottom = Math.max(top + MIN_CROP_SIZE, Math.min(1, point.y));
    setSelection({ x: left, y: top, width: right - left, height: bottom - top });
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    handlePointerMove(event);
    dragRef.current = null;
  }

  async function applyCrop() {
    const image = imageRef.current;
    if (!image || !selection || selection.width < 0.01 || selection.height < 0.01) {
      setError("Adjust the crop box to choose the area to keep.");
      return;
    }
    setIsApplying(true);
    setError("");
    try {
      const left = Math.round(selection.x * image.naturalWidth);
      const top = Math.round(selection.y * image.naturalHeight);
      const width = Math.max(1, Math.round(selection.width * image.naturalWidth));
      const height = Math.max(1, Math.round(selection.height * image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(width, image.naturalWidth - left);
      canvas.height = Math.min(height, image.naturalHeight - top);
      if (!canvas.width || !canvas.height) throw new Error("The selected crop area is empty.");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not prepare the cropped photo.");
      context.drawImage(
        image,
        left,
        top,
        canvas.width,
        canvas.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );

      const mimeType =
        file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error("This browser could not encode the cropped photo."));
          },
          mimeType,
          mimeType === "image/jpeg" || mimeType === "image/webp" ? 0.92 : undefined,
        );
      });
      if (blob.size > MAX_CHAT_ATTACHMENT_BYTES) {
        throw new Error(
          `The cropped photo exceeds the ${formatChatAttachmentSize(MAX_CHAT_ATTACHMENT_BYTES)} upload limit.`,
        );
      }
      const croppedFile = new File([blob], cropFileName(file.name, blob.type), {
        type: blob.type,
        lastModified: Date.now(),
      });
      await onApply(croppedFile);
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : "Could not crop this photo.");
    } finally {
      setIsApplying(false);
    }
  }

  const selectionCoordinates = selection
    ? {
        x: selection.x * 1000,
        y: selection.y * 1000,
        width: selection.width * 1000,
        height: selection.height * 1000,
      }
    : null;

  return (
    <main className="fixed inset-0 z-[60] flex flex-col bg-[#17181c] text-white">
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-white/10 px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Crop photo</p>
          <p className="truncate text-xs text-white/60">{file.name}</p>
        </div>
        <button
          type="button"
          aria-label="Cancel crop"
          onClick={onCancel}
          disabled={isApplying}
          className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-50"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </header>
      <section className="relative flex min-h-0 flex-1 flex-col">
        <div
          className="flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden p-4"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <div className="relative inline-flex max-w-full">
            <img
              ref={imageRef}
              src={src}
              alt={`Crop ${file.name}`}
              draggable={false}
              onLoad={() => setSelection((current) => current ?? FULL_IMAGE_SELECTION)}
              className="block max-h-[calc(100dvh-180px)] max-w-[calc(100vw-32px)] object-contain"
            />
            <svg
              aria-hidden="true"
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 size-full"
            >
              {selectionCoordinates ? (
                <>
                  <path
                    d={`M0 0H1000V1000H0Z M${selectionCoordinates.x} ${selectionCoordinates.y}h${selectionCoordinates.width}v${selectionCoordinates.height}h-${selectionCoordinates.width}Z`}
                    fill="black"
                    fillOpacity="0.58"
                    fillRule="evenodd"
                  />
                  <rect
                    x={selectionCoordinates.x}
                    y={selectionCoordinates.y}
                    width={selectionCoordinates.width}
                    height={selectionCoordinates.height}
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    vectorEffect="non-scaling-stroke"
                  />
                  {[
                    [selectionCoordinates.x, selectionCoordinates.y],
                    [selectionCoordinates.x + selectionCoordinates.width / 2, selectionCoordinates.y],
                    [selectionCoordinates.x + selectionCoordinates.width, selectionCoordinates.y],
                    [selectionCoordinates.x, selectionCoordinates.y + selectionCoordinates.height / 2],
                    [selectionCoordinates.x + selectionCoordinates.width, selectionCoordinates.y + selectionCoordinates.height / 2],
                    [selectionCoordinates.x, selectionCoordinates.y + selectionCoordinates.height],
                    [selectionCoordinates.x + selectionCoordinates.width / 2, selectionCoordinates.y + selectionCoordinates.height],
                    [selectionCoordinates.x + selectionCoordinates.width, selectionCoordinates.y + selectionCoordinates.height],
                  ].map(([x, y], index) => (
                    <rect
                      key={index}
                      x={x - 7}
                      y={y - 7}
                      width="14"
                      height="14"
                      rx="3"
                      fill="#fff"
                      stroke="#17181c"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </>
              ) : (
                <rect width="1000" height="1000" fill="black" fillOpacity="0.18" />
              )}
            </svg>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-3 border-t border-white/10 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
          <p className="text-center text-xs text-white/70">
            Drag the edges to resize the crop box, or drag inside it to move it.
          </p>
          {error && <p role="alert" className="text-center text-xs text-red-300">{error}</p>}
          <div className="flex w-full max-w-sm items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelection(FULL_IMAGE_SELECTION);
                setError("");
              }}
              disabled={
                !selection ||
                (selection.x === 0 &&
                  selection.y === 0 &&
                  selection.width === 1 &&
                  selection.height === 1) ||
                isApplying
              }
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-white/20 text-sm hover:bg-white/10 disabled:opacity-45"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Reset
            </button>
            <button
              type="button"
              onClick={() => void applyCrop()}
              disabled={!selection || selection.width < 0.01 || selection.height < 0.01 || isApplying}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-white text-sm font-medium text-[#17181c] hover:bg-white/90 disabled:opacity-45"
            >
              <Check aria-hidden="true" className="size-4" />
              {isApplying ? "Saving crop…" : "Crop and save"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
