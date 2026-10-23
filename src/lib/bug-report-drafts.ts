export type BugReportDraft = {
  description: string;
  files: File[];
};

const BUG_REPORT_DRAFT_DB = "cheyaverse-bug-report-drafts";
const BUG_REPORT_DRAFT_STORE = "drafts";
const BUG_REPORT_MEDIA_STORE = "media";
const pendingDraftWrites = new Map<string, Promise<void>>();

function openBugReportDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BUG_REPORT_DRAFT_DB, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BUG_REPORT_DRAFT_STORE)) {
        database.createObjectStore(BUG_REPORT_DRAFT_STORE, { keyPath: "userId" });
      }
      if (!database.objectStoreNames.contains(BUG_REPORT_MEDIA_STORE)) {
        database.createObjectStore(BUG_REPORT_MEDIA_STORE, { keyPath: "userId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open local bug report drafts."));
    request.onblocked = () =>
      reject(new Error("Local bug report drafts are blocked by another browser tab."));
  });
}

export async function loadBugReportDraft(userId: string): Promise<BugReportDraft | null> {
  const database = await openBugReportDraftDatabase();
  try {
    return await new Promise<BugReportDraft | null>((resolve, reject) => {
      const transaction = database.transaction(
        [BUG_REPORT_DRAFT_STORE, BUG_REPORT_MEDIA_STORE],
        "readonly",
      );
      const draftRequest = transaction.objectStore(BUG_REPORT_DRAFT_STORE).get(userId);
      const mediaRequest = transaction.objectStore(BUG_REPORT_MEDIA_STORE).get(userId);
      transaction.oncomplete = () => {
        const draft: unknown = draftRequest.result;
        const media: unknown = mediaRequest.result;
        const description =
          typeof draft === "object" &&
          draft !== null &&
          "description" in draft &&
          typeof draft.description === "string"
            ? draft.description
            : "";
        const storedFiles =
          typeof media === "object" &&
          media !== null &&
          "files" in media &&
          Array.isArray(media.files)
            ? media.files
            : typeof draft === "object" &&
                draft !== null &&
                "files" in draft &&
                Array.isArray(draft.files)
              ? draft.files
              : [];
        const files = storedFiles.filter((file): file is File => file instanceof File);
        resolve(description || files.length > 0 ? { description, files } : null);
      };
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not load the local bug report draft."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Loading the local bug report draft was aborted."));
    });
  } finally {
    database.close();
  }
}

export async function saveBugReportDraft(
  userId: string,
  draft: BugReportDraft,
): Promise<void> {
  await queueDraftWrite(userId, async () => {
    const database = await openBugReportDraftDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          [BUG_REPORT_DRAFT_STORE, BUG_REPORT_MEDIA_STORE],
          "readwrite",
        );
        transaction.objectStore(BUG_REPORT_DRAFT_STORE).put({
          userId,
          description: draft.description,
          updatedAt: Date.now(),
        });
        transaction.objectStore(BUG_REPORT_MEDIA_STORE).put({
          userId,
          files: draft.files,
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("Could not save the local bug report draft."));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("Saving the local bug report draft was aborted."));
      });
    } finally {
      database.close();
    }
  });
}

export async function saveBugReportDescription(
  userId: string,
  description: string,
): Promise<void> {
  await queueDraftWrite(userId, async () => {
    const database = await openBugReportDraftDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(BUG_REPORT_DRAFT_STORE, "readwrite");
        transaction.objectStore(BUG_REPORT_DRAFT_STORE).put({
          userId,
          description,
          updatedAt: Date.now(),
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("Could not save the local bug report draft."));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("Saving the local bug report draft was aborted."));
      });
    } finally {
      database.close();
    }
  });
}

async function queueDraftWrite(userId: string, write: () => Promise<void>): Promise<void> {
  const previousWrite = pendingDraftWrites.get(userId) ?? Promise.resolve();
  const nextWrite = previousWrite.catch(() => {}).then(write);
  pendingDraftWrites.set(userId, nextWrite);
  try {
    await nextWrite;
  } finally {
    if (pendingDraftWrites.get(userId) === nextWrite) pendingDraftWrites.delete(userId);
  }
}

export async function clearBugReportDraft(userId: string): Promise<void> {
  await pendingDraftWrites.get(userId)?.catch(() => {});
  const database = await openBugReportDraftDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [BUG_REPORT_DRAFT_STORE, BUG_REPORT_MEDIA_STORE],
        "readwrite",
      );
      transaction.objectStore(BUG_REPORT_DRAFT_STORE).delete(userId);
      transaction.objectStore(BUG_REPORT_MEDIA_STORE).delete(userId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not clear the local bug report draft."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Clearing the local bug report draft was aborted."));
    });
  } finally {
    database.close();
  }
}
