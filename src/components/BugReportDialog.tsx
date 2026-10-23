import { Image, LoaderCircle, Plus, Trash2, Video, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { BugReportMediaPreview } from "./BugReportMediaPreview";
import {
  clearBugReportDraft,
  loadBugReportDraft,
  saveBugReportDescription,
  saveBugReportDraft,
} from "../lib/bug-report-drafts";
import type { AccountRole, AppSupabaseClient } from "../lib/supabase";

const MAX_BUG_REPORT_FILES = 5;
const MAX_BUG_REPORT_FILE_BYTES = 3 * 1024 * 1024;
const MAX_BUG_REPORT_TOTAL_FILE_BYTES = 3.5 * 1024 * 1024;
const SUPPORTED_MEDIA_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/3gpp",
  "video/mp4",
  "video/mpeg",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
]);

type BugReportDialogProps = {
  open: boolean;
  onClose: () => void;
  onDiscard: () => void;
  client: AppSupabaseClient;
  accountUserId: string;
  accountEmail: string | null;
  accountProvider: "google" | "github";
  githubUsername: string | null;
  accountRole: AccountRole;
};

function formatMegabytes(size: number): string {
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function BugReportDialog({
  open,
  onClose,
  onDiscard,
  client,
  accountUserId,
  accountEmail,
  accountProvider,
  githubUsername,
  accountRole,
}: BugReportDialogProps) {
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [filePreviews, setFilePreviews] = useState<Map<File, string>>(() => new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reportWasSentRef = useRef(false);

  useEffect(() => {
    let isActive = true;
    setDraftLoaded(false);
    loadBugReportDraft(accountUserId)
      .then((draft) => {
        if (!isActive) return;
        setDescription(draft?.description ?? "");
        setFiles(draft?.files ?? []);
        setDraftLoaded(true);
      })
      .catch((draftError: unknown) => {
        if (!isActive) return;
        setError(
          draftError instanceof Error
            ? `Could not load the local draft: ${draftError.message}`
            : "Could not load the local bug report draft.",
        );
        setDraftLoaded(true);
      });
    return () => {
      isActive = false;
    };
  }, [accountUserId]);

  useEffect(() => {
    const nextPreviews = new Map<File, string>();
    for (const file of files) nextPreviews.set(file, URL.createObjectURL(file));
    setFilePreviews(nextPreviews);
    return () => {
      for (const url of nextPreviews.values()) URL.revokeObjectURL(url);
    };
  }, [files]);

  useEffect(() => {
    if (!open) return;
    setIsSent(false);
    reportWasSentRef.current = false;
    setError("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSending && !isDiscarding && !previewFile) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isDiscarding, isSending, onClose, open, previewFile]);

  if (!open) return null;

  const previewUrl = previewFile ? filePreviews.get(previewFile) : undefined;

  function persistDraft(nextDescription: string, nextFiles: File[]) {
    if (!draftLoaded || reportWasSentRef.current) return;
    void saveBugReportDraft(accountUserId, { description: nextDescription, files: nextFiles }).catch(
      (draftError: unknown) => {
        setError(
          draftError instanceof Error
            ? `Could not save the local draft: ${draftError.message}`
            : "Could not save the local bug report draft.",
        );
      },
    );
  }

  function persistDescription(nextDescription: string) {
    if (!draftLoaded || reportWasSentRef.current) return;
    void saveBugReportDescription(accountUserId, nextDescription).catch(
      (draftError: unknown) => {
        setError(
          draftError instanceof Error
            ? `Could not save the local draft: ${draftError.message}`
            : "Could not save the local bug report draft.",
        );
      },
    );
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (selectedFiles.length === 0) return;

    let nextFiles = [...files];
    let selectionError = "";
    for (const file of selectedFiles) {
      if (!SUPPORTED_MEDIA_TYPES.has(file.type.toLowerCase())) {
        selectionError = `${file.name}: choose a supported photo or video format.`;
        continue;
      }
      if (file.size > MAX_BUG_REPORT_FILE_BYTES) {
        selectionError =
          `${file.name} is too large. The maximum size is ${formatMegabytes(MAX_BUG_REPORT_FILE_BYTES)} per file.`;
        continue;
      }
      if (nextFiles.length >= MAX_BUG_REPORT_FILES) {
        selectionError = `You can attach up to ${MAX_BUG_REPORT_FILES} photos or videos.`;
        break;
      }
      const nextTotal = nextFiles.reduce((total, current) => total + current.size, 0) + file.size;
      if (nextTotal > MAX_BUG_REPORT_TOTAL_FILE_BYTES) {
        selectionError =
          `The combined media size exceeds ${formatMegabytes(MAX_BUG_REPORT_TOTAL_FILE_BYTES)}. Remove a file or choose smaller media.`;
        continue;
      }
      nextFiles.push(file);
    }
    setError(selectionError);
    setFiles(nextFiles);
    persistDraft(description, nextFiles);
  }

  function removeFile(fileToRemove: File) {
    const nextFiles = files.filter((file) => file !== fileToRemove);
    setFiles(nextFiles);
    persistDraft(description, nextFiles);
    if (previewFile === fileToRemove) setPreviewFile(null);
  }

  async function discardDraft() {
    if (isSending || isDiscarding) return;
    setIsDiscarding(true);
    setError("");
    try {
      await clearBugReportDraft(accountUserId);
      reportWasSentRef.current = false;
      setDescription("");
      setFiles([]);
      setPreviewFile(null);
      setIsSent(false);
      onDiscard();
    } catch (discardError) {
      setError(
        discardError instanceof Error
          ? `Could not clear the local draft: ${discardError.message}`
          : "Could not clear the local bug report draft.",
      );
    } finally {
      setIsDiscarding(false);
    }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending || !draftLoaded) return;
    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setError("Describe the issue before sending the report.");
      return;
    }

    setIsSending(true);
    setError("");
    try {
      const {
        data: { session },
        error: sessionError,
      } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error("Your account session has expired. Sign in again.");

      const body = new FormData();
      body.set("description", trimmedDescription);
      for (const file of files) body.append("media", file, file.name);

      const response = await fetch("/api/bug-report", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "statusMessage" in payload &&
          typeof payload.statusMessage === "string"
            ? payload.statusMessage
            : `Could not send the bug report (${response.status}).`;
        throw new Error(message);
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("sent" in payload) ||
        payload.sent !== true
      ) {
        throw new Error("The bug report service returned an invalid response.");
      }

      reportWasSentRef.current = true;
      setIsSent(true);
      setDescription("");
      setFiles([]);
      try {
        await clearBugReportDraft(accountUserId);
      } catch (draftError) {
        setError(
          draftError instanceof Error
            ? `Report sent, but the local draft could not be removed: ${draftError.message}`
            : "Report sent, but the local draft could not be removed.",
        );
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not send the bug report. Your local draft has been kept.",
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-3 py-5"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isSending && !previewFile) onClose();
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Report a bug"
          className="feedback-construction-frame relative max-h-[min(90dvh,720px)] w-full max-w-[420px] overflow-hidden shadow-[0_20px_56px_rgba(0,0,0,0.22)]"
        >
          <div aria-hidden="true" className="feedback-construction-stripe" />
          <form onSubmit={(event) => void submitReport(event)} className="flex max-h-[calc(min(90dvh,720px)-28px)] flex-col overflow-hidden bg-white">
            <div className="flex shrink-0 items-center justify-between border-b border-[#eceef1] px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-[#24252a]">Report a bug</h2>
                <p className="mt-0.5 text-xs text-[#777a82]">
                  {accountProvider === "github" ? "GitHub" : "Google"} · {accountRole}
                  {githubUsername ? ` · @${githubUsername}` : accountEmail ? ` · ${accountEmail}` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label="Discard bug report draft and close"
                title="Discard draft and close"
                disabled={isSending || isDiscarding}
                onClick={() => void discardDraft()}
                className="flex size-8 items-center justify-center rounded-full text-[#777a82] hover:bg-[#f1f2f4] disabled:opacity-50"
              >
                {isDiscarding ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <X aria-hidden="true" className="size-4" />
                )}
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {isSent ? (
                <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-4 text-sm leading-6 text-emerald-800">
                  Thanks for sending your report to the CheyaAPP team. We appreciate you helping us improve the app.
                </p>
              ) : (
                <>
                  <textarea
                    aria-label="Bug description"
                    placeholder="What happened? What did you expect to happen?"
                    rows={5}
                    value={description}
                    onChange={(event) => {
                      const nextDescription = event.currentTarget.value;
                      setDescription(nextDescription);
                      setError("");
                      persistDescription(nextDescription);
                    }}
                    disabled={!draftLoaded || isSending}
                    className="min-h-32 w-full resize-y rounded-lg border-2 border-[#343434] bg-white px-3 py-2 text-sm leading-5 text-[#252525] outline-none placeholder:text-[#898989] focus:border-[#b58a00] focus:ring-2 focus:ring-[#facc15]/50 disabled:bg-[#f7f7f7]"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    {files.map((file) => {
                      const fileUrl = filePreviews.get(file);
                      const isVideo = file.type.startsWith("video/");
                      return (
                        <div key={`${file.name}:${file.lastModified}:${file.size}`} className="relative aspect-square overflow-hidden rounded-xl border border-[#dedfe3] bg-[#f1f2f4]">
                          <button
                            type="button"
                            aria-label={`Preview ${file.name}`}
                            onClick={() => setPreviewFile(file)}
                            className="flex size-full items-center justify-center"
                          >
                            {fileUrl && isVideo ? (
                              <video src={fileUrl} muted playsInline className="size-full object-cover" />
                            ) : fileUrl ? (
                              <img src={fileUrl} alt={file.name} className="size-full object-cover" />
                            ) : isVideo ? (
                              <Video aria-hidden="true" className="size-7 text-[#737780]" />
                            ) : (
                              <Image aria-hidden="true" className="size-7 text-[#737780]" />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${file.name}`}
                            onClick={() => removeFile(file)}
                            className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                          >
                            <Trash2 aria-hidden="true" className="size-3.5" />
                          </button>
                          <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-1 text-[10px] text-white">
                            {file.name}
                          </span>
                        </div>
                      );
                    })}
                    {files.length < MAX_BUG_REPORT_FILES && (
                      <button
                        type="button"
                        aria-label="Add photos or videos"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!draftLoaded || isSending}
                        className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[#c7c9cf] bg-[#fafafa] text-[#62656d] transition hover:border-[#b58a00] hover:bg-[#fffdf2] disabled:opacity-50"
                      >
                        <Plus aria-hidden="true" className="size-6" />
                        <span className="text-[10px] font-medium">Add media</span>
                      </button>
                    )}
                  </div>
                </>
              )}
              {error && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-800">
                  {error}
                </p>
              )}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-[#eceef1] px-4 py-3">
              <button
                type="button"
                disabled={isSending || isDiscarding}
                onClick={onClose}
                className="h-9 rounded-lg border border-[#4d4b42] bg-white px-3.5 text-xs font-semibold text-[#34332d] hover:bg-[#f5f1df] disabled:opacity-50"
              >
                {isSent ? "Close" : "Cancel"}
              </button>
              {!isSent && (
                <button
                  type="submit"
                  disabled={isSending || !draftLoaded}
                  className="flex h-9 items-center gap-2 rounded-lg border-2 border-[#252525] bg-[#facc15] px-3.5 text-xs font-bold text-[#252525] shadow-[0_2px_0_#252525] transition hover:bg-[#f4bd00] disabled:opacity-50"
                >
                  {isSending && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                  Send report
                </button>
              )}
            </div>
          </form>
          <div aria-hidden="true" className="feedback-construction-stripe" />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/avif,image/gif,image/heic,image/heif,image/jpeg,image/png,image/webp,video/3gpp,video/mp4,video/mpeg,video/quicktime,video/webm,video/x-m4v"
            multiple
            className="sr-only"
            onChange={selectFiles}
          />
        </section>
      </div>

      {previewFile && previewUrl && (
        <BugReportMediaPreview
          file={previewFile}
          src={previewUrl}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </>
  );
}
