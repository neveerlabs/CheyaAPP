import {
  AudioLines,
  BadgeCheck,
  Bell,
  Bug,
  Camera,
  Check,
  Files,
  Film,
  Image,
  Mic,
  Plus,
  Search,
  Settings,
  Send,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import avatarUrl from "../assets/cheyaverse.jpg";

const headerActions = [
  { label: "Report a problem", icon: Bug },
  { label: "Settings", icon: Settings },
];

export function App() {
  const [message, setMessage] = useState("");
  const [caption, setCaption] = useState("");
  const [isMediaMenuOpen, setIsMediaMenuOpen] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isGalleryExpanded, setIsGalleryExpanded] = useState(false);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [attachedMedia, setAttachedMedia] = useState<File[]>([]);
  const [viewport, setViewport] = useState({ height: 0, top: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const cameraCaptureInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const dragStart = useRef<{ y: number; height: number } | null>(null);
  const gallerySheetRef = useRef<HTMLElement>(null);
  const hasMessage = message.trim().length > 0 || attachedMedia.length > 0;
  const mediaPreviews = useMemo(
    () => new Map(galleryFiles.map((file) => [file, URL.createObjectURL(file)])),
    [galleryFiles],
  );

  useEffect(
    () => () => {
      mediaPreviews.forEach((preview) => URL.revokeObjectURL(preview));
    },
    [mediaPreviews],
  );

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const updateViewport = () => {
      setViewport({
        height: visualViewport?.height ?? window.innerHeight,
        top: visualViewport?.offsetTop ?? 0,
      });
    };
    updateViewport();
    visualViewport?.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);

    return () => {
      visualViewport?.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  function openGallery() {
    setCaption("");
    setIsGalleryExpanded(false);
    setIsGalleryOpen(true);
  }

  function showPickedMedia(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/"),
    );
    if (files.length === 0) return;

    setGalleryFiles(files);
    setSelectedFiles(files);
    openGallery();
  }

  function closeGallery() {
    setIsGalleryOpen(false);
    setIsGalleryExpanded(false);
  }

  function addCameraCapture() {
    cameraCaptureInputRef.current?.click();
  }

  function toggleMediaSelection(file: File) {
    setSelectedFiles((files) =>
      files.some((item) => item === file)
        ? files.filter((item) => item !== file)
        : [...files, file],
    );
  }

  function finishMediaSelection() {
    setAttachedMedia((files) => [...files, ...selectedFiles]);
    setMessage(caption);
    closeGallery();
  }

  function sendMessage() {
    setMessage("");
    setAttachedMedia([]);
    if (messageInputRef.current) {
      messageInputRef.current.style.height = "52px";
    }
  }

  return (
    <main
      className="fixed inset-x-0 flex justify-center bg-[#f5f6f8] p-0 sm:p-5"
      style={{
        top: viewport.height ? `${viewport.top}px` : 0,
        height: viewport.height ? `${viewport.height}px` : "100dvh",
      }}
    >
      <section
        aria-label="CheyaVerse chat"
        className="flex h-full w-full flex-col overflow-hidden border-[#e7e8eb] bg-white sm:max-w-[580px] sm:rounded-[34px] sm:border"
      >
        <header className="flex h-[64px] shrink-0 items-center justify-between gap-2 px-2 py-1 sm:gap-3 sm:px-5">
          <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-[#e8e9ec] bg-white py-1 pl-1 pr-2 sm:gap-2.5 sm:pr-2">
            <img
              src={avatarUrl}
              alt="CheyaVerse profile photo"
              className="size-10 shrink-0 rounded-full object-cover"
            />
            <div className="flex min-w-0 flex-col justify-center">
              <div className="flex items-center gap-0.5">
                <h1 className="truncate text-base font-semibold leading-5 text-[#17181b]">
                  CheyaVerse
                </h1>
                <BadgeCheck
                  aria-label="Verified account"
                  className="size-[18px] shrink-0 fill-[#28a9e0] text-white"
                  strokeWidth={2.5}
                />
              </div>
              <p className="truncate text-[11px] leading-4 text-[#96989d]">
                Service notifications
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
                className="flex size-9 items-center justify-center rounded-full text-[#303238] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
              >
                <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
              </button>
            ))}
          </nav>
        </header>

        <div
          aria-label="Conversation"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        />

        <footer className="shrink-0 bg-white px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5 sm:px-5 sm:pb-5">
          {attachedMedia.length > 0 && (
            <div className="mb-1.5 flex max-h-8 gap-2 overflow-x-auto px-1 text-xs text-[#686b72]">
              {attachedMedia.map((file, index) => (
                <span
                  key={`${file.name}-${file.lastModified}-${index}`}
                  className="max-w-[180px] shrink-0 truncate rounded-full bg-[#f3f4f6] px-2.5 py-1"
                  title={file.name}
                >
                  {file.name}
                </span>
              ))}
            </div>
          )}
          <form
            aria-label="Send message"
            className="rounded-[25px] border border-[#e5e6e9] bg-white p-1 shadow-[0_2px_10px_rgba(20,24,32,0.05)]"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <div className="flex min-h-[52px] items-center px-3">
              <textarea
                ref={messageInputRef}
                aria-label="Message"
                name="message"
                placeholder="Ask anything..."
                rows={1}
                value={message}
                inputMode="text"
                enterKeyHint="enter"
                onChange={(event) => {
                  setMessage(event.target.value);
                  event.currentTarget.style.height = "52px";
                  event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 128)}px`;
                }}
                className="min-h-[52px] max-h-32 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-3 text-base leading-[26px] text-[#25262a] outline-none placeholder:text-[#a2a3a7]"
              />
            </div>

            <div className="-mx-1 flex items-center justify-between gap-2 px-1 pb-1">
              <div className="relative">
                <button
                  type="button"
                  aria-label="Add media"
                  aria-expanded={isMediaMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setIsMediaMenuOpen((open) => !open)}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
                >
                  <Plus aria-hidden="true" className="size-[21px]" strokeWidth={1.8} />
                </button>
                {isMediaMenuOpen && (
                  <>
                    <button
                      type="button"
                      aria-label="Close media menu"
                      className="fixed inset-0 z-20 cursor-default"
                      onClick={() => setIsMediaMenuOpen(false)}
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
                          setIsMediaMenuOpen(false);
                          cameraCaptureInputRef.current?.click();
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
                          setIsMediaMenuOpen(false);
                          fileInputRef.current?.click();
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
                          setIsMediaMenuOpen(false);
                          filesInputRef.current?.click();
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Search"
                  className="flex h-10 items-center gap-2 rounded-full border border-[#e5e6e9] bg-white px-3.5 text-sm font-medium text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
                >
                  <Search aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
                  <span>Search</span>
                </button>
                {hasMessage ? (
                  <button
                    type="button"
                    aria-label="Send message"
                    onClick={sendMessage}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
                  >
                    <Send aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-label="Use microphone"
                      className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
                    >
                      <Mic aria-hidden="true" className="size-[19px]" strokeWidth={1.8} />
                    </button>
                    <button
                      type="button"
                      aria-label="Visualize"
                      className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
                    >
                      <AudioLines aria-hidden="true" className="size-5" strokeWidth={1.8} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </form>
        </footer>
      </section>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        aria-label="Choose photos and videos"
        className="sr-only"
        onChange={(event) => {
          showPickedMedia(event.currentTarget.files);
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
          showPickedMedia(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={cameraCaptureInputRef}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        aria-label="Capture a photo or video"
        className="sr-only"
        onChange={(event) => {
          showPickedMedia(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />

      {isGalleryOpen && (
        <div
          className="absolute inset-0 z-50 flex items-end justify-center bg-black/55 sm:items-center sm:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeGallery();
          }}
        >
          <section
            ref={gallerySheetRef}
            aria-label="Choose photos and videos"
            aria-modal="true"
            role="dialog"
            style={{ height: isGalleryExpanded ? "100%" : "72%" }}
            className={`flex w-full max-w-[580px] flex-col overflow-hidden bg-[#151515] text-white shadow-2xl sm:max-h-[88svh] sm:rounded-[26px] ${
              isGalleryExpanded ? "rounded-none sm:rounded-[26px]" : "rounded-t-[22px]"
            }`}
          >
            <div
              aria-label="Drag to expand or close the gallery"
              className="flex h-7 shrink-0 touch-none cursor-grab items-center justify-center active:cursor-grabbing"
              onPointerDown={(event) => {
                const height =
                  gallerySheetRef.current?.getBoundingClientRect().height ?? 0;
                dragStart.current = { y: event.clientY, height };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!dragStart.current || !gallerySheetRef.current) return;
                const delta = event.clientY - dragStart.current.y;
                const viewportHeight = viewport.height || window.innerHeight;
                const minHeight = Math.round(viewportHeight * 0.4);
                const nextHeight = Math.min(
                  viewportHeight,
                  Math.max(minHeight, dragStart.current.height - delta),
                );
                gallerySheetRef.current.style.height = `${nextHeight}px`;
              }}
              onPointerUp={(event) => {
                if (dragStart.current === null) return;
                const delta = event.clientY - dragStart.current.y;
                if (delta < -36) {
                  setIsGalleryExpanded(true);
                } else if (delta > 45 && isGalleryExpanded) {
                  setIsGalleryExpanded(false);
                } else if (delta > 100 && !isGalleryExpanded) {
                  closeGallery();
                } else {
                  gallerySheetRef.current?.style.removeProperty("height");
                }
                dragStart.current = null;
              }}
              onPointerCancel={() => {
                dragStart.current = null;
                gallerySheetRef.current?.style.removeProperty("height");
              }}
            >
              <span className="h-1 w-8 rounded-full bg-white/35" />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="grid min-h-full grid-cols-3 content-start gap-0.5">
                <button
                  type="button"
                  aria-label="Open device camera"
                  onClick={addCameraCapture}
                  className="relative aspect-square overflow-hidden bg-[#292929]"
                >
                  <Camera aria-hidden="true" className="absolute bottom-2 right-2 size-5 text-white drop-shadow" />
                </button>

                {galleryFiles.map((file, index) => {
                  const isVideo = file.type.startsWith("video/");
                  const selected = selectedFiles.includes(file);
                  const preview = mediaPreviews.get(file);
                  return (
                    <button
                      key={`${file.name}-${file.lastModified}-${index}`}
                      type="button"
                      aria-label={`${selected ? "Deselect" : "Select"} ${file.name}`}
                      aria-pressed={selected}
                      onClick={() => toggleMediaSelection(file)}
                      className="relative aspect-square overflow-hidden rounded-lg bg-[#292929] text-left"
                    >
                      {isVideo ? (
                        <video
                          src={preview}
                          muted
                          playsInline
                          preload="metadata"
                          className="size-full object-cover"
                        />
                      ) : (
                        <img
                          src={preview}
                          alt={file.name}
                          className="size-full object-cover"
                        />
                      )}
                      {isVideo && (
                        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-1 text-[10px]">
                          <Film aria-hidden="true" className="size-3" />
                          Video
                        </span>
                      )}
                      <span
                        className={`absolute right-2 top-2 flex size-6 items-center justify-center rounded-full border ${
                          selected
                            ? "border-[#8b5cf6] bg-[#8b5cf6] text-white"
                            : "border-white/90 bg-black/15"
                        }`}
                      >
                        {selected && <Check aria-hidden="true" className="size-4" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              {galleryFiles.length === 0 && (
                <div
                  aria-label="No media selected yet"
                  tabIndex={0}
                  className="min-h-[55vh] outline-none"
                />
              )}
            </div>

            {selectedFiles.length > 0 && (
              <form
                aria-label="Add a caption to the media"
                className="m-2 flex min-h-12 shrink-0 items-center gap-2 rounded-full border border-white/15 bg-[#242424] px-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  finishMediaSelection();
                }}
              >
                <textarea
                  name="media-caption"
                  aria-label="Media caption"
                  placeholder="Add a caption"
                  rows={1}
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  className="max-h-24 min-h-10 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-2.5 text-sm leading-5 text-white outline-none placeholder:text-white/45"
                />
                <button
                  type="submit"
                  aria-label={`Send ${selectedFiles.length} media items`}
                  className="flex size-9 shrink-0 items-center justify-center gap-1 rounded-full bg-[#8b5cf6] px-2 text-white"
                >
                  <span className="text-xs font-semibold">{selectedFiles.length}</span>
                  <Send aria-hidden="true" className="size-4" />
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
