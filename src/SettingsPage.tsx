import {
  ArrowLeft,
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Bug,
  Clock3,
  Eye,
  EyeOff,
  FileText,
  Laptop,
  LoaderCircle,
  LogOut,
  Pencil,
  Plus,
  Play,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LegalPageContent } from "./LegalPage";
import {
  clearAccountSessionId,
  getAccountSessionId,
  getAccountSessionBrowserLabel,
  getAccountSessionDeviceLabel,
} from "./lib/account-sessions";
import { generateGeminiReply, GeminiFailoverError } from "./lib/gemini";
import {
  DEFAULT_GEMINI_TTS_VOICE,
  GEMINI_TTS_MODEL,
  GEMINI_TTS_VOICES,
  generateGeminiSpeech,
  isGeminiTtsVoice,
  type GeminiTtsVoice,
} from "./lib/gemini-tts";
import {
  DEFAULT_PERSONALIZATION,
  DEFAULT_GEMINI_TTS_SETTINGS,
  ensureSupabaseSession,
  MULTIMODAL_GEMINI_MODELS,
  saveApiStatus,
  type ApiStatus,
  type AccountSession,
  type AppSupabaseClient,
  type GeminiApiKey,
  type GeminiModel,
  type PersonalizationSettings,
  type UserMemory,
} from "./lib/supabase";
import { subscribeWithReconnect } from "./lib/realtime";

