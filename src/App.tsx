import {
  AudioLines,
  BadgeCheck,
  Bell,
  Brain,
  Bug,
  Camera,
  Files,
  Image,
  LoaderCircle,
  Mic,
  Plus,
  X,
  Settings,
  Send,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import avatarUrl from "../assets/cheyaverse.jpg";
import { generateGeminiReply, GeminiFailoverError } from "./lib/gemini";
import type { AppSupabaseClient } from "./lib/supabase";

const SettingsPage = lazy(() =>
  import("./SettingsPage").then((module) => ({ default: module.SettingsPage })),
);

const headerActions = [
  { label: "Report a problem", icon: Bug },
  { label: "Settings", icon: Settings },
];
const MAX_ATTACHMENTS = 10;

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
}

interface AttachmentView {
  index: number;
  mode: "media" | "editor";
}

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

export function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [isMediaMenuOpen, setIsMediaMenuOpen] = useState(false);
  const [attachedMedia, setAttachedMedia] = useState<File[]>([]);
  const [attachmentView, setAttachmentView] = useState<AttachmentView | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorError, setEditorError] = useState("");
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [viewport, setViewport] = useState({ height: 0, top: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const cameraCaptureInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const nextApiIndexRef = useRef(0);
  const nextMessageIdRef = useRef(0);
  const attachmentViewRequestRef = useRef(0);
  const wasSettingsRef = useRef(window.location.pathname === "/settings");
  const hasMessage = message.trim().length > 0 || attachedMedia.length > 0;
  const mediaPreviews = useMemo(
    () =>
      new Map(
        attachedMedia
          .filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"))
          .map((file) => [file, URL.createObjectURL(file)]),
      ),
    [attachedMedia],
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
    if (window.location.pathname === "/settings") {
      window.history.pushState({ appRoute: "settings-direct-back-guard" }, "", "/settings");
    }

    const handlePopState = () => {
      if (wasSettingsRef.current) {
        if (window.location.pathname === "/settings") {
          window.location.replace("/");
        } else {
          window.location.reload();
        }
        return;
      }

      const nextPath = window.location.pathname;
      wasSettingsRef.current = nextPath === "/settings";
      setPathname(nextPath);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(path: string) {
    if (path === "/settings") {
      window.history.pushState({ appRoute: "settings" }, "", path);
      wasSettingsRef.current = true;
    } else {
      window.location.replace(path);
      return;
    }
    setPathname(path);
  }

  function addPickedFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    const availableSlots = Math.max(0, MAX_ATTACHMENTS - attachedMedia.length);
    const acceptedFiles = files.slice(0, availableSlots);
    if (acceptedFiles.length > 0) {
      setAttachedMedia((current) => [...current, ...acceptedFiles]);
    }
    if (acceptedFiles.length < files.length) {
      const rejectedCount = files.length - acceptedFiles.length;
      setSendError(
        availableSlots === 0
          ? `You can attach up to ${MAX_ATTACHMENTS} files. Remove an attachment before adding more.`
          : `Only ${MAX_ATTACHMENTS} files can be attached at once. ${rejectedCount} ${rejectedCount === 1 ? "file was" : "files were"} not added.`,
      );
    } else {
      setSendError("");
    }
  }

  function removeAttachedFile(indexToRemove: number) {
    setAttachedMedia((files) => files.filter((_, index) => index !== indexToRemove));
  }

  async function openAttachment(index: number) {
    const file = attachedMedia[index];
    if (!file) return;

    const requestId = ++attachmentViewRequestRef.current;
    const isMedia = file.type.startsWith("image/") || file.type.startsWith("video/");
    setAttachmentView({ index, mode: isMedia ? "media" : "editor" });
    setEditorContent("");
    setEditorError("");

    if (isMedia) return;

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (
      file.type.startsWith("text/") ||
      /\/(json|javascript|xml|x-sql|x-yaml)$/.test(file.type) ||
      textFileExtensions.has(extension)
    ) {
      setIsEditorLoading(true);
      try {
        const content = await file.text();
        if (content.includes("\0")) {
          setEditorError("This file contains binary data and cannot be edited as text.");
        } else if (requestId === attachmentViewRequestRef.current) {
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

    if (binaryFileExtensions.has(extension) || file.type.startsWith("application/")) {
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
    if (window.history.state?.attachmentView) {
      window.history.back();
    } else {
      attachmentViewRequestRef.current += 1;
      setAttachmentView(null);
      setIsEditorLoading(false);
    }
  }

  function commitFileEdit() {
    if (!attachmentView || attachmentView.mode !== "editor") return;

    const originalFile = attachedMedia[attachmentView.index];
    if (originalFile && !editorError && !isEditorLoading) {
      const editedFile = new File([editorContent], originalFile.name, {
        type: originalFile.type || "text/plain",
        lastModified: Date.now(),
      });
      setAttachedMedia((files) =>
        files.map((file, index) => (index === attachmentView.index ? editedFile : file)),
      );
    }
    closeAttachmentView();
  }

  function formatFileSize(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fileExtension(file: File): string {
    const extension = file.name.split(".").pop();
    return extension && extension !== file.name ? extension.slice(0, 5).toUpperCase() : "FILE";
  }

  function fileTileColor(file: File): string {
    const extension = fileExtension(file).toLowerCase();
    if (["py", "js", "ts", "tsx", "jsx", "html", "css", "json"].includes(extension)) {
      return "bg-[#eaf2ff] text-[#3972bb]";
    }
    if (["txt", "md", "log", "csv"].includes(extension)) {
      return "bg-[#edf7ee] text-[#43834c]";
    }
    if (["pdf"].includes(extension)) return "bg-[#fff0ed] text-[#c25b4f]";
    if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) {
      return "bg-[#fff4dc] text-[#a67518]";
    }
    return "bg-[#f1edff] text-[#7357ba]";
  }

  async function sendMessage() {
    const prompt = message.trim();
    if (!prompt) {
      setSendError("Write a message before sending it to Gemini.");
      return;
    }

    setSendError("");
    setIsSending(true);
    let client: AppSupabaseClient | null = null;
    let saveStatus: typeof import("./lib/supabase").saveApiStatus | null = null;

    try {
      const { createSupabaseClient, loadDatabaseConfig, saveApiStatus } = await import(
        "./lib/supabase"
      );
      saveStatus = saveApiStatus;
      const config = loadDatabaseConfig();
      if (!config) {
        throw new Error("Connect your own Supabase project in Settings before using chat.");
      }
      client = createSupabaseClient(config);

      const {
        data: { session },
        error: sessionError,
      } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) {
        throw new Error("Sign in to your Supabase account in Settings before using chat.");
      }

      const { data: keys, error: keysError } = await client
        .from("ai_api_keys")
        .select("id, model, api_key, status, last_error, created_at")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (keysError) throw keysError;
      if (keys.length === 0) {
        throw new Error("Add at least one Gemini API key in Settings before sending a message.");
      }

      const result = await generateGeminiReply(keys, prompt, nextApiIndexRef.current);
      nextApiIndexRef.current = (result.keyIndex + 1) % keys.length;
      const statusErrors: string[] = [];
      for (const attempt of result.attempts) {
        try {
          await saveStatus(client, attempt);
        } catch (error) {
          statusErrors.push(error instanceof Error ? error.message : "Could not save API status.");
        }
      }

      const userMessageId = nextMessageIdRef.current++;
      const responseMessageId = nextMessageIdRef.current++;
      setMessages((current) => [
        ...current,
        { id: userMessageId, role: "user", text: prompt },
        { id: responseMessageId, role: "assistant", text: result.text },
      ]);
      setMessage("");
      setAttachedMedia([]);
      if (messageInputRef.current) messageInputRef.current.style.height = "52px";
      if (statusErrors.length > 0) {
        setSendError(`Reply received, but API status could not be saved: ${statusErrors.join("; ")}`);
      }
    } catch (error) {
      let detail = error instanceof Error ? error.message : "An unexpected error occurred.";
      if (client && saveStatus && error instanceof GeminiFailoverError) {
        const statusErrors: string[] = [];
        for (const attempt of error.attempts) {
          try {
            await saveStatus(client, attempt);
          } catch (statusError) {
            statusErrors.push(
              statusError instanceof Error ? statusError.message : "Could not save API status.",
            );
          }
        }
        if (statusErrors.length > 0) {
          detail += `\nAPI status could not be saved: ${statusErrors.join("; ")}`;
        }
      }
      setSendError(detail);
    } finally {
      setIsSending(false);
    }
  }

  if (pathname === "/settings") {
    return (
      <Suspense
        fallback={
          <main className="fixed inset-0 flex items-center justify-center bg-white text-sm text-[#777a81]">
            Loading settings…
          </main>
        }
      >
        <SettingsPage onBack={() => navigate("/")} />
      </Suspense>
    );
  }

  const viewedFile = attachmentView ? attachedMedia[attachmentView.index] : undefined;
  const editorLines = editorContent.split(/\r\n|\r|\n/);
  const longestEditorLine = editorLines.reduce((longest, line) => Math.max(longest, line.length), 0);

  if (attachmentView && viewedFile) {
    const previewUrl = mediaPreviews.get(viewedFile);
    const isMediaView = attachmentView.mode === "media";
    const editorWidth = `calc(${Math.max(40, longestEditorLine)}ch + 1.5rem)`;
    const editorHeight = `${Math.max(100, editorLines.length * 24 + 32)}px`;

    return (
      <main
        aria-label={isMediaView ? `Preview: ${viewedFile.name}` : `Edit: ${viewedFile.name}`}
        className={`fixed inset-0 z-40 flex flex-col ${
          isMediaView ? "cursor-zoom-out bg-black" : "bg-white text-[#24252a]"
        }`}
        onClick={isMediaView ? closeAttachmentView : undefined}
      >
        {isMediaView ? (
          viewedFile.type.startsWith("video/") && previewUrl ? (
            <video
              src={previewUrl}
              aria-label={viewedFile.name}
              autoPlay
              muted
              loop
              playsInline
              className="size-full object-contain"
            />
          ) : previewUrl ? (
            <img
              src={previewUrl}
              alt={viewedFile.name}
              className="size-full select-none object-contain"
              draggable={false}
            />
          ) : null
        ) : (
          <>
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
                disabled={isEditorLoading}
                onClick={commitFileEdit}
                className="absolute bottom-[max(16px,env(safe-area-inset-bottom))] right-4 flex h-10 items-center justify-center rounded-full border border-[#e5e6e9] bg-white px-5 text-sm font-medium text-[#27282d] shadow-md transition hover:bg-[#f7f8fa] disabled:opacity-50"
              >
                Commit
              </button>
            </section>
          </>
        )}
      </main>
    );
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

        <div
          aria-label="Conversation"
          aria-live="polite"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
        >
          {messages.map((chatMessage) => (
            <div
              key={chatMessage.id}
              className={`flex ${chatMessage.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <p
                className={`max-w-[88%] whitespace-pre-wrap rounded-[20px] px-4 py-3 text-sm leading-6 ${
                  chatMessage.role === "user"
                    ? "rounded-br-md bg-[#28292e] text-white"
                    : "rounded-bl-md bg-[#f2f3f5] text-[#27282d]"
                }`}
              >
                {chatMessage.text}
              </p>
            </div>
          ))}
          {isSending && (
            <p role="status" className="text-sm text-[#858890]">
              Gemini is thinking…
            </p>
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

        <footer className="shrink-0 bg-white px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5 sm:px-5 sm:pb-5">
          {attachedMedia.length > 0 && (
            <div
              aria-label="Files ready to upload"
              className="mb-2 grid max-w-full grid-flow-col auto-cols-[76px] gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain px-1 pb-1 pt-1 sm:auto-cols-[84px]"
            >
              {attachedMedia.map((file, index) => {
                const isPreviewable =
                  file.type.startsWith("image/") || file.type.startsWith("video/");
                const preview = mediaPreviews.get(file);

                return (
                  <article
                    key={`${file.name}-${file.lastModified}-${index}`}
                    aria-label={`Attached file: ${file.name}`}
                    className="relative aspect-square min-w-0 overflow-hidden rounded-xl border border-[#e5e6e9] bg-[#f4f5f7]"
                    title={file.name}
                  >
                    <button
                      type="button"
                      aria-label={`Open ${file.name}`}
                      onClick={() => void openAttachment(index)}
                      className="absolute inset-0 flex size-full items-center justify-center overflow-hidden text-left"
                    >
                      {isPreviewable && preview ? (
                        file.type.startsWith("video/") ? (
                          <video
                            src={preview}
                            muted
                            loop
                            autoPlay
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
                        <div
                          className={`flex size-full items-center justify-center ${fileTileColor(file)}`}
                        >
                          <span className="max-w-full truncate px-1 text-center text-[11px] font-bold tracking-wide">
                            {fileExtension(file)}
                          </span>
                        </div>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      title={`Remove ${file.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeAttachedFile(index);
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
                  aria-label="Think"
                  className="flex h-10 items-center gap-2 rounded-full border border-[#e5e6e9] bg-white px-3.5 text-sm font-medium text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
                >
                  <Brain aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
                  <span>Think</span>
                </button>
                {hasMessage ? (
                  <button
                    type="button"
                    aria-label="Send message"
                    onClick={sendMessage}
                    disabled={isSending}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
                  >
                    {isSending ? (
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
      <input
        ref={cameraCaptureInputRef}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        aria-label="Capture a photo or video"
        className="sr-only"
        onChange={(event) => {
          addPickedFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
    </main>
  );
}
