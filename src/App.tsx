import {
  AudioLines,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bell,
  Brain,
  Bug,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Files,
  Image,
  LoaderCircle,
  Mic,
  Pencil,
  Plus,
  RotateCw,
  X,
  Settings,
  Send,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import avatarUrl from "../assets/cheyaverse.jpg";
import { AccountLogin } from "./AccountLogin";
import {
  analyzeGeminiMessage,
  generateThinkingSummary,
  generateGeminiConversation,
  GeminiFailoverError,
  type GeminiAttempt,
} from "./lib/gemini";
import type { AppSupabaseClient, ChatMessageVersion } from "./lib/supabase";

const SettingsPage = lazy(() =>
  import("./SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const AssistantMarkdown = lazy(() =>
  import("./components/AssistantMarkdown").then((module) => ({
    default: module.AssistantMarkdown,
  })),
);

const headerActions = [
  { label: "Report a problem", icon: Bug },
  { label: "Settings", icon: Settings },
];
const MAX_ATTACHMENTS = 10;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  versionNumber: number;
  thinkingSummary: string | null;
}

interface AttachmentView {
  index: number;
  mode: "media" | "editor";
}

interface DeleteConfirmation {
  label: string;
  preview: string;
}

interface ReportTarget {
  id: string;
  versionNumber: number;
  text: string;
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

export function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [authClient, setAuthClient] = useState<AppSupabaseClient | null>(null);
  const [authUser, setAuthUser] = useState<{ id: string; email: string | null } | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageVersions, setMessageVersions] = useState<Record<string, ChatMessageVersion[]>>({});
  const [selectedMessageVersions, setSelectedMessageVersions] = useState<Record<string, number>>({});
  const [isSending, setIsSending] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasGeminiApiKey, setHasGeminiApiKey] = useState(false);
  const [isThinkMode, setIsThinkMode] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(() => new Set());
  const [ratings, setRatings] = useState<Record<string, AssistantRating>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [reportDetails, setReportDetails] = useState("");
  const [reportError, setReportError] = useState("");
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [userEditTarget, setUserEditTarget] = useState<string | null>(null);
  const [userEditText, setUserEditText] = useState("");
  const [activeUserActions, setActiveUserActions] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);
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
  const attachmentViewRequestRef = useRef(0);
  const deleteConfirmationResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    return (
      messageVersions[chatMessage.id]?.find((item) => item.version_number === versionNumber)
        ?.content ?? chatMessage.text
    );
  }

  function displayedThinkingSummary(chatMessage: ChatMessage): string | null {
    const versionNumber = displayedVersionNumber(chatMessage);
    return (
      messageVersions[chatMessage.id]?.find((item) => item.version_number === versionNumber)
        ?.thinking_summary ?? chatMessage.thinkingSummary
    );
  }

  function setMessageVersion(chatMessage: ChatMessage, direction: -1 | 1) {
    const versions = messageVersions[chatMessage.id] ?? [];
    if (versions.length < 2) return;
    const currentNumber = displayedVersionNumber(chatMessage);
    const currentIndex = versions.findIndex((item) => item.version_number === currentNumber);
    const nextVersion = versions[currentIndex + direction];
    if (nextVersion) {
      setSelectedMessageVersions((current) => ({
        ...current,
        [chatMessage.id]: nextVersion.version_number,
      }));
    }
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

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
      } = client.auth.onAuthStateChange((_event, session) => {
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
    if (!authClient || !authUser) {
      setIsLoadingHistory(false);
      setMessages([]);
      setMessageVersions({});
      setSelectedMessageVersions({});
      setRatings({});
      setHasGeminiApiKey(false);
      return;
    }

    let isMounted = true;
    setIsLoadingHistory(true);
    void (async () => {
      try {
        const { loadMessageVersions, loadRecentChatMessages } = await import("./lib/chat-data");
        const [savedMessages, keyResult] = await Promise.all([
          loadRecentChatMessages(authClient),
          authClient
            .from("ai_api_keys")
            .select("id")
            .order("created_at", { ascending: true })
            .limit(1),
        ]);
        if (keyResult.error) throw keyResult.error;
        const loadedVersions = await loadMessageVersions(
          authClient,
          savedMessages.map((item) => item.id),
        );
        const assistantMessages = savedMessages.filter((item) => item.role === "assistant");
        const loadedRatings: Record<string, AssistantRating> = {};
        if (assistantMessages.length > 0) {
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
          feedback.forEach((item) => {
            if (item.kind === "like" || item.kind === "dislike") {
              loadedRatings[`${item.message_id}:${item.version_number}`] = item.kind;
            }
          });
        }
        if (isMounted) {
          setHasGeminiApiKey(keyResult.data.length > 0);
          setRatings(loadedRatings);
          setMessageVersions(loadedVersions);
          setSelectedMessageVersions(
            Object.fromEntries(savedMessages.map((item) => [item.id, item.version_number])),
          );
          setMessages(
            savedMessages.map(({ id, role, content, version_number, thinking_summary }) => ({
              id,
              role,
              text: content,
              versionNumber: version_number,
              thinkingSummary: thinking_summary,
            })),
          );
        }
      } catch (error) {
        if (isMounted) {
          setSendError(
            error instanceof Error ? error.message : "Could not load saved chat history.",
          );
        }
      } finally {
        if (isMounted) setIsLoadingHistory(false);
      }
    })();

    return () => {
      isMounted = false;
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
    if (window.location.pathname.startsWith("/settings/")) {
      const sectionPath = window.location.pathname;
      window.history.replaceState({ appRoute: "settings" }, "", "/settings");
      window.history.pushState({ appRoute: "settings-subpage" }, "", sectionPath);
    } else if (window.location.pathname === "/settings") {
      window.history.pushState({ appRoute: "settings-direct-back-guard" }, "", "/settings");
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

      setPathname(nextPath);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(path: string) {
    if (path.startsWith("/settings")) {
      window.history.pushState(
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
    if (!authUser) {
      setSendError("Sign in with Google before starting a chat.");
      return;
    }
    if (!hasGeminiApiKey) {
      setSendError("Add a Gemini API key in Settings → Configure before using chat.");
      return;
    }
    const prompt = message.trim();
    if (!prompt) {
      setSendError("Write a message before sending it.");
      return;
    }
    if (prompt.length > 50000) {
      setSendError("Messages must be 50,000 characters or fewer.");
      return;
    }

    setSendError("");
    setActionNotice("");
    setIsSending(true);
    const showThinking = isThinkMode;
    setThinkingSteps(showThinking ? ["Membaca pesan dan konteks percakapan…"] : []);
    let client: AppSupabaseClient | null = null;
    let saveStatus: typeof import("./lib/supabase").saveApiStatus | null = null;
    const attempts: GeminiAttempt[] = [];
    const warnings: string[] = [];
    let savedUserMessage: ChatMessage | null = null;

    try {
      const {
        createSupabaseClient,
        DEFAULT_PERSONALIZATION,
        ensureSupabaseSession,
        loadDatabaseConfig,
        saveApiStatus,
      } = await import("./lib/supabase");
      const {
        createEmbedding,
        executeChatDataTool,
        findRelevantContext,
        loadMessageVersions,
        loadRecentAssistantFeedback,
        loadRecentChatMessages,
        loadRecentInsights,
        saveChatMessage,
        saveMessageInsight,
      } = await import("./lib/chat-data");
      saveStatus = saveApiStatus;
      const config = loadDatabaseConfig();
      if (!config) {
        throw new Error("The CheyaVerse account service is not configured for this deployment.");
      }
      client = createSupabaseClient(config);
      await ensureSupabaseSession(client);

      const { data: keys, error: keysError } = await client
        .from("ai_api_keys")
        .select("id, model, api_key, status, last_error, created_at")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (keysError) throw keysError;
      if (keys.length === 0) {
        throw new Error("Add at least one Gemini API key in Settings before sending a message.");
      }

      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("The private Supabase session has no user ID.");

      const { data: profile, error: profileError } = await client
        .from("user_settings")
        .select("display_name, custom_prompt, chat_style")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profileError) {
        throw new Error(
          `Could not load Personal settings. The CheyaVerse database may need the latest supabase/schema.sql. ${profileError.message}`,
        );
      }

      const selectedIndex = ((nextApiIndexRef.current % keys.length) + keys.length) % keys.length;
      const selectedKey = keys[selectedIndex];
      if (showThinking) setThinkingSteps(["Memuat riwayat dan preferensi percakapan…"]);
      const history = await loadRecentChatMessages(client, 20);
      let recentFeedback: Array<{
        rating: AssistantRating;
        response: string;
        versionNumber: number;
      }> = [];
      try {
        recentFeedback = await loadRecentAssistantFeedback(
          client,
          history.filter((item) => item.role === "assistant").map((item) => item.id),
        );
      } catch (error) {
        warnings.push(
          `Saved response feedback could not be loaded: ${
            error instanceof Error ? error.message : "Unknown database error."
          }`,
        );
      }
      let userEmbedding: number[] | null = null;
      try {
        userEmbedding = await createEmbedding(selectedKey.api_key, prompt, "RETRIEVAL_DOCUMENT");
      } catch (error) {
        warnings.push(
          `The message will be saved without a searchable embedding: ${
            error instanceof Error ? error.message : "Could not create an embedding."
          }`,
        );
      }

      const persistedUserMessage = await saveChatMessage(client, "user", prompt, userEmbedding);
      const newUserMessage = {
        id: persistedUserMessage.id,
        role: persistedUserMessage.role,
        text: persistedUserMessage.content,
        versionNumber: persistedUserMessage.version_number,
        thinkingSummary: persistedUserMessage.thinking_summary,
      };
      setMessageVersions((current) => ({
        ...current,
        [persistedUserMessage.id]: [
          {
            id: "",
            user_id: persistedUserMessage.user_id,
            message_id: persistedUserMessage.id,
            version_number: persistedUserMessage.version_number,
            content: persistedUserMessage.content,
            embedding: null,
            thinking_summary: persistedUserMessage.thinking_summary,
            revision_reason: "initial",
            created_at: persistedUserMessage.created_at,
          },
        ],
      }));
      setSelectedMessageVersions((current) => ({
        ...current,
        [persistedUserMessage.id]: persistedUserMessage.version_number,
      }));
      savedUserMessage = newUserMessage;
      setMessages((current) => [...current, newUserMessage]);
      setMessage("");
      setAttachedMedia([]);
      if (messageInputRef.current) messageInputRef.current.style.height = "52px";
      if (showThinking) {
        setThinkingSteps([
          "Memuat riwayat dan preferensi percakapan…",
          "Menganalisis pesan dan mencari konteks yang relevan…",
        ]);
      }

      let currentInsight:
        | Awaited<ReturnType<typeof analyzeGeminiMessage>>["insight"]
        | undefined;
      let queryEmbedding: number[] | null = null;
      let insights: Awaited<ReturnType<typeof loadRecentInsights>> = [];
      const [analysisResult, queryEmbeddingResult, insightsResult] = await Promise.allSettled([
        analyzeGeminiMessage(keys, prompt, selectedIndex),
        createEmbedding(selectedKey.api_key, prompt, "RETRIEVAL_QUERY"),
        loadRecentInsights(client, 12, persistedUserMessage.id),
      ]);

      if (analysisResult.status === "fulfilled") {
        const analysis = analysisResult.value;
        attempts.push(...analysis.attempts);
        currentInsight = analysis.insight;
        nextApiIndexRef.current = (analysis.keyIndex + 1) % keys.length;
      } else {
        if (analysisResult.reason instanceof GeminiFailoverError) {
          attempts.push(...analysisResult.reason.attempts);
        }
        warnings.push(
          `Message insight was not saved: ${
            analysisResult.reason instanceof Error
              ? analysisResult.reason.message
              : "Unknown analysis error."
          }`,
        );
      }

      if (queryEmbeddingResult.status === "fulfilled") {
        queryEmbedding = queryEmbeddingResult.value;
      } else {
        warnings.push(
          `Semantic history search is unavailable: ${
            queryEmbeddingResult.reason instanceof Error
              ? queryEmbeddingResult.reason.message
              : "Could not create a retrieval query."
          }`,
        );
      }
      if (insightsResult.status === "fulfilled") {
        insights = insightsResult.value;
      } else {
        warnings.push(
          `Conversation insight lookup failed: ${
            insightsResult.reason instanceof Error
              ? insightsResult.reason.message
              : "Unknown database error."
          }`,
        );
      }

      let relevantMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
      let memories: Array<{ category: string; content: string }> = [];
      const contextResults = await Promise.allSettled([
        queryEmbedding
          ? findRelevantContext(client, queryEmbedding, persistedUserMessage.id)
          : Promise.resolve(null),
        currentInsight
          ? saveMessageInsight(client, persistedUserMessage.id, currentInsight)
          : Promise.resolve(),
      ]);
      if (contextResults[0].status === "fulfilled" && contextResults[0].value) {
        relevantMessages = contextResults[0].value.messages;
        memories = contextResults[0].value.memories;
      } else if (contextResults[0].status === "rejected") {
        warnings.push(
          `Semantic history lookup failed: ${
            contextResults[0].reason instanceof Error
              ? contextResults[0].reason.message
              : "Unknown retrieval error."
          }`,
        );
      }
      if (contextResults[1].status === "rejected") {
        warnings.push(
          `Message insight was not saved: ${
            contextResults[1].reason instanceof Error
              ? contextResults[1].reason.message
              : "Unknown analysis error."
          }`,
        );
      }
      if (currentInsight) insights = [...insights, currentInsight];

      if (showThinking) {
        setThinkingSteps((steps) => [...steps, "Menyusun jawaban berdasarkan konteks…"]);
      }
      const result = await generateGeminiConversation(
        keys,
        prompt,
        nextApiIndexRef.current,
        profile ?? DEFAULT_PERSONALIZATION,
        {
          thinkingMode: showThinking,
          history: history.slice(-12),
          relevantMessages,
          memories,
          insights: insights.slice(-12),
          feedback: recentFeedback,
          executeTool: (name, input, apiKey) =>
            executeChatDataTool(client!, apiKey, name, input, requestDeleteConfirmation),
        },
      );
      attempts.push(...result.attempts);
      nextApiIndexRef.current = (result.keyIndex + 1) % keys.length;

      let thinkingSummary: string | null = null;
      if (showThinking) {
        try {
          const summary = await generateThinkingSummary(
            keys,
            prompt,
            result.text,
            {
              history: history.slice(-12).map(({ role, content }) => ({ role, content })),
              relevantMessages,
              memories,
              insights,
              feedback: recentFeedback,
            },
            result.keyIndex,
          );
          thinkingSummary = summary.summary;
          attempts.push(...summary.attempts);
        } catch (error) {
          if (error instanceof GeminiFailoverError) attempts.push(...error.attempts);
          warnings.push(
            `The answer is ready, but the Thinking mode explanation could not be created: ${
              error instanceof Error ? error.message : "Unknown Gemini error."
            }`,
          );
        }
      }
      let assistantEmbedding: number[] | null = null;
      try {
        assistantEmbedding = await createEmbedding(
          keys[result.keyIndex].api_key,
          result.text,
          "RETRIEVAL_DOCUMENT",
        );
      } catch (error) {
        warnings.push(
          `The reply will be saved, but semantic retrieval is unavailable for it: ${
            error instanceof Error ? error.message : "Could not create an embedding."
          }`,
        );
      }
      let assistantSaved = false;
      try {
        const persistedReply = await saveChatMessage(
          client,
          "assistant",
          result.text,
          assistantEmbedding,
          thinkingSummary,
        );
        const initialVersion = {
          id: "",
          user_id: persistedReply.user_id,
          message_id: persistedReply.id,
          version_number: persistedReply.version_number,
          content: persistedReply.content,
          embedding: null,
          thinking_summary: persistedReply.thinking_summary,
          revision_reason: "initial" as const,
          created_at: persistedReply.created_at,
        };
        setMessageVersions((current) => ({
          ...current,
          [persistedReply.id]: [initialVersion],
        }));
        setSelectedMessageVersions((current) => ({
          ...current,
          [persistedReply.id]: persistedReply.version_number,
        }));
        setMessages((current) => [
          ...current,
          {
            id: persistedReply.id,
            role: persistedReply.role,
            text: persistedReply.content,
            versionNumber: persistedReply.version_number,
            thinkingSummary: persistedReply.thinking_summary,
          },
        ]);
        assistantSaved = true;
      } catch (error) {
        setMessages((current) => [
          ...current,
          {
            id: `unsaved-${Date.now()}`,
            role: "assistant",
            text: result.text,
            versionNumber: 1,
            thinkingSummary,
          },
        ]);
        warnings.push(
          `The reply arrived but was not saved to the database: ${
            error instanceof Error ? error.message : "Unknown database error."
          }`,
        );
      }

      try {
        const refreshedHistory = await loadRecentChatMessages(client);
        const refreshedVersions = await loadMessageVersions(
          client,
          refreshedHistory.map((item) => item.id),
        );
        setMessageVersions(refreshedVersions);
        setSelectedMessageVersions((current) => ({
          ...current,
          ...Object.fromEntries(
            refreshedHistory.map((item) => [item.id, item.version_number]),
          ),
        }));
        setMessages([
          ...refreshedHistory.map(
            ({ id, role, content, version_number, thinking_summary }) => ({
              id,
              role,
              text: content,
              versionNumber: version_number,
              thinkingSummary: thinking_summary,
            }),
          ),
          ...(!assistantSaved
            ? [{
                id: `unsaved-${Date.now()}`,
                role: "assistant" as const,
                text: result.text,
                versionNumber: 1,
                thinkingSummary,
              }]
            : []),
        ]);
      } catch (error) {
        warnings.push(
          `The chat is updated, but could not be refreshed after database actions: ${
            error instanceof Error ? error.message : "Unknown database error."
          }`,
        );
      }

      const latestAttemptsByKey = new Map<string, GeminiAttempt>();
      attempts.forEach((attempt) => latestAttemptsByKey.set(attempt.keyId, attempt));
      const statusErrors: string[] = [];
      for (const attempt of latestAttemptsByKey.values()) {
        try {
          await saveStatus(client, attempt);
        } catch (error) {
          statusErrors.push(error instanceof Error ? error.message : "Could not save API status.");
        }
      }
      if (statusErrors.length > 0) {
        warnings.push(`Gemini API status could not be saved: ${statusErrors.join("; ")}`);
      }
      if (warnings.length > 0) setSendError(warnings.join("\n"));
      setThinkingSteps([]);
    } catch (error) {
      let detail = error instanceof Error ? error.message : "An unexpected error occurred.";
      if (error instanceof GeminiFailoverError) attempts.push(...error.attempts);
      if (client && saveStatus) {
        const latestAttemptsByKey = new Map<string, GeminiAttempt>();
        attempts.forEach((attempt) => latestAttemptsByKey.set(attempt.keyId, attempt));
        const statusErrors: string[] = [];
        for (const attempt of latestAttemptsByKey.values()) {
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
      if (savedUserMessage) {
        detail = `Your message was saved, but the assistant could not complete the reply.\n${detail}`;
      }
      setSendError(detail);
      setThinkingSteps([]);
    } finally {
      setIsSending(false);
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
      setActionNotice(nextRating ? "Thanks for the feedback." : "Feedback removed.");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not save feedback.");
    }
  }

  async function submitAssistantReport() {
    if (!reportTarget) return;
    const details = reportDetails.trim();
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
      setReportDetails("");
      setReportError("");
      setActionNotice("Report saved. Thanks for letting us know.");
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

  async function regenerateAssistantMessage(messageId: string, editedSourceText?: string) {
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
    const sourceText = editedSourceText ?? displayedMessageText(sourceMessage);
    const previousAnswer = displayedMessageText(messages[assistantIndex]);
    const previousVersionNumber = displayedVersionNumber(messages[assistantIndex]);

    setIsSending(true);
    setSendError("");
    setActionNotice("");
    const showThinking = isThinkMode;
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
      const previousRating =
        feedbackResult.status === "fulfilled" ? feedbackResult.value : null;
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
      if (showThinking) setThinkingSteps(["Meninjau riwayat dan konteks tersimpan…"]);

      const result = await generateGeminiConversation(
        keys,
        sourceText,
        startIndex,
        profile ?? DEFAULT_PERSONALIZATION,
        {
          thinkingMode: showThinking,
          history: history.map(({ role, text }) => ({ role, content: text })),
          relevantMessages: relevantContext.messages,
          memories: relevantContext.memories,
          insights,
          feedback: recentFeedback,
          replacedResponse: { content: previousAnswer, feedback: previousRating },
          executeTool: (name, input, apiKey) =>
            executeChatDataTool(client, apiKey, name, input, requestDeleteConfirmation),
        },
      );
      let thinkingSummary: string | null = null;
      if (showThinking) {
        try {
          const summary = await generateThinkingSummary(
            keys,
            sourceText,
            result.text,
            {
              history: history.map(({ role, text }) => ({ role, content: text })),
              relevantMessages: relevantContext.messages,
              memories: relevantContext.memories,
              insights,
              replacedResponse: { content: previousAnswer, feedback: previousRating },
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
        true,
      );
      if (!updatedMessage) throw new Error("This reply could not be found in the database.");

      const updatedVersions = await loadMessageVersions(client, [messageId]);
      setMessageVersions((current) => ({ ...current, ...updatedVersions }));
      setSelectedMessageVersions((current) => ({
        ...current,
        [messageId]: updatedMessage.version_number,
      }));
      setMessages((current) => [
        ...current.slice(0, assistantIndex),
        {
          ...current[assistantIndex],
          text: updatedMessage.content,
          versionNumber: updatedMessage.version_number,
          thinkingSummary: updatedMessage.thinking_summary,
        },
      ]);
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
      setActionNotice(
        regenerationWarnings.length > 0
          ? `Reply regenerated. ${regenerationWarnings.join(" ")}`
          : "Reply regenerated.",
      );
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not regenerate this reply.");
    } finally {
      setThinkingSteps([]);
      setIsSending(false);
    }
  }

  async function saveUserMessageEdit() {
    if (!userEditTarget) return;
    const nextText = userEditText.trim();
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
    setActionNotice("");
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
        false,
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
                versionNumber: updatedMessage.version_number,
                thinkingSummary: null,
              }
            : item,
        ),
      );
      setUserEditTarget(null);
      setUserEditText("");
      setActiveUserActions(null);
      const nextAssistant = messages[messageIndex + 1];
      if (nextAssistant?.role === "assistant") {
        setActionNotice("Pesan diperbarui. Cheya sedang membuat balasan baru…");
        await regenerateAssistantMessage(nextAssistant.id, updatedMessage.content);
      } else {
        setActionNotice("Pesan diperbarui. Tidak ditemukan balasan AI untuk dibuat ulang.");
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not edit this message.");
    } finally {
      setIsSending(false);
    }
  }

  if (isAuthLoading) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-white text-sm text-[#777a81]">
        Loading your CheyaVerse account…
      </main>
    );
  }

  if (!authUser) {
    return <AccountLogin client={authClient} error={authError} />;
  }

  if (pathname.startsWith("/settings") && authClient) {
    return (
      <Suspense
        fallback={
          <main className="fixed inset-0 flex items-center justify-center bg-white text-sm text-[#777a81]">
            Loading settings…
          </main>
        }
      >
        <SettingsPage
          pathname={pathname}
          onNavigate={navigate}
          onBack={() => navigate("/")}
          client={authClient}
          accountEmail={authUser.email}
          onGeminiKeyChange={setHasGeminiApiKey}
        />
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
        className="relative h-full w-full overflow-hidden border-[#e7e8eb] bg-white sm:max-w-[580px] sm:rounded-[34px] sm:border"
      >
        <header className="absolute inset-x-0 top-0 z-20 flex h-[64px] items-center justify-between gap-2 px-2 py-1 sm:gap-3 sm:px-5">
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
          className="absolute inset-0 overflow-y-auto overscroll-contain px-4 pb-28 pt-20 sm:px-6"
        >
          <div className="space-y-4">
            {messages.map((chatMessage) => {
              const versionNumber = displayedVersionNumber(chatMessage);
              const versions = messageVersions[chatMessage.id] ?? [];
              const versionIndex = versions.findIndex(
                (item) => item.version_number === versionNumber,
              );
              const visibleText = displayedMessageText(chatMessage);
              const visibleThinkingSummary = displayedThinkingSummary(chatMessage);
              const ratingKey = `${chatMessage.id}:${versionNumber}`;
              const versionControls = versions.length > 1 ? (
                <div className="flex items-center gap-0.5 text-[11px] text-[#777a82]">
                  <button
                    type="button"
                    aria-label="Show previous message version"
                    disabled={versionIndex <= 0}
                    onClick={() => setMessageVersion(chatMessage, -1)}
                    className="flex size-7 items-center justify-center rounded-md hover:bg-[#f1f2f4] disabled:opacity-30"
                  >
                    <ArrowLeft aria-hidden="true" className="size-3.5" />
                  </button>
                  <span>{Math.max(versionIndex + 1, 1)}/{versions.length}</span>
                  <button
                    type="button"
                    aria-label="Show newer message version"
                    disabled={versionIndex < 0 || versionIndex >= versions.length - 1}
                    onClick={() => setMessageVersion(chatMessage, 1)}
                    className="flex size-7 items-center justify-center rounded-md hover:bg-[#f1f2f4] disabled:opacity-30"
                  >
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
              ) : null;

              if (chatMessage.role === "user") {
                return (
                  <article key={chatMessage.id} className="group flex flex-col items-end">
                    <p
                      onTouchStart={() => {
                        clearLongPressTimer();
                        longPressTimerRef.current = setTimeout(
                          () => setActiveUserActions(chatMessage.id),
                          550,
                        );
                      }}
                      onTouchMove={clearLongPressTimer}
                      onTouchEnd={clearLongPressTimer}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setActiveUserActions(chatMessage.id);
                      }}
                      className="max-w-[76%] whitespace-pre-wrap rounded-[18px] rounded-br-md bg-[#28292e] px-3 py-2 text-[13px] leading-5 text-white sm:max-w-[70%]"
                    >
                      {visibleText}
                    </p>
                    <div className="mt-1 flex min-h-7 items-center gap-1">
                      {versionControls}
                      <div
                        aria-label="User message actions"
                        className={`flex items-center gap-0.5 transition-opacity sm:pointer-events-auto sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 ${
                          activeUserActions === chatMessage.id
                            ? "pointer-events-auto opacity-100"
                            : "pointer-events-none opacity-0"
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
                            setUserEditTarget(chatMessage.id);
                            setUserEditText(visibleText);
                            setSendError("");
                          }}
                          className="flex size-7 items-center justify-center rounded-md text-[#777a82] hover:bg-[#f1f2f4]"
                        >
                          <Pencil aria-hidden="true" className="size-3.5" />
                        </button>
                      </div>
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
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[#747780] hover:bg-[#f5f6f8]"
                      >
                        {expandedThinkingIds.has(ratingKey) ? (
                          <ChevronUp aria-hidden="true" className="size-3.5" />
                        ) : (
                          <ChevronDown aria-hidden="true" className="size-3.5" />
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
                    <Suspense fallback={<p className="whitespace-pre-wrap">{visibleText}</p>}>
                      <AssistantMarkdown content={visibleText} />
                    </Suspense>
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
                          text: visibleText,
                        });
                        setReportDetails("");
                        setReportError("");
                        setSendError("");
                      }}
                      className="flex size-8 items-center justify-center rounded-lg text-[#777a82] transition hover:bg-[#f1f2f4]"
                    >
                      <Bug aria-hidden="true" className="size-4" />
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
            {isLoadingHistory && (
              <p role="status" className="text-sm text-[#858890]">
                Loading saved chat…
              </p>
            )}
            {isSending && (
              <div role="status" aria-live="polite" className="w-full space-y-1 text-xs text-[#747780]">
                <p className="font-medium text-[#4b4e55]">CheyaVerse sedang menyusun jawaban…</p>
                {isThinkMode && thinkingSteps.map((step) => <p key={step}>{step}</p>)}
              </div>
            )}
            {actionNotice && (
              <p role="status" className="text-xs text-[#43834c]">
                {actionNotice}
              </p>
            )}
            {!hasGeminiApiKey && !isLoadingHistory && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#e6e8eb] bg-white px-3.5 py-3 text-sm text-[#686b72]">
                <span>Add a Gemini API key to start chatting.</span>
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

        <footer className="absolute inset-x-0 bottom-0 z-20 bg-white px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5 sm:px-5 sm:pb-5">
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
                placeholder={
                  hasGeminiApiKey ? "Ask anything..." : "Add a Gemini API key in Settings first"
                }
                rows={1}
                value={message}
                disabled={!hasGeminiApiKey || isLoadingHistory}
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
                  disabled={!hasGeminiApiKey || isLoadingHistory}
                  aria-expanded={isMediaMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setIsMediaMenuOpen((open) => !open)}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] transition-colors hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3] disabled:cursor-not-allowed disabled:opacity-40"
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
                  aria-pressed={isThinkMode}
                  title={isThinkMode ? "Turn off thinking summary" : "Turn on thinking summary"}
                  disabled={!hasGeminiApiKey || isLoadingHistory}
                  onClick={() => setIsThinkMode((enabled) => !enabled)}
                  className={`flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3] disabled:cursor-not-allowed disabled:opacity-40 ${
                    isThinkMode
                      ? "border-[#b9dff2] bg-[#edf8fd] text-[#1678a8]"
                      : "border-[#e5e6e9] bg-white text-[#34363b] hover:bg-[#f7f8fa]"
                  }`}
                >
                  <Brain aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
                  <span>Think</span>
                </button>
                {hasMessage ? (
                  <button
                    type="button"
                    aria-label="Send message"
                    onClick={sendMessage}
                    disabled={isSending || isLoadingHistory || !hasGeminiApiKey}
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

      {userEditTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-5 py-8">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-user-message-title"
            className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-xl"
          >
            <h2 id="edit-user-message-title" className="text-base font-semibold text-[#22242a]">
              Edit message
            </h2>
            <textarea
              aria-label="Edit user message"
              maxLength={50000}
              rows={5}
              value={userEditText}
              onChange={(event) => setUserEditText(event.target.value)}
              className="mt-3 w-full resize-y rounded-xl border border-[#e5e6e9] p-3 text-sm leading-6 outline-none focus:border-[#229fe3]"
            />
            <p className="mt-2 text-xs text-[#777a82]">
              Pesan setelah ini akan disimpan sebagai riwayat lama dan disembunyikan dari percakapan aktif.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={isSending}
                onClick={() => setUserEditTarget(null)}
                className="h-10 rounded-full border border-[#e5e6e9] px-4 text-sm font-medium text-[#34363b] hover:bg-[#f7f8fa] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSending}
                onClick={() => void saveUserMessageEdit()}
                className="flex h-10 items-center gap-2 rounded-full bg-[#28292e] px-4 text-sm font-medium text-white hover:bg-[#3b3d43] disabled:opacity-50"
              >
                {isSending && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                Save edit
              </button>
            </div>
          </section>
        </div>
      )}

      {reportTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-5 py-8">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-response-title"
            className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl"
          >
            <h2 id="report-response-title" className="text-base font-semibold text-[#22242a]">
              Report this response
            </h2>
            <p className="mt-2 max-h-20 overflow-y-auto whitespace-pre-wrap rounded-xl bg-[#f5f6f8] p-3 text-xs leading-5 text-[#64666d]">
              {reportTarget.text.slice(0, 400)}
            </p>
            <label htmlFor="response-report-details" className="mt-4 block text-sm text-[#43454b]">
              What went wrong?
            </label>
            <textarea
              id="response-report-details"
              maxLength={2000}
              rows={4}
              value={reportDetails}
              onChange={(event) => setReportDetails(event.target.value)}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-5 py-8">
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