interface SettingsPageProps {
  pathname: string;
  onNavigate: (path: string) => void;
  onBack: () => void;
  client: AppSupabaseClient;
  accountUserId: string;
  accountEmail: string | null;
  onGeminiKeyChange: (isConfigured: boolean) => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function statusLabel(status: ApiStatus): string {
  if (status === "active") return "Active";
  if (status === "error") return "Needs attention";
  return "Not tested";
}

function statusStyle(status: ApiStatus): string {
  if (status === "active") return "bg-emerald-50 text-emerald-700";
  if (status === "error") return "bg-red-50 text-red-700";
  return "bg-[#f1f2f4] text-[#686b72]";
}

function formatAccountDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

type SettingsSection =
  | "home"
  | "personal"
  | "configure"
  | "memory"
  | "account"
  | "privacy"
  | "terms";

const settingsSections: Array<{
  id: Exclude<SettingsSection, "home">;
  label: string;
  description: string;
  icon: typeof UserRound;
}> = [
  {
    id: "personal",
    label: "Personal",
    description: "Your name, instructions, and conversation style",
    icon: UserRound,
  },
  {
    id: "configure",
    label: "Configure",
    description: "Gemini API keys and voice settings",
    icon: SlidersHorizontal,
  },
  {
    id: "memory",
    label: "Memory",
    description: "Review and manage facts Cheya remembers long-term",
    icon: Brain,
  },
  {
    id: "account",
    label: "Account",
    description: "Email, workspace, active sessions, and account controls",
    icon: UserRound,
  },
  {
    id: "privacy",
    label: "Privacy Policy",
    description: "How CheyaAPP handles your information",
    icon: ShieldCheck,
  },
  {
    id: "terms",
    label: "Terms of Service",
    description: "Terms for using CheyaAPP",
    icon: FileText,
  },
];

const settingsNavigationSections = settingsSections.filter(
  ({ id }) => id !== "privacy" && id !== "terms",
);

function sectionFromPath(pathname: string): SettingsSection {
  const section = pathname.split("/")[2];
  return settingsSections.some((item) => item.id === section)
    ? (section as Exclude<SettingsSection, "home">)
    : "home";
}

export function SettingsPage({
  pathname,
  onNavigate,
  onBack,
  client,
  accountUserId,
  accountEmail,
  onGeminiKeyChange,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState(() => sectionFromPath(pathname));
  const [isDatabaseReady, setIsDatabaseReady] = useState(false);
  const [databaseSessionError, setDatabaseSessionError] = useState("");
  const [apiKeys, setApiKeys] = useState<GeminiApiKey[]>([]);
  const [personalization, setPersonalization] =
    useState<PersonalizationSettings>(DEFAULT_PERSONALIZATION);
  const [ttsApiKeys, setTtsApiKeys] = useState(DEFAULT_GEMINI_TTS_SETTINGS.tts_api_keys);
  const [ttsVoice, setTtsVoice] = useState<GeminiTtsVoice>(DEFAULT_GEMINI_TTS_VOICE);
  const [isTtsVoiceMenuOpen, setIsTtsVoiceMenuOpen] = useState(false);
  const [ttsPreviewUrl, setTtsPreviewUrl] = useState("");
  const [ttsTestMessage, setTtsTestMessage] = useState("");
  const [personalizationError, setPersonalizationError] = useState("");
  const selectedModel: GeminiModel = MULTIMODAL_GEMINI_MODELS[0];
  const [newApiKey, setNewApiKey] = useState("");
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isSavingPersonalization, setIsSavingPersonalization] = useState(false);
  const [isSavingTtsSettings, setIsSavingTtsSettings] = useState(false);
  const [isTestingTtsApi, setIsTestingTtsApi] = useState(false);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [isLoadingPersonalization, setIsLoadingPersonalization] = useState(false);
  const [isAddingKey, setIsAddingKey] = useState(false);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showTtsApiKey, setShowTtsApiKey] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [accountSessions, setAccountSessions] = useState<AccountSession[]>([]);
  const [isLoadingAccountSessions, setIsLoadingAccountSessions] = useState(false);
  const [accountSessionsError, setAccountSessionsError] = useState("");
  const [currentAccountSessionId, setCurrentAccountSessionId] = useState<string | null>(null);
  const [deletingSessionIds, setDeletingSessionIds] = useState<string[]>([]);
  const [isDeletingOtherSessions, setIsDeletingOtherSessions] = useState(false);
  const [isDeleteAccountDialogOpen, setIsDeleteAccountDialogOpen] = useState(false);
  const [deleteAccountConfirmation, setDeleteAccountConfirmation] = useState("");
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryCategory, setMemoryCategory] = useState("general");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [isLoadingMemories, setIsLoadingMemories] = useState(false);
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [isClearingChats, setIsClearingChats] = useState(false);
  const [isClearChatsConfirmationOpen, setIsClearChatsConfirmationOpen] = useState(false);
  const settingsContentRef = useRef<HTMLDivElement>(null);
  const personalizationDraftDirtyRef = useRef(false);
  const ttsDraftDirtyRef = useRef(false);
  const memoryDraftDirtyRef = useRef(false);
  const ttsPreviewAudioRef = useRef<HTMLAudioElement>(null);
  const ttsPreviewUrlRef = useRef("");
  const ttsVoicePickerRef = useRef<HTMLDivElement>(null);
  const normalizedTtsApiKeys = [
    ...new Set(ttsApiKeys.map((key) => key.trim()).filter(Boolean)),
  ];

  useEffect(() => {
    setActiveSection(sectionFromPath(pathname));
    setErrorMessage("");
    setNotice("");
    if (settingsContentRef.current) settingsContentRef.current.scrollTop = 0;
  }, [pathname]);

  useEffect(() => {
    if (!isTtsVoiceMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!ttsVoicePickerRef.current?.contains(event.target as Node)) {
        setIsTtsVoiceMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsTtsVoiceMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTtsVoiceMenuOpen]);

  function openSection(section: Exclude<SettingsSection, "home">) {
    onNavigate(`/settings/${section}`);
    setActiveSection(section);
    clearMessages();
  }

  function goBack() {
    if (activeSection !== "home") {
      window.history.back();
      return;
    }
    onBack();
  }

  useEffect(() => {
    let isMounted = true;
    setIsDatabaseReady(false);
    setDatabaseSessionError("");
    setNotice("");
    void ensureSupabaseSession(client)
      .then(() => {
        if (isMounted) setIsDatabaseReady(true);
      })
      .catch((error: unknown) => {
        if (isMounted) {
          const detail = getErrorMessage(error);
          setDatabaseSessionError(detail);
          setNotice("");
          setErrorMessage(`Could not connect to the database: ${detail}`);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [client]);

  useEffect(() => {
    if (activeSection !== "account" || !client || !isDatabaseReady) return;
    let isMounted = true;
    let sessionId: string | null = null;
    setIsLoadingAccountSessions(true);
    setAccountSessionsError("");
    try {
      sessionId = getAccountSessionId();
      setCurrentAccountSessionId(sessionId);
    } catch (error) {
      setAccountSessionsError(getErrorMessage(error));
    }

    let didPurgeStaleSessions = false;
    const loadSessions = async () => {
      try {
        const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
        if (!didPurgeStaleSessions) {
          const staleCutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
          const { error: purgeError } = await client
            .from("account_sessions")
            .delete()
            .lt("last_seen_at", staleCutoff);
          if (purgeError) {
            throw new Error(
              `Could not clean old account session records. Apply the latest supabase/schema.sql. ${purgeError.message}`,
            );
          }
          didPurgeStaleSessions = true;
        }
        const { data, error } = await client
          .from("account_sessions")
          .select("id, user_id, origin, path, user_agent, started_at, last_seen_at")
          .gte("last_seen_at", cutoff)
          .order("last_seen_at", { ascending: false });
        if (error) {
          throw new Error(
            `Could not load active sessions. Apply the latest supabase/schema.sql. ${error.message}`,
          );
        }
        if (isMounted) setAccountSessions(data);
      } catch (error) {
        if (isMounted) setAccountSessionsError(getErrorMessage(error));
      } finally {
        if (isMounted) setIsLoadingAccountSessions(false);
      }
    };

    void loadSessions();
    return () => {
      isMounted = false;
    };
  }, [activeSection, client, isDatabaseReady]);

  useEffect(() => {
    if (!client || !isDatabaseReady || !accountUserId) return;
    let isMounted = true;
    let hasConnected = false;
    const tables = [
      "account_sessions",
      "ai_api_keys",
      "user_memories",
      "user_settings",
    ] as const;
    const refreshAccountSessions = async () => {
      const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
      const { data, error } = await client
        .from("account_sessions")
        .select("id, user_id, origin, path, user_agent, started_at, last_seen_at")
        .gte("last_seen_at", cutoff)
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      if (isMounted) setAccountSessions(data);
    };
    const refreshApiKeys = async () => {
      const { data, error } = await client
        .from("ai_api_keys")
        .select("id, model, api_key, status, last_error, created_at")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      if (isMounted) setApiKeys(data);
    };
    const refreshMemories = async () => {
      const { data, error } = await client
        .from("user_memories")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      if (isMounted) setMemories(data);
    };
    const refreshPersonalization = async () => {
      const { data, error } = await client
        .from("user_settings")
        .select("display_name, custom_prompt, chat_style, tts_api_key, tts_api_keys, tts_voice")
        .eq("user_id", accountUserId)
        .maybeSingle();
      if (error) throw error;
      if (!isMounted) return;
      if (!personalizationDraftDirtyRef.current) {
        setPersonalization({
          display_name: data?.display_name ?? DEFAULT_PERSONALIZATION.display_name,
          custom_prompt: data?.custom_prompt ?? DEFAULT_PERSONALIZATION.custom_prompt,
          chat_style: data?.chat_style ?? DEFAULT_PERSONALIZATION.chat_style,
        });
      }
      if (!ttsDraftDirtyRef.current) {
        const savedTtsKeys = Array.isArray(data?.tts_api_keys)
          ? data.tts_api_keys
          : [];
        setTtsApiKeys(
          savedTtsKeys.length > 0
            ? savedTtsKeys
            : data?.tts_api_key
              ? [data.tts_api_key]
              : [],
        );
        setTtsVoice(
          typeof data?.tts_voice === "string" && isGeminiTtsVoice(data.tts_voice)
            ? data.tts_voice
            : DEFAULT_GEMINI_TTS_VOICE,
        );
      }
    };
    const refreshForTable = (table: (typeof tables)[number]) => {
      const refresh =
        table === "account_sessions"
          ? refreshAccountSessions
          : table === "ai_api_keys"
            ? refreshApiKeys
            : table === "user_memories"
              ? refreshMemories
              : table === "user_settings"
                ? refreshPersonalization
                : null;
      if (!refresh) return;
      void refresh().catch((error: unknown) => {
        if (!isMounted) return;
        const detail = getErrorMessage(error);
        if (table === "account_sessions") {
          setAccountSessionsError(`Could not sync active sessions: ${detail}`);
        } else {
          setErrorMessage(`Could not sync ${table.split("_").join(" ")}: ${detail}`);
        }
      });
    };
    const stopRealtime = subscribeWithReconnect(
      client,
      `settings-live-${accountUserId}`,
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
            () => {
              refreshForTable(table);
            },
          );
        }
        return channel;
      },
      (status, error) => {
        if (!isMounted) return;
        if (status === "SUBSCRIBED") {
          if (hasConnected) {
            for (const table of tables) refreshForTable(table);
          }
          hasConnected = true;
          setErrorMessage((current) =>
            current.startsWith("Live settings sync disconnected. Reconnecting")
              ? ""
              : current,
          );
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setErrorMessage(
            `Live settings sync disconnected. Reconnecting… ${error?.message ?? ""}`.trim(),
          );
        }
      },
    );

    return () => {
      isMounted = false;
      stopRealtime();
    };
  }, [accountUserId, client, isDatabaseReady]);

  useEffect(() => {
    if (!client || !isDatabaseReady) {
      setApiKeys([]);
      return;
    }

    let isMounted = true;
    setIsLoadingKeys(true);
    void client
      .from("ai_api_keys")
      .select("id, model, api_key, status, last_error, created_at")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          setErrorMessage(error.message);
        } else {
          setApiKeys(data);
        }
        setIsLoadingKeys(false);
      });

    return () => {
      isMounted = false;
    };
  }, [client, isDatabaseReady]);

  useEffect(() => {
    if (!client || !isDatabaseReady || activeSection !== "memory") return;
    let isMounted = true;
    setIsLoadingMemories(true);
    void client
      .from("user_memories")
      .select("*")
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) setErrorMessage(`Could not load long-term memories: ${error.message}`);
        else setMemories(data);
        setIsLoadingMemories(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeSection, client, isDatabaseReady, pathname]);

  useEffect(() => {
    if (!client || !isDatabaseReady) return;

    let isMounted = true;
    setPersonalizationError("");
    setIsLoadingPersonalization(true);
    void (async () => {
      try {
        const { data: userData, error: userError } = await client.auth.getUser();
        if (userError) throw userError;
        if (!userData.user) throw new Error("The private Supabase session has no user ID.");

        const { data, error } = await client
          .from("user_settings")
          .select("display_name, custom_prompt, chat_style, tts_api_key, tts_api_keys, tts_voice")
          .eq("user_id", userData.user.id)
          .maybeSingle();
        if (error) {
          throw new Error(
            `Could not load Personal settings. The CheyaVerse database may need the latest supabase/schema.sql. ${error.message}`,
          );
        }
        if (isMounted && data) {
          setPersonalization({
            display_name: data.display_name,
            custom_prompt: data.custom_prompt,
            chat_style: data.chat_style,
          });
          const savedTtsKeys = Array.isArray(data.tts_api_keys)
            ? data.tts_api_keys
            : [];
          setTtsApiKeys(
            savedTtsKeys.length > 0
              ? savedTtsKeys
              : data.tts_api_key
                ? [data.tts_api_key]
                : [],
          );
          setTtsVoice(
            isGeminiTtsVoice(data.tts_voice) ? data.tts_voice : DEFAULT_GEMINI_TTS_VOICE,
          );
        } else if (isMounted) {
          setTtsApiKeys(DEFAULT_GEMINI_TTS_SETTINGS.tts_api_keys);
          setTtsVoice(DEFAULT_GEMINI_TTS_SETTINGS.tts_voice);
        }
      } catch (error) {
        if (isMounted) {
          const detail = getErrorMessage(error);
          setPersonalizationError(detail);
          setErrorMessage(detail);
        }
      } finally {
        if (isMounted) setIsLoadingPersonalization(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [client, isDatabaseReady]);

  useEffect(
    () => () => {
      ttsPreviewAudioRef.current?.pause();
      if (ttsPreviewUrlRef.current) URL.revokeObjectURL(ttsPreviewUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!ttsPreviewUrl) return;
    const audio = ttsPreviewAudioRef.current;
    if (!audio) return;
    void audio.play().catch((error: unknown) => {
      setTtsTestMessage(
        `The test audio is ready. Press play to listen: ${getErrorMessage(error)}`,
      );
    });
  }, [ttsPreviewUrl]);

  useEffect(() => {
    if (!isHelpOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsHelpOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isHelpOpen]);

  useEffect(() => {
    if (settingsContentRef.current) settingsContentRef.current.scrollTop = 0;
  }, []);

  function clearMessages() {
    setErrorMessage("");
    setNotice("");
  }

  async function savePersonalization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    setPersonalizationError("");
    if (!isDatabaseReady) {
      setErrorMessage("Sign in with your Google account before saving Personal settings.");
      return;
    }

    setIsSavingPersonalization(true);
    try {
      const { data, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      if (!data.user) throw new Error("The private Supabase session has no user ID.");

      const { error } = await client.from("user_settings").upsert(
        {
          user_id: data.user.id,
          ...personalization,
          tts_api_key: ttsApiKeys.find((key) => key.trim())?.trim() ?? "",
          tts_api_keys: ttsApiKeys.map((key) => key.trim()).filter(Boolean),
          tts_voice: ttsVoice,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) {
        throw new Error(
          `Could not save Personal settings. The CheyaVerse database may need the latest supabase/schema.sql. ${error.message}`,
        );
      }

      personalizationDraftDirtyRef.current = false;
      ttsDraftDirtyRef.current = false;
      setNotice("Personal settings saved to your CheyaVerse account.");
    } catch (error) {
      const detail = getErrorMessage(error);
      setPersonalizationError(detail);
      setErrorMessage(detail);
    } finally {
      setIsSavingPersonalization(false);
    }
  }

  async function saveTtsSettings() {
    clearMessages();
    setTtsTestMessage("");
    if (!isDatabaseReady) {
      setErrorMessage("Sign in with your Google account before saving Gemini TTS settings.");
      return;
    }
    if (isLoadingPersonalization || personalizationError) {
      setErrorMessage(
        personalizationError || "Wait for your account settings to finish loading before saving.",
      );
      return;
    }

    setIsSavingTtsSettings(true);
    try {
      const { data, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      if (!data.user) throw new Error("The private Supabase session has no user ID.");

      const { error } = await client.from("user_settings").upsert(
        {
          user_id: data.user.id,
          ...personalization,
          tts_api_key: normalizedTtsApiKeys[0] ?? "",
          tts_api_keys: normalizedTtsApiKeys,
          tts_voice: ttsVoice,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) {
        throw new Error(
          `Could not save Gemini TTS settings. The CheyaVerse database may need the latest supabase/schema.sql. ${error.message}`,
        );
      }
      setTtsApiKeys(normalizedTtsApiKeys);
      ttsDraftDirtyRef.current = false;
      personalizationDraftDirtyRef.current = false;
      setNotice(`${normalizedTtsApiKeys.length} Gemini TTS API key(s) and voice saved to your CheyaVerse account.`);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSavingTtsSettings(false);
    }
  }

  async function testGeminiTts() {
    clearMessages();
    setTtsTestMessage("");
    ttsPreviewAudioRef.current?.pause();
    if (ttsPreviewUrlRef.current) URL.revokeObjectURL(ttsPreviewUrlRef.current);
    ttsPreviewUrlRef.current = "";
    setTtsPreviewUrl("");
    if (normalizedTtsApiKeys.length === 0) {
      setTtsTestMessage("Add at least one separate Gemini TTS API key before testing.");
      return;
    }

    setIsTestingTtsApi(true);
    try {
      const sample = GEMINI_TTS_VOICES.find((voice) => voice.id === ttsVoice);
      if (!sample) throw new Error("The selected Gemini TTS voice is unavailable.");
      const audioBlob = await generateGeminiSpeech(normalizedTtsApiKeys, sample.sample, ttsVoice);
      const url = URL.createObjectURL(audioBlob);
      ttsPreviewUrlRef.current = url;
      setTtsPreviewUrl(url);
      setTtsTestMessage(`${GEMINI_TTS_MODEL} returned audio successfully.`);
    } catch (error) {
      setTtsTestMessage(getErrorMessage(error));
    } finally {
      setIsTestingTtsApi(false);
    }
  }

  async function signOut() {
    clearMessages();
    setIsSigningOut(true);
    try {
      let sessionCleanupWarning = "";
      try {
        const sessionId = getAccountSessionId();
        const { error: sessionError } = await client
          .from("account_sessions")
          .delete()
          .eq("id", sessionId);
        if (sessionError) sessionCleanupWarning = sessionError.message;
      } catch (error) {
        sessionCleanupWarning = getErrorMessage(error);
      }
      const { error } = await client.auth.signOut();
      if (error) {
        setErrorMessage(`Could not sign out: ${error.message}`);
      } else {
        clearAccountSessionId();
        if (sessionCleanupWarning) {
          setNotice(`Signed out. This session will disappear from the active list shortly. ${sessionCleanupWarning}`);
        }
      }
    } catch (error) {
      setErrorMessage(`Could not sign out: ${getErrorMessage(error)}`);
    } finally {
      setIsSigningOut(false);
    }
  }

  async function deleteAccountSession(session: AccountSession) {
    if (
      !window.confirm(
        session.id === currentAccountSessionId
          ? "Delete this session and sign out this device?"
          : "Delete this session? Its device will be signed out the next time it checks in.",
      )
    ) {
      return;
    }

    clearMessages();
    setAccountSessionsError("");
    setDeletingSessionIds((current) => [...current, session.id]);
    try {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error("Sign in before deleting a session.");
      const { data, error } = await client
        .from("account_sessions")
        .delete()
        .eq("id", session.id)
        .eq("user_id", userData.user.id)
        .select("id");
      if (error) throw error;
      if (data.length === 0) throw new Error("This session was already removed. Refresh the list and try again.");

      setAccountSessions((current) => current.filter((item) => item.id !== session.id));
      if (session.id === currentAccountSessionId) {
        clearAccountSessionId();
        const { error: signOutError } = await client.auth.signOut({ scope: "local" });
        if (signOutError) throw signOutError;
      } else {
        setNotice("Session deleted. Its device will be signed out when it checks in.");
      }
    } catch (error) {
      setAccountSessionsError(`Could not delete this session: ${getErrorMessage(error)}`);
    } finally {
      setDeletingSessionIds((current) => current.filter((id) => id !== session.id));
    }
  }

  async function deleteOtherAccountSessions() {
    if (!currentAccountSessionId) {
      setAccountSessionsError("This device's active session could not be identified.");
      return;
    }
    if (!window.confirm("Delete all other sessions? Their devices will be signed out when they check in.")) {
      return;
    }

    clearMessages();
    setAccountSessionsError("");
    setIsDeletingOtherSessions(true);
    try {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error("Sign in before deleting other sessions.");
      const { error } = await client
        .from("account_sessions")
        .delete()
        .eq("user_id", userData.user.id)
        .neq("id", currentAccountSessionId)
        .select("id");
      if (error) throw error;

      setAccountSessions((current) =>
        current.filter((session) => session.id === currentAccountSessionId),
      );
      setNotice("All other sessions were deleted. Their devices will be signed out when they check in.");
    } catch (error) {
      setAccountSessionsError(`Could not delete other sessions: ${getErrorMessage(error)}`);
    } finally {
      setIsDeletingOtherSessions(false);
    }
  }

  async function deleteAccount() {
    clearMessages();
    setIsDeletingAccount(true);
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error(`Could not verify your account session: ${error.message}`);
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Sign in again before deleting your account.");
      const response = await fetch("/api/account-delete", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const body = await response.text();
        let message = body || `Account deletion failed (HTTP ${response.status}).`;
        try {
          const payload: unknown = JSON.parse(body);
          if (
            typeof payload === "object" &&
            payload !== null &&
            "statusMessage" in payload &&
            typeof payload.statusMessage === "string"
          ) {
            message = payload.statusMessage;
          }
        } catch {
          if (!body) message = `Account deletion failed (HTTP ${response.status}).`;
        }
        throw new Error(message);
      }
      clearAccountSessionId();
      setIsDeleteAccountDialogOpen(false);
      setDeleteAccountConfirmation("");
      await client.auth.signOut({ scope: "local" });
      onNavigate("/");
    } catch (error) {
      setErrorMessage(`Could not delete your account: ${getErrorMessage(error)}`);
    } finally {
      setIsDeletingAccount(false);
    }
  }

  async function addApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    if (!client || !isDatabaseReady) {
      setErrorMessage("Sign in to your CheyaVerse account before adding API keys.");
      return;
    }
    const key = newApiKey.trim();
    if (!key) {
      setErrorMessage("Enter a Gemini API key.");
      return;
    }

    setIsAddingKey(true);
    try {
      const { data, error } = await client
        .from("ai_api_keys")
        .insert({
          provider: "gemini",
          model: selectedModel,
          api_key: key,
          status: "untested",
          last_error: null,
        })
        .select("id, model, api_key, status, last_error, created_at")
        .single();
      if (error) throw error;
      setApiKeys((keys) =>
        [...keys, data].sort(
          (a, b) =>
            a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
        ),
      );
      onGeminiKeyChange(true);
      setNewApiKey("");
      setNotice("Gemini API key added. Test it or send a message to check the connection.");
    } catch (error) {
      setErrorMessage(`Could not save the API key: ${getErrorMessage(error)}`);
    } finally {
      setIsAddingKey(false);
    }
  }

  async function testApiKey(apiKey: GeminiApiKey) {
    if (!client) return;
    clearMessages();
    setBusyKeyId(apiKey.id);
    try {
      const reply = await generateGeminiReply([apiKey], "Reply with the word OK.", 0);
      try {
        await saveApiStatus(client, reply.attempts[0]);
      } catch (statusError) {
        setErrorMessage(
          `Gemini responded successfully, but its status could not be saved: ${getErrorMessage(statusError)}`,
        );
        return;
      }
      setApiKeys((keys) =>
        keys.map((item) =>
          item.id === apiKey.id ? { ...item, status: "active", last_error: null } : item,
        ),
      );
      setNotice(`${apiKey.model} is active and responded successfully.`);
    } catch (error) {
      const failures = error instanceof GeminiFailoverError ? error.attempts : [];
      const failure = failures[0];
      if (failure) {
        try {
          await saveApiStatus(client, failure);
          setApiKeys((keys) =>
            keys.map((item) =>
              item.id === apiKey.id
                ? { ...item, status: "error", last_error: failure.error }
                : item,
            ),
          );
        } catch (statusError) {
          setErrorMessage(
            `${getErrorMessage(error)} Status could not be saved: ${getErrorMessage(statusError)}`,
          );
          setBusyKeyId(null);
          return;
        }
      }
      setErrorMessage(getErrorMessage(error));
    } finally {
      setBusyKeyId(null);
    }
  }

  async function removeApiKey(apiKey: GeminiApiKey) {
    if (!client) return;
    clearMessages();
    setBusyKeyId(apiKey.id);
    try {
      const { data, error } = await client
        .from("ai_api_keys")
        .delete()
        .eq("id", apiKey.id)
        .select("id");
      if (error) throw error;
      if (data.length === 0) throw new Error("The API key was not found or could not be removed.");
      setApiKeys((keys) => keys.filter((key) => key.id !== apiKey.id));
      onGeminiKeyChange(apiKeys.length > 1);
      setNotice("Gemini API key removed.");
    } catch (error) {
      setErrorMessage(`Could not remove the API key: ${getErrorMessage(error)}`);
    } finally {
      setBusyKeyId(null);
    }
  }

  function resetMemoryForm() {
    setEditingMemoryId(null);
    setMemoryContent("");
    setMemoryCategory("general");
    memoryDraftDirtyRef.current = false;
  }

  async function saveMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    const content = memoryContent.trim();
    if (!content || content.length > 10000) {
      setErrorMessage("A memory must contain 1–10,000 characters.");
      return;
    }
    const apiKey = apiKeys[0];
    if (!apiKey) {
      setErrorMessage("Add a Gemini API key before creating a searchable memory.");
      return;
    }
    setIsSavingMemory(true);
    try {
      const [{ createEmbedding }, { data: userData, error: userError }] = await Promise.all([
        import("./lib/chat-data"),
        client.auth.getUser(),
      ]);
      if (userError) throw userError;
      if (!userData.user) throw new Error("Sign in before saving a memory.");
      const embedding = await createEmbedding(apiKey.api_key, content, "RETRIEVAL_DOCUMENT");
      const memoryData = {
        content,
        category: memoryCategory.trim().slice(0, 80) || "general",
        embedding: `[${embedding.join(",")}]`,
        updated_at: new Date().toISOString(),
      };
      const query = editingMemoryId
        ? client
            .from("user_memories")
            .update(memoryData)
            .eq("id", editingMemoryId)
            .eq("user_id", userData.user.id)
        : client.from("user_memories").insert({
            ...memoryData,
            user_id: userData.user.id,
          });
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      setMemories((current) => [data, ...current.filter((memory) => memory.id !== data.id)]);
      setNotice(editingMemoryId ? "Long-term memory updated." : "Long-term memory saved.");
      resetMemoryForm();
    } catch (error) {
      setErrorMessage(`Could not save this memory: ${getErrorMessage(error)}`);
    } finally {
      setIsSavingMemory(false);
    }
  }

  async function deleteMemory(memory: UserMemory) {
    if (!window.confirm(`Delete this saved memory?\n\n${memory.content}`)) return;
    clearMessages();
    try {
      const { data, error } = await client
        .from("user_memories")
        .delete()
        .eq("id", memory.id)
        .select("id");
      if (error) throw error;
      if (data.length === 0) throw new Error("Memory was not found or could not be deleted.");
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      if (editingMemoryId === memory.id) resetMemoryForm();
      setNotice("Long-term memory deleted.");
    } catch (error) {
      setErrorMessage(`Could not delete this memory: ${getErrorMessage(error)}`);
    }
  }

  async function clearChats() {
    if (isClearingChats) return;
    clearMessages();
    setIsClearingChats(true);
    let memoryReferencesDetached = false;
    try {
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      if (!data.user) throw new Error("Sign in before clearing chat history.");

      const { error: memoryError } = await client
        .from("user_memories")
        .update({ source_message_id: null })
        .eq("user_id", data.user.id)
        .not("source_message_id", "is", null);
      if (memoryError) throw memoryError;
      memoryReferencesDetached = true;

      const { data: deletedMessages, error: deleteError } = await client
        .from("chat_messages")
        .delete()
        .eq("user_id", data.user.id)
        .select("id");
      if (deleteError) throw deleteError;
      setNotice(
        `Deleted ${deletedMessages.length} chat message${deletedMessages.length === 1 ? "" : "s"} and their insights. Long-term memories were preserved.`,
      );
    } catch (error) {
      const detail = getErrorMessage(error);
      setErrorMessage(
        memoryReferencesDetached
          ? `Could not delete chat history after protecting long-term memories. Those memories are safe; retry clearing chats. ${detail}`
          : `Could not clear chat history: ${detail}`,
      );
    } finally {
      setIsClearingChats(false);
    }
  }

  return (
    <main className="fixed inset-0 flex justify-center bg-[#f5f6f8]">
      <section
        aria-label="Settings"
        className={`relative flex h-full w-full overflow-hidden bg-transparent lg:flex-row ${
          activeSection === "home" ? "max-w-[720px]" : ""
        }`}
      >
        <aside
          className={`${
            activeSection === "home" ? "hidden" : "hidden lg:flex"
          } w-[360px] shrink-0 flex-col border-r border-[#e5e6e9] bg-white`}
        >
          <header className="flex h-[68px] shrink-0 items-center justify-between px-7">
            <h1 className="text-lg font-semibold text-[#17181b]">Settings</h1>
            <nav aria-label="Legal pages" className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Privacy Policy"
                title="Privacy Policy"
                onClick={() => openSection("privacy")}
                className="flex size-9 items-center justify-center rounded-full text-[#34363b] transition hover:bg-[#f1f2f4]"
              >
                <ShieldCheck aria-hidden="true" className="size-5" />
              </button>
              <button
                type="button"
                aria-label="Terms of Service"
                title="Terms of Service"
                onClick={() => openSection("terms")}
                className="flex size-9 items-center justify-center rounded-full text-[#34363b] transition hover:bg-[#f1f2f4]"
              >
                <FileText aria-hidden="true" className="size-5" />
              </button>
            </nav>
          </header>
          <nav aria-label="Settings pages" className="flex-1 space-y-2 overflow-y-auto px-4 pb-6">
            {settingsNavigationSections.map(({ id, label, description, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={activeSection === id ? "page" : undefined}
                onClick={() => openSection(id)}
                className={`flex min-h-[76px] w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition ${
                  activeSection === id
                    ? "border-[#cfd1d6] bg-[#f1f2f4] text-[#17181b]"
                    : "border-[#e1e3e8] bg-white text-[#202126] hover:border-[#cfd1d6] hover:bg-[#f1f2f4]"
                }`}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#f1f2f4] text-[#17181b]">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[#17181b]">{label}</span>
                  <span className="mt-1 block text-xs leading-5 text-[#777a81]">{description}</span>
                </span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="absolute inset-x-0 top-0 z-20 flex h-[68px] shrink-0 items-center gap-2 border-0 bg-transparent px-1 shadow-none sm:px-4 lg:px-7">
          <button
            type="button"
            aria-label={activeSection === "home" ? "Back to chat" : "Back to settings"}
            onClick={goBack}
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] transition hover:bg-[#f7f8fa]"
          >
            <ArrowLeft aria-hidden="true" className="size-[21px]" />
          </button>
          <h1 className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-[#e5e6e9] bg-white px-4 text-lg font-semibold text-[#17181b]">
            {activeSection === "home"
              ? "Settings"
              : settingsSections.find((section) => section.id === activeSection)?.label}
          </h1>
          <nav
            aria-label="Settings actions"
            className="flex h-11 shrink-0 items-center gap-0.5 rounded-full border border-[#e5e6e9] bg-white p-0.5"
          >
            <button
              type="button"
              aria-label="Report a problem"
              title="Report a problem"
              className="flex size-9 items-center justify-center rounded-full text-[#34363b] transition hover:bg-[#f7f8fa]"
            >
              <Bug aria-hidden="true" className="size-[21px]" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              aria-label="Privacy Policy"
              title="Privacy Policy"
              onClick={() => openSection("privacy")}
              className={`${
                activeSection === "home" ? "flex" : "flex lg:hidden"
              } size-9 items-center justify-center rounded-full text-[#34363b] transition hover:bg-[#f7f8fa]`}
            >
              <ShieldCheck aria-hidden="true" className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Terms of Service"
              title="Terms of Service"
              onClick={() => openSection("terms")}
              className={`${
                activeSection === "home" ? "flex" : "flex lg:hidden"
              } size-9 items-center justify-center rounded-full text-[#34363b] transition hover:bg-[#f7f8fa]`}
            >
              <FileText aria-hidden="true" className="size-5" />
            </button>
            {activeSection === "configure" && (
              <button
                type="button"
                aria-label="Setup help"
                title="Setup help"
                onClick={() => setIsHelpOpen(true)}
                className="flex size-9 items-center justify-center rounded-full text-[#34363b] transition hover:bg-[#f7f8fa]"
              >
                <CircleHelp aria-hidden="true" className="size-[21px]" />
              </button>
            )}
          </nav>
        </header>

        <div
          ref={settingsContentRef}
          className={`absolute inset-0 overflow-y-auto overscroll-contain bg-[#f5f6f8] pb-8 pt-[68px] sm:pb-10 ${
            activeSection === "home"
              ? "px-3 sm:px-5"
              : "px-3 sm:px-6 lg:px-6"
          }`}
        >
          {activeSection === "home" && (
            <>
            <nav aria-label="Settings pages" className="flex flex-col gap-3 pt-2">
              {settingsNavigationSections.map(({ id, label, description, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => openSection(id)}
                  className="flex min-h-[68px] w-full items-center gap-3 rounded-2xl border border-[#e1e3e8] bg-white px-3 py-2 text-left transition hover:border-[#cfd1d6] hover:bg-[#f1f2f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#777a81]"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#f1f2f4] text-[#17181b]">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-5 text-[#202126]">{label}</span>
                    <span className="block text-xs leading-4 text-[#777a81]">
                      {description}
                    </span>
                  </span>
                </button>
              ))}
            </nav>
            </>
          )}

          {activeSection === "personal" && (
            <section
              aria-labelledby="personal-settings-title"
              className="py-2 sm:py-3"
            >
              <div className="mb-4">
                <h2 id="personal-settings-title" className="font-semibold text-[#202126]">
                  Personal
                </h2>
                <p className="mt-1 text-sm leading-5 text-[#777a81]">
                  Set how CheyaVerse addresses you and responds in chat.
                </p>
              </div>
              {(personalizationError || errorMessage) && (
                <div
                  role="alert"
                  className="mb-4 flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-red-800"
                >
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <p className="whitespace-pre-line">{personalizationError || errorMessage}</p>
                </div>
              )}
              {notice && (
                <div
                  role="status"
                  className="mb-4 flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800"
                >
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <p>{notice}</p>
                </div>
              )}
              {isLoadingPersonalization ? (
                <div
                  role="status"
                  aria-label="Loading personal settings"
                  className="space-y-4"
                >
                  <div className="h-11 rounded-xl bg-[#f1f2f4]" />
                  <div className="h-28 rounded-xl bg-[#f1f2f4]" />
                  <div className="h-11 rounded-xl bg-[#f1f2f4]" />
                  <div className="h-10 w-44 rounded-xl bg-[#f1f2f4]" />
                </div>
              ) : (
                <form className="space-y-4" onSubmit={savePersonalization}>
                  <label className="block text-xs font-medium text-[#656870]">
                    Name
                    <input
                      value={personalization.display_name}
                      onChange={(event) => {
                        personalizationDraftDirtyRef.current = true;
                        setPersonalization((current) => ({
                          ...current,
                          display_name: event.target.value,
                        }));
                      }}
                      maxLength={80}
                      placeholder="What should CheyaVerse call you?"
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#e1e3e7] bg-white px-3 text-sm text-[#26272c] outline-none focus:border-[#9380dc]"
                    />
                  </label>
                  <label className="block text-xs font-medium text-[#656870]">
                    Custom prompt
                    <textarea
                      value={personalization.custom_prompt}
                      onChange={(event) => {
                        personalizationDraftDirtyRef.current = true;
                        setPersonalization((current) => ({
                          ...current,
                          custom_prompt: event.target.value,
                        }));
                      }}
                      maxLength={4000}
                      rows={5}
                      placeholder="Tell CheyaVerse what to keep in mind when responding."
                      className="mt-1.5 w-full resize-y rounded-xl border border-[#e1e3e7] bg-white px-3 py-2.5 text-sm leading-5 text-[#26272c] outline-none focus:border-[#9380dc]"
                    />
                  </label>
                  <label className="block text-xs font-medium text-[#656870]">
                    Conversation style
                    <input
                      value={personalization.chat_style}
                      onChange={(event) => {
                        personalizationDraftDirtyRef.current = true;
                        setPersonalization((current) => ({
                          ...current,
                          chat_style: event.target.value,
                        }));
                      }}
                      maxLength={120}
                      placeholder="For example: friendly, concise, and casual"
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#e1e3e7] bg-white px-3 text-sm text-[#26272c] outline-none focus:border-[#9380dc]"
                    />
                  </label>
                  {!isDatabaseReady && (
                    <p className="text-xs leading-5 text-[#858890]">
                      Sign in to load and save these settings to your account.
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={
                      !isDatabaseReady ||
                      isLoadingPersonalization ||
                      !!personalizationError ||
                      isSavingPersonalization ||
                      isSavingTtsSettings
                    }
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#26272c] px-4 text-sm font-medium text-white transition hover:bg-[#3a3b41] disabled:opacity-60"
                  >
                    {isSavingPersonalization && (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    )}
                    Save personal settings
                  </button>
                </form>
              )}
            </section>
          )}

          {activeSection === "account" && (
            <section aria-labelledby="account-page-title" className="space-y-7 py-2 sm:py-3">
              <div>
                <h2 id="account-page-title" className="font-semibold text-[#202126]">
                  Account
                </h2>
                <p className="mt-1 text-sm leading-5 text-[#777a81]">
                  Review your account, workspace, and active sign-in sessions.
                </p>
              </div>
              {errorMessage && (
                <div role="alert" className="rounded-2xl bg-red-50 px-3.5 py-3 text-sm text-red-800">
                  {errorMessage}
                </div>
              )}
              {notice && (
                <div role="status" className="rounded-2xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
                  {notice}
                </div>
              )}
              <div className="divide-y divide-[#eceef1] rounded-2xl border border-[#e2e4e8] bg-white px-4">
                <div className="flex min-h-16 items-center justify-between gap-4 py-3">
                  <span className="text-sm text-[#777a81]">Email</span>
                  <span className="min-w-0 break-all text-right text-sm font-medium text-[#292a30]">
                    {accountEmail ?? "Not available"}
                  </span>
                </div>
                <div className="flex min-h-16 items-center justify-between gap-4 py-3">
                  <span className="text-sm text-[#777a81]">Account sync</span>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                    <Check aria-hidden="true" className="size-4" />
                    {isDatabaseReady ? "Synced" : "Connecting"}
                  </span>
                </div>
                <div className="flex min-h-16 items-center justify-between gap-4 py-3">
                  <span className="text-sm text-[#777a81]">Workspace</span>
                  <span className="text-sm font-medium text-[#292a30]">Personal</span>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-[#292a30]">Active sessions</h3>
                    <p className="mt-1 text-xs leading-5 text-[#858890]">
                      Sessions seen in the last two minutes. Location paths exclude query strings.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isLoadingAccountSessions && (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-[#777a81]" />
                    )}
                    <button
                      type="button"
                      onClick={() => void deleteOtherAccountSessions()}
                      disabled={
                        !isDatabaseReady ||
                        isDeletingOtherSessions ||
                        accountSessions.length === 0
                      }
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#e1e3e8] bg-white px-3 text-xs font-medium text-[#55575e] transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isDeletingOtherSessions ? (
                        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 aria-hidden="true" className="size-3.5" />
                      )}
                      <span className="hidden sm:inline">Remove other sessions</span>
                      <span className="sm:hidden">Others</span>
                    </button>
                  </div>
                </div>
                {accountSessionsError ? (
                  <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-3 text-sm leading-5 text-red-800">
                    {accountSessionsError}
                  </p>
                ) : accountSessions.length === 0 && !isLoadingAccountSessions ? (
                  <p className="rounded-xl bg-[#f7f8fa] px-3.5 py-3 text-sm text-[#777a81]">
                    No active sessions were found.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {accountSessions.map((session) => {
                      const isCurrent = session.id === currentAccountSessionId;
                      const device = getAccountSessionDeviceLabel(session.user_agent);
                      const browser = getAccountSessionBrowserLabel(session.user_agent);
                      const sessionUrl = `${session.origin}${session.path}`;
                      return (
                        <article
                          key={session.id}
                          className="rounded-2xl border border-[#e2e4e8] bg-white p-3.5"
                        >
                          <div className="flex items-start gap-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f1f2f4] text-[#17181b]">
                              <Laptop aria-hidden="true" className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-sm font-medium text-[#292a30]">
                                  {device} · {browser}
                                </h4>
                                {isCurrent && (
                                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                    This device
                                  </span>
                                )}
                              </div>
                              <a
                                href={sessionUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 block break-all text-xs text-[#416e91] hover:underline"
                              >
                                {sessionUrl}
                              </a>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] leading-4 text-[#858890]">
                                <span className="inline-flex items-center gap-1">
                                  <Clock3 aria-hidden="true" className="size-3" />
                                  Started {formatAccountDateTime(session.started_at)}
                                </span>
                                <span>Last active {formatAccountDateTime(session.last_seen_at)}</span>
                              </div>
                              <details className="mt-2">
                                <summary className="cursor-pointer text-[11px] font-medium text-[#777a81]">
                                  Device details
                                </summary>
                                <p className="mt-1 break-all text-[11px] leading-4 text-[#858890]">
                                  {session.user_agent || "Browser details unavailable"}
                                </p>
                              </details>
                              <button
                                type="button"
                                onClick={() => void deleteAccountSession(session)}
                                disabled={!isDatabaseReady || deletingSessionIds.includes(session.id)}
                                className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-[#777a81] transition hover:bg-red-50 hover:text-red-700 disabled:cursor-wait disabled:opacity-50"
                              >
                                {deletingSessionIds.includes(session.id) ? (
                                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                                ) : (
                                  <Trash2 aria-hidden="true" className="size-3.5" />
                                )}
                                Delete session
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

              {!isDatabaseReady && (
                <p className="text-xs leading-5 text-[#858890]">
                  Sign in to manage account settings and active sessions.
                </p>
              )}
              <div className="grid gap-3 border-t border-[#eceef1] pt-5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void signOut()}
                  disabled={isSigningOut || !isDatabaseReady}
                  className="group flex min-h-[76px] items-center gap-3 rounded-2xl border border-[#e1e3e7] bg-white p-4 text-left transition hover:border-[#c9c4dc] hover:bg-[#fcfbff] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#f2f3f5] text-[#565961] group-hover:bg-[#eceaf5] group-hover:text-[#59458e]">
                    {isSigningOut ? (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    ) : (
                      <LogOut aria-hidden="true" className="size-4" />
                    )}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-[#292a30]">Sign out</span>
                    <span className="mt-1 block text-xs text-[#777a81]">Sign out on this device</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteAccountConfirmation("");
                    setIsDeleteAccountDialogOpen(true);
                  }}
                  disabled={!isDatabaseReady || isDeletingAccount}
                  className="group flex min-h-[76px] items-center gap-3 rounded-2xl border border-red-100 bg-white p-4 text-left transition hover:border-red-200 hover:bg-red-50/70 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700">
                    <Trash2 aria-hidden="true" className="size-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-red-800">Delete account</span>
                    <span className="mt-1 block text-xs text-red-700/75">Permanently remove your data</span>
                  </span>
                </button>
              </div>
            </section>
          )}

          {(activeSection === "privacy" || activeSection === "terms") && (
            <article className="mx-auto max-w-5xl py-2 sm:py-3">
              <LegalPageContent kind={activeSection} />
              <nav aria-label="Legal pages" className="mt-5 flex justify-center gap-4 border-t border-[#e7e8eb] pt-5 text-center text-sm">
                <button
                  type="button"
                  onClick={() => openSection("privacy")}
                  className="text-[#356d91] hover:underline"
                >
                  Privacy Policy
                </button>
                <button
                  type="button"
                  onClick={() => openSection("terms")}
                  className="text-[#356d91] hover:underline"
                >
                  Terms of Service
                </button>
              </nav>
            </article>
          )}

          {activeSection === "configure" && (
            <>
          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-red-800"
            >
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p className="whitespace-pre-line">{errorMessage}</p>
            </div>
          )}
          {notice && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800"
            >
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p>{notice}</p>
            </div>
          )}

          <section
            aria-labelledby="ai-settings-title"
            className="py-2 sm:py-3"
          >
            <div className="mb-4">
              <h2 id="ai-settings-title" className="font-semibold text-[#202126]">
                Gemini APIs
              </h2>
              <p className="mt-1 text-sm leading-5 text-[#777a81]">
                Gemini API keys are private to your signed-in account and sync across its devices.
                Keys are tried one by one, rotating after each successful request.
              </p>
            </div>

            {!isDatabaseReady && !databaseSessionError ? (
              <p className="rounded-2xl bg-[#f7f8fa] px-3.5 py-3 text-sm leading-5 text-[#686b72]">
                Preparing your secure account…
              </p>
            ) : databaseSessionError ? (
              <p className="rounded-2xl border border-red-100 bg-red-50 px-3.5 py-3 text-sm leading-5 text-red-800">
                Your account could not connect to the shared CheyaVerse database: {databaseSessionError}
              </p>
            ) : (
              <>
                <form
                  aria-label="Add Gemini API key"
                  className="space-y-3"
                  onSubmit={addApiKey}
                >
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <label className="block text-xs font-medium text-[#656870]">
                      Gemini model
                      <p className="mt-1.5 text-sm font-medium text-[#26272c]">
                        {selectedModel}
                      </p>
                    </label>
                    <div className="flex items-end text-xs text-[#777a81]">
                      Provider: <span className="ml-1 font-medium text-[#34363b]">Google Gemini</span>
                    </div>
                  </div>
                  <label className="block text-xs font-medium text-[#656870]">
                    Gemini API key
                    <span className="mt-1.5 flex h-11 items-center rounded-xl border border-[#e1e3e7] bg-white px-3 focus-within:border-[#9380dc]">
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={newApiKey}
                        onChange={(event) => setNewApiKey(event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="Paste your Gemini API key"
                        className="min-w-0 flex-1 bg-transparent text-sm text-[#26272c] outline-none placeholder:text-[#a2a3a7]"
                      />
                      <button
                        type="button"
                        aria-label={showApiKey ? "Hide API key" : "Show API key"}
                        onClick={() => setShowApiKey((visible) => !visible)}
                        className="ml-2 flex size-8 items-center justify-center rounded-full text-[#777a81] hover:bg-[#f4f5f7]"
                      >
                        {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </span>
                  </label>
                  <button
                    type="submit"
                    disabled={!isDatabaseReady || isAddingKey}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#26272c] px-4 text-sm font-medium text-white transition hover:bg-[#3a3b41] disabled:opacity-60"
                  >
                    {isAddingKey ? (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    ) : (
                      <Plus aria-hidden="true" className="size-4" />
                    )}
                    Add API key
                  </button>
                </form>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-[#34363b]">Configured APIs</h3>
                    <span className="text-xs text-[#888b91]">{apiKeys.length} total</span>
                  </div>
                  {isLoadingKeys ? (
                    <div
                      role="status"
                      aria-label="Loading Gemini API keys"
                      className="space-y-2"
                    >
                      <div className="h-16 rounded-2xl bg-[#f1f2f4]" />
                      <div className="h-16 rounded-2xl bg-[#f1f2f4]" />
                    </div>
                  ) : apiKeys.length === 0 ? (
                    <p className="py-4 text-center text-sm text-[#858890]">
                      No Gemini API keys added yet.
                    </p>
                  ) : (
                    apiKeys.map((apiKey, index) => (
                      <article
                        key={apiKey.id}
                        className="py-4"
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="truncate text-sm font-medium text-[#27282d]">
                                {apiKey.model}
                              </h4>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusStyle(apiKey.status)}`}
                              >
                                {statusLabel(apiKey.status)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-[#858890]">
                              Google Gemini · API {index + 1} · key ending{" "}
                              {apiKey.api_key.slice(-4)}
                            </p>
                            {apiKey.last_error && (
                              <p className="mt-1 line-clamp-2 text-xs text-red-700">
                                {apiKey.last_error}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            aria-label={`Test ${apiKey.model} API`}
                            title="Test API"
                            disabled={busyKeyId !== null}
                            onClick={() => void testApiKey(apiKey)}
                            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#e6e8eb] text-[#45474e] hover:bg-[#f7f8fa] disabled:opacity-50"
                          >
                            {busyKeyId === apiKey.id ? (
                              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                            ) : (
                              <Check aria-hidden="true" className="size-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${apiKey.model} API`}
                            title="Remove API"
                            disabled={busyKeyId !== null}
                            onClick={() => void removeApiKey(apiKey)}
                            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#e6e8eb] text-[#777a81] hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                          >
                            <Trash2 aria-hidden="true" className="size-4" />
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </>
            )}
          </section>

          <section
            aria-labelledby="gemini-tts-settings-title"
            className="border-t border-[#eceef1] py-2 sm:py-3"
          >
            <div className="mb-4">
              <h2 id="gemini-tts-settings-title" className="font-semibold text-[#202126]">
                Gemini text-to-speech
              </h2>
              <p className="mt-1 text-sm leading-5 text-[#777a81]">
                Add multiple keys; Cheya will try them in order and move to the next key if one
                fails. Keys are stored separately from chat keys. Speech uses {GEMINI_TTS_MODEL};
                access, billing, and quota may differ from your chat model. Testing generates a
                real audio sample and uses TTS quota.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-[#656870]">Gemini TTS API keys</p>
                {ttsApiKeys.map((apiKey, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-[#e1e3e7] bg-white px-3 focus-within:border-[#9380dc]">
                      <input
                        aria-label={`Gemini TTS API key ${index + 1}`}
                        type={showTtsApiKey ? "text" : "password"}
                        value={apiKey}
                        onChange={(event) => {
                          ttsDraftDirtyRef.current = true;
                          setTtsApiKeys((keys) =>
                            keys.map((key, keyIndex) =>
                              keyIndex === index ? event.target.value : key,
                            ),
                          );
                        }}
                        autoComplete="new-password"
                        spellCheck={false}
                        placeholder={`Paste Gemini TTS API key ${index + 1}`}
                        className="min-w-0 flex-1 bg-transparent text-sm text-[#26272c] outline-none placeholder:text-[#a2a3a7]"
                      />
                      <button
                        type="button"
                        aria-label={showTtsApiKey ? "Hide TTS API keys" : "Show TTS API keys"}
                        onClick={() => setShowTtsApiKey((visible) => !visible)}
                        className="ml-2 flex size-8 items-center justify-center rounded-full text-[#777a81] hover:bg-[#f4f5f7]"
                      >
                        {showTtsApiKey ? (
                          <EyeOff aria-hidden="true" className="size-4" />
                        ) : (
                          <Eye aria-hidden="true" className="size-4" />
                        )}
                      </button>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove Gemini TTS API key ${index + 1}`}
                      onClick={() => {
                        ttsDraftDirtyRef.current = true;
                        setTtsApiKeys((keys) => keys.filter((_, keyIndex) => keyIndex !== index));
                      }}
                      className="flex size-10 shrink-0 items-center justify-center rounded-full text-[#777a81] transition hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    ttsDraftDirtyRef.current = true;
                    setTtsApiKeys((keys) => [...keys, ""]);
                  }}
                  className="flex h-9 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-[#565961] transition hover:bg-[#f1f2f4]"
                >
                  <Plus aria-hidden="true" className="size-4" />
                  Add another TTS API key
                </button>
              </div>

              <div>
                <label className="text-xs font-medium text-[#656870]" id="tts-voice-label">
                  Voice used for all TTS API keys
                </label>
                <div ref={ttsVoicePickerRef} className="relative mt-1.5">
                  <button
                    type="button"
                    aria-labelledby="tts-voice-label"
                    aria-haspopup="listbox"
                    aria-expanded={isTtsVoiceMenuOpen}
                    onClick={() => setIsTtsVoiceMenuOpen((open) => !open)}
                    className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-[#e1e3e7] bg-white px-3.5 py-2.5 text-left transition hover:border-[#c9c4dc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a89bdf]"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#f3f1fb] text-xs font-semibold text-[#6554a4]">
                        {ttsVoice.slice(0, 1)}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-[#292a30]">
                          {ttsVoice}
                        </span>
                        <span className="block text-xs text-[#858890]">
                          {GEMINI_TTS_VOICES.find((voice) => voice.id === ttsVoice)?.description}
                        </span>
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={`size-4 shrink-0 text-[#777a81] transition-transform ${
                        isTtsVoiceMenuOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {isTtsVoiceMenuOpen && (
                    <div
                      role="listbox"
                      aria-labelledby="tts-voice-label"
                      className="absolute inset-x-0 top-[calc(100%+0.4rem)] z-20 max-h-64 overflow-y-auto rounded-xl border border-[#e6e7eb] bg-white p-1.5 shadow-[0_12px_32px_rgba(30,25,50,0.14)]"
                    >
                      {GEMINI_TTS_VOICES.map((voice) => {
                        const isSelected = ttsVoice === voice.id;
                        return (
                          <button
                            key={voice.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => {
                              ttsDraftDirtyRef.current = true;
                              setTtsVoice(voice.id);
                              setIsTtsVoiceMenuOpen(false);
                            }}
                            className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a89bdf] ${
                              isSelected ? "bg-[#f5f3fc]" : "hover:bg-[#f7f8fa]"
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2.5">
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white text-[11px] font-semibold text-[#6554a4] shadow-sm ring-1 ring-[#eceaf2]">
                                {voice.id.slice(0, 1)}
                              </span>
                              <span>
                                <span className="block text-sm font-medium text-[#292a30]">
                                  {voice.id}
                                </span>
                                <span className="block text-xs text-[#858890]">
                                  {voice.description}
                                </span>
                              </span>
                            </span>
                            {isSelected && (
                              <Check aria-hidden="true" className="size-4 shrink-0 text-[#7864c6]" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-xs leading-5 text-[#858890]">
                  This single voice setting applies to every key above, including fallback keys.
                  Cheya derives the delivery, mood, and intonation from each message.
                </p>
              </div>

              {ttsTestMessage && (
                <p
                  role={ttsPreviewUrl ? "status" : "alert"}
                  className={`text-sm leading-5 ${
                    ttsPreviewUrl ? "text-emerald-700" : "text-red-700"
                  }`}
                >
                  {ttsTestMessage}
                </p>
              )}
              {ttsPreviewUrl && (
                <audio
                  ref={ttsPreviewAudioRef}
                  aria-label="Gemini TTS voice preview"
                  className="w-full"
                  controls
                  src={ttsPreviewUrl}
                />
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void saveTtsSettings()}
                  disabled={
                    !isDatabaseReady ||
                    isLoadingPersonalization ||
                    !!personalizationError ||
                      isSavingTtsSettings ||
                      isSavingPersonalization
                    }
                  className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[#26272c] px-4 text-sm font-medium text-white transition hover:bg-[#3a3b41] disabled:opacity-60"
                >
                  {isSavingTtsSettings ? (
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Check aria-hidden="true" className="size-4" />
                  )}
                  Save TTS settings
                </button>
                <button
                  type="button"
                  onClick={() => void testGeminiTts()}
                  disabled={!isDatabaseReady || isTestingTtsApi}
                  className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[#e1e3e7] bg-white px-4 text-sm font-medium text-[#34363b] transition hover:bg-[#f7f8fa] disabled:opacity-60"
                >
                  {isTestingTtsApi ? (
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Play aria-hidden="true" className="size-4" />
                  )}
                  {isTestingTtsApi ? "Generating voice sample…" : "Test API & preview voice"}
                </button>
              </div>
            </div>
          </section>

            </>
          )}

          {activeSection === "memory" && (
            <section
              aria-labelledby="long-term-memory-title"
              className="py-2 sm:py-3"
            >
              <div className="mb-4">
                <h2 id="long-term-memory-title" className="font-semibold text-[#202126]">
                  Long-term memory
                </h2>
                <p className="mt-1 text-sm leading-5 text-[#777a81]">
                  Durable preferences and useful facts are searchable with RAG and can be created,
                  edited, or removed here. Cheya may remember important details from chat; short-lived
                  moods and sensitive inferences are not saved as memories.
                </p>
              </div>

              {(errorMessage || notice) && (
                <div
                  role={errorMessage ? "alert" : "status"}
                  className={`mb-4 rounded-2xl px-3.5 py-3 text-sm ${
                    errorMessage
                      ? "border border-red-100 bg-red-50 text-red-800"
                      : "border border-emerald-100 bg-emerald-50 text-emerald-800"
                  }`}
                >
                  {errorMessage || notice}
                </div>
              )}

              {!isDatabaseReady ? (
                <div className="space-y-3" aria-label="Loading long-term memories">
                  <div className="h-11 rounded-xl bg-[#f1f2f4]" />
                  <div className="h-24 rounded-2xl bg-[#f1f2f4]" />
                </div>
              ) : (
                <form className="space-y-3" onSubmit={saveMemory}>
                  <label className="block text-xs font-medium text-[#656870]">
                    Category
                    <input
                      value={memoryCategory}
                      onChange={(event) => {
                        memoryDraftDirtyRef.current = true;
                        setMemoryCategory(event.target.value);
                      }}
                      maxLength={80}
                      placeholder="e.g. preferences, goals, projects"
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#e1e3e7] bg-white px-3 text-sm text-[#26272c] outline-none focus:border-[#9380dc]"
                    />
                  </label>
                  <label className="block text-xs font-medium text-[#656870]">
                    What should Cheya remember?
                    <textarea
                      value={memoryContent}
                      onChange={(event) => {
                        memoryDraftDirtyRef.current = true;
                        setMemoryContent(event.target.value);
                      }}
                      maxLength={10000}
                      rows={3}
                      placeholder="A stable preference, important fact, goal, or ongoing project"
                      className="mt-1.5 w-full resize-y rounded-xl border border-[#e1e3e7] bg-white px-3 py-2.5 text-sm leading-5 text-[#26272c] outline-none focus:border-[#9380dc]"
                    />
                  </label>
                  {apiKeys.length === 0 && (
                    <p className="text-xs leading-5 text-amber-800">
                      Add a Gemini API key in Configure first so this memory can be indexed for RAG.
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    {editingMemoryId && (
                      <button
                        type="button"
                        onClick={resetMemoryForm}
                        className="h-10 rounded-full border border-[#e1e3e7] px-4 text-sm font-medium text-[#34363b] hover:bg-white"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={isSavingMemory || apiKeys.length === 0}
                      className="flex h-10 items-center justify-center gap-2 rounded-full bg-[#26272c] px-4 text-sm font-medium text-white transition hover:bg-[#3a3b41] disabled:opacity-60"
                    >
                      {isSavingMemory ? (
                        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                      ) : editingMemoryId ? (
                        <Pencil aria-hidden="true" className="size-4" />
                      ) : (
                        <Plus aria-hidden="true" className="size-4" />
                      )}
                      {editingMemoryId ? "Update memory" : "Save memory"}
                    </button>
                  </div>
                </form>
              )}

              <div className="mt-5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[#34363b]">Saved memories</h3>
                  <span className="text-xs text-[#888b91]">{memories.length} total</span>
                </div>
                {isLoadingMemories ? (
                  <div className="space-y-2" aria-label="Loading saved memories">
                    {[0, 1, 2].map((item) => (
                      <div key={item} className="h-20 rounded-2xl bg-[#f1f2f4]" />
                    ))}
                  </div>
                ) : memories.length === 0 ? (
                  <p className="py-4 text-center text-sm text-[#858890]">
                    No long-term memories saved yet.
                  </p>
                ) : (
                  memories.map((memory) => (
                    <article key={memory.id} className="relative py-4">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-[#858890]">
                          {memory.category}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-[#34363b]">
                          {memory.content}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Edit memory: ${memory.content.slice(0, 40)}`}
                        onClick={() => {
                          setEditingMemoryId(memory.id);
                          memoryDraftDirtyRef.current = false;
                          setMemoryContent(memory.content);
                          setMemoryCategory(memory.category);
                          settingsContentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="absolute right-11 top-3 flex size-9 items-center justify-center rounded-full border border-[#e6e8eb] bg-white/90 text-[#45474e] shadow-sm hover:bg-white"
                      >
                        <Pencil aria-hidden="true" className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete memory: ${memory.content.slice(0, 40)}`}
                        onClick={() => void deleteMemory(memory)}
                        className="absolute right-0 top-3 flex size-9 items-center justify-center rounded-full border border-[#e6e8eb] bg-white/90 text-[#777a81] shadow-sm hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </button>
                    </article>
                  ))
                )}
              </div>

              <div className="mt-6 pt-5">
                <h3 className="text-sm font-semibold text-[#34363b]">Chat history</h3>
                <p className="mt-1 text-sm leading-5 text-[#777a81]">
                  Clear all chat messages and their insights without removing long-term memories,
                  API keys, or settings.
                </p>
                <button
                  type="button"
                  onClick={() => setIsClearChatsConfirmationOpen(true)}
                  disabled={isClearingChats || !isDatabaseReady}
                  className="mt-3 flex h-10 items-center justify-center gap-2 rounded-full border border-red-200 px-4 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isClearingChats ? (
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Trash2 aria-hidden="true" className="size-4" />
                  )}
                  {isClearingChats ? "Clearing chats…" : "Clear chats"}
                </button>
              </div>
            </section>
          )}
        </div>
        </div>
      </section>

      {isClearChatsConfirmationOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isClearingChats) {
              setIsClearChatsConfirmationOpen(false);
            }
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-chats-title"
            aria-describedby="clear-chats-description"
            className="w-full max-w-md rounded-[26px] border border-[#e2e4e8] bg-white p-5 shadow-2xl"
          >
            <h2 id="clear-chats-title" className="text-base font-semibold text-[#22242a]">
              Clear all chats?
            </h2>
            <p id="clear-chats-description" className="mt-2 text-sm leading-6 text-[#64666d]">
              This permanently deletes all chat messages and their insights. Long-term memories,
              API keys, and settings will be kept. This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isClearingChats}
                onClick={() => setIsClearChatsConfirmationOpen(false)}
                className="h-10 rounded-full border border-[#e5e6e9] px-4 text-sm font-medium text-[#34363b] hover:bg-[#f7f8fa] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isClearingChats || !isDatabaseReady}
                onClick={() => {
                  setIsClearChatsConfirmationOpen(false);
                  void clearChats();
                }}
                className="flex h-10 items-center gap-2 rounded-full bg-red-700 px-4 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
              >
                {isClearingChats && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                Clear chats
              </button>
            </div>
          </section>
        </div>
      )}

      {isDeleteAccountDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isDeletingAccount) {
              setIsDeleteAccountDialogOpen(false);
            }
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            aria-describedby="delete-account-description"
            className="w-full max-w-md rounded-[26px] border border-[#e2e4e8] bg-white p-5 shadow-2xl"
          >
            <h2 id="delete-account-title" className="text-base font-semibold text-[#22242a]">
              Delete your account permanently?
            </h2>
            <p id="delete-account-description" className="mt-2 text-sm leading-6 text-[#64666d]">
              This permanently deletes your CheyaAPP account, conversations, settings, API keys,
              memories, and stored files. This cannot be undone. Type <strong>DELETE</strong> to
              confirm.
            </p>
            <input
              autoFocus
              value={deleteAccountConfirmation}
              onChange={(event) => setDeleteAccountConfirmation(event.target.value)}
              aria-label="Type DELETE to confirm account deletion"
              autoComplete="off"
              className="mt-4 h-11 w-full rounded-xl border border-[#e1e3e7] bg-white px-3 text-sm outline-none focus:border-red-500"
            />
            {errorMessage && (
              <p role="alert" className="mt-3 text-sm leading-5 text-red-700">
                {errorMessage}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isDeletingAccount}
                onClick={() => setIsDeleteAccountDialogOpen(false)}
                className="h-10 rounded-full border border-[#e5e6e9] px-4 text-sm font-medium text-[#34363b] hover:bg-[#f7f8fa] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingAccount || deleteAccountConfirmation !== "DELETE"}
                onClick={() => void deleteAccount()}
                className="flex h-10 items-center gap-2 rounded-full bg-red-700 px-4 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
              >
                {isDeletingAccount ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <Trash2 aria-hidden="true" className="size-4" />
                )}
                Delete account
              </button>
            </div>
          </section>
        </div>
      )}

      {isHelpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsHelpOpen(false);
          }}
        >
          <section
            aria-labelledby="setup-help-title"
            aria-modal="true"
            role="dialog"
            className="max-h-[min(90dvh,900px)] w-full max-w-[680px] overflow-y-auto rounded-2xl border border-[#dfe3e8] bg-white p-5 shadow-[0_24px_72px_rgba(20,28,40,0.22)] sm:p-7"
          >
            <header className="mb-5">
              <h2 id="setup-help-title" className="text-lg font-semibold text-[#202126]">
                Gemini API setup
              </h2>
              <p className="mt-1 text-sm leading-5 text-[#777a81]">
                CheyaVerse manages the database and Google sign-in. You only need to add your own
                Gemini API key.
              </p>
            </header>

            <ol className="space-y-3 text-sm leading-6 text-[#55575e]">
              <li>
                <strong className="text-[#27282d]">1. Create a Gemini API key.</strong>
                <p className="mt-1">
                  Open{" "}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[#4d65ba] underline underline-offset-2"
                  >
                    Google AI Studio API Keys
                  </a>
                  , create an API key, and copy it. Never share your key publicly.
                </p>
              </li>
              <li>
                <strong className="text-[#27282d]">2. Add it to your account.</strong>
                <p className="mt-1">
                  Paste the key under <b>Gemini APIs</b> and click <b>Add API key</b>. Use the test
                  button to verify it. The key is stored with your account and syncs across devices.
                </p>
              </li>
            </ol>

            <div className="mt-5 rounded-lg border border-amber-200 bg-[#fff9eb] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                Keep credentials private
              </p>
              <p className="mt-1.5 text-xs leading-5 text-amber-900">
                Do not paste Google OAuth credentials, database credentials, or service-role keys
                here. Account sign-in, bot protection, and database infrastructure are managed by
                CheyaVerse.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsHelpOpen(false)}
              className="mt-5 h-11 w-full rounded-lg bg-[#26272c] text-sm font-medium text-white hover:bg-[#3a3b41]"
            >
              Got it
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
