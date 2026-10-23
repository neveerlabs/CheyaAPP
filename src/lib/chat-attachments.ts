export const CHAT_ATTACHMENT_BUCKET = "chat-attachments";
export const MAX_CHAT_ATTACHMENT_BYTES = 18 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENT_SOURCE_BYTES = MAX_CHAT_ATTACHMENT_BYTES;
export const MAX_CHAT_ATTACHMENT_COUNT = 10;
export const MAX_CHAT_MESSAGE_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const CHAT_ATTACHMENT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MAX_GEMINI_CONTEXT_ATTACHMENTS = 10;
export const VOICE_NOTE_TRANSCRIPT_MARKER = "Voice note transcript:\n";

const MIME_BY_EXTENSION: Record<string, string> = {
  c: "text/plain",
  cc: "text/plain",
  avi: "video/x-msvideo",
  cfg: "text/plain",
  conf: "text/plain",
  cpp: "text/plain",
  cs: "text/plain",
  css: "text/plain",
  csv: "text/csv",
  flac: "audio/flac",
  gif: "image/gif",
  go: "text/plain",
  heic: "image/heic",
  heif: "image/heif",
  h: "text/plain",
  hpp: "text/plain",
  htm: "text/html",
  html: "text/html",
  ini: "text/plain",
  java: "text/plain",
  js: "text/plain",
  jsx: "text/plain",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  log: "text/plain",
  m4a: "audio/mp4",
  md: "text/markdown",
  mkv: "video/x-matroska",
  mjs: "text/plain",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  php: "text/plain",
  py: "text/plain",
  png: "image/png",
  rb: "text/plain",
  rs: "text/plain",
  sh: "text/plain",
  sql: "text/plain",
  toml: "text/plain",
  ts: "text/plain",
  tsx: "text/plain",
  txt: "text/plain",
  xml: "application/xml",
  yaml: "text/plain",
  yml: "text/plain",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
};

export const CHAT_ATTACHMENT_MIME_TYPES = [...Object.values(MIME_BY_EXTENSION), "audio/webm"];

export function resolveChatAttachmentMimeType(file: Pick<File, "name" | "type">): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const inferred = MIME_BY_EXTENSION[extension];
  const mimeType = file.type.trim().toLowerCase().split(";")[0].trim();
  if (!mimeType || mimeType === "application/octet-stream") return inferred ?? null;
  if (mimeType === "text/x-markdown") return "text/markdown";
  if (mimeType === "image/jpg") return "image/jpeg";
  if (CHAT_ATTACHMENT_MIME_TYPES.includes(mimeType)) return mimeType;
  if (inferred === "text/plain" && /^(text\/|application\/)/.test(mimeType)) {
    return inferred;
  }
  return null;
}

export type ChatAttachment = {
  id: string;
  user_id: string;
  message_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  expires_at: string;
  deleted_at: string | null;
}

export type ChatAttachmentRegistration = {
  uploadRequired: boolean;
  reused: boolean;
  attachment?: ChatAttachment;
  storagePath?: string;
}

export async function getChatAttachmentIdentityHash(
  file: File,
  mimeType: string,
): Promise<string> {
  let bytes: ArrayBuffer;
  if (mimeType.startsWith("image/")) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error(`Could not read photo "${file.name}" to identify duplicates.`);
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("This browser could not identify duplicate photos.");
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const canonicalPixels = new Uint8Array(8 + pixels.length);
      new DataView(canonicalPixels.buffer).setUint32(0, canvas.width);
      new DataView(canonicalPixels.buffer).setUint32(4, canvas.height);
      canonicalPixels.set(pixels, 8);
      bytes = canonicalPixels.buffer;
    } finally {
      bitmap.close();
    }
  } else {
    bytes = await file.arrayBuffer();
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type ChatAttachmentDraft = {
  id: string;
  userId: string;
  file: File;
  mimeType: string;
  savedAt: number;
  identitySha256?: string;
  processingStage?: "ai" | "upload";
}

const CHAT_ATTACHMENT_DRAFT_DB = "cheyaverse-chat-attachment-drafts";
const CHAT_ATTACHMENT_DRAFT_STORE = "drafts";

function openChatAttachmentDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CHAT_ATTACHMENT_DRAFT_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CHAT_ATTACHMENT_DRAFT_STORE)) {
        database.createObjectStore(CHAT_ATTACHMENT_DRAFT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local attachment drafts."));
    request.onblocked = () => reject(new Error("Local attachment drafts are blocked by another browser tab."));
  });
}

function draftKey(userId: string, id: string): string {
  return `${userId}:${id}`;
}

export async function saveChatAttachmentDraft(
  userId: string,
  id: string,
  file: File,
  mimeType: string,
  savedAt = Date.now(),
  processing: Pick<ChatAttachmentDraft, "identitySha256" | "processingStage"> = {},
): Promise<void> {
  const database = await openChatAttachmentDraftDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(CHAT_ATTACHMENT_DRAFT_STORE, "readwrite");
      transaction.objectStore(CHAT_ATTACHMENT_DRAFT_STORE).put({
        key: draftKey(userId, id),
        id,
        userId,
        file,
        mimeType,
        savedAt,
        ...processing,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not save the local attachment draft."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Saving the local attachment draft was aborted."));
    });
  } finally {
    database.close();
  }
}

export async function loadChatAttachmentDrafts(userId: string): Promise<ChatAttachmentDraft[]> {
  const database = await openChatAttachmentDraftDatabase();
  try {
    return await new Promise<ChatAttachmentDraft[]>((resolve, reject) => {
      const request = database
        .transaction(CHAT_ATTACHMENT_DRAFT_STORE, "readonly")
        .objectStore(CHAT_ATTACHMENT_DRAFT_STORE)
        .getAll();
      request.onsuccess = () => {
        const records = request.result as Array<{
          id: string;
          userId: string;
          file: File;
          mimeType: string;
          savedAt: number;
          identitySha256?: string;
          processingStage?: "ai" | "upload";
        }>;
        resolve(
          records
            .filter(
              (record) =>
                record.userId === userId &&
                record.file instanceof File &&
                typeof record.mimeType === "string",
            )
            .map(({ id, userId: recordUserId, file, mimeType, savedAt, identitySha256, processingStage }) => ({
              id,
              userId: recordUserId,
              file,
              mimeType,
              savedAt,
              identitySha256,
              processingStage,
            }))
            .sort((first, second) => first.savedAt - second.savedAt),
        );
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Could not load local attachment drafts."));
    });
  } finally {
    database.close();
  }
}

export async function removeChatAttachmentDraft(userId: string, id: string): Promise<void> {
  const database = await openChatAttachmentDraftDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(CHAT_ATTACHMENT_DRAFT_STORE, "readwrite");
      transaction.objectStore(CHAT_ATTACHMENT_DRAFT_STORE).delete(draftKey(userId, id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not remove the local attachment draft."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Removing the local attachment draft was aborted."));
    });
  } finally {
    database.close();
  }
}

export function isChatAttachmentExpired(attachment: Pick<ChatAttachment, "expires_at" | "deleted_at">) {
  return Boolean(attachment.deleted_at) || Date.parse(attachment.expires_at) <= Date.now();
}

export function formatChatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
