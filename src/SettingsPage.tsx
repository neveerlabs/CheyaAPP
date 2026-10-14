import {
  ArrowLeft,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Bug,
  Eye,
  EyeOff,
  LoaderCircle,
  KeyRound,
  Plus,
  SlidersHorizontal,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { generateGeminiReply, GeminiFailoverError } from "./lib/gemini";
import {
  DEFAULT_PERSONALIZATION,
  ensureSupabaseSession,
  GEMINI_MODELS,
  saveApiStatus,
  type ApiStatus,
  type AppSupabaseClient,
  type GeminiApiKey,
  type GeminiModel,
  type PersonalizationSettings,
} from "./lib/supabase";

interface SettingsPageProps {
  pathname: string;
  onNavigate: (path: string) => void;
  onBack: () => void;
  client: AppSupabaseClient;
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

type SettingsSection = "home" | "personal" | "configure" | "memory";

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
    description: "Account sync and Gemini API keys",
    icon: SlidersHorizontal,
  },
  {
    id: "memory",
    label: "Memory",
    description: "Memory settings will be available here later",
    icon: Brain,
  },
];

function sectionFromPath(pathname: string): SettingsSection {
  const section = pathname.split("/")[2];
  return section === "personal" || section === "configure" || section === "memory"
    ? section
    : "home";
}

export function SettingsPage({
  pathname,
  onNavigate,
  onBack,
  client,
  accountEmail,
  onGeminiKeyChange,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState(() => sectionFromPath(pathname));
  const [isDatabaseReady, setIsDatabaseReady] = useState(false);
  const [databaseSessionError, setDatabaseSessionError] = useState("");
  const [apiKeys, setApiKeys] = useState<GeminiApiKey[]>([]);
  const [personalization, setPersonalization] =
    useState<PersonalizationSettings>(DEFAULT_PERSONALIZATION);
  const [personalizationError, setPersonalizationError] = useState("");
  const [selectedModel, setSelectedModel] = useState<GeminiModel>(GEMINI_MODELS[0]);
  const [newApiKey, setNewApiKey] = useState("");
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isSavingPersonalization, setIsSavingPersonalization] = useState(false);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [isLoadingPersonalization, setIsLoadingPersonalization] = useState(false);
  const [isAddingKey, setIsAddingKey] = useState(false);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const settingsContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveSection(sectionFromPath(pathname));
    setErrorMessage("");
    setNotice("");
    if (settingsContentRef.current) settingsContentRef.current.scrollTop = 0;
  }, [pathname]);

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
          .select("display_name, custom_prompt, chat_style")
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
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) {
        throw new Error(
          `Could not save Personal settings. The CheyaVerse database may need the latest supabase/schema.sql. ${error.message}`,
        );
      }

      setNotice("Personal settings saved to your CheyaVerse account.");
    } catch (error) {
      const detail = getErrorMessage(error);
      setPersonalizationError(detail);
      setErrorMessage(detail);
    } finally {
      setIsSavingPersonalization(false);
    }
  }

  async function signOut() {
    clearMessages();
    setIsSigningOut(true);
    try {
      const { error } = await client.auth.signOut();
      if (error) setErrorMessage(`Could not sign out: ${error.message}`);
    } catch (error) {
      setErrorMessage(`Could not sign out: ${getErrorMessage(error)}`);
    } finally {
      setIsSigningOut(false);
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

  return (
    <main className="fixed inset-0 flex justify-center bg-white">
      <section
        aria-label="Settings"
        className="relative h-full w-full max-w-[680px] overflow-hidden bg-white sm:my-5 sm:h-[calc(100%-40px)] sm:rounded-[30px]"
      >
        <header className="absolute inset-x-0 top-0 z-20 flex h-[68px] items-center gap-2 border-0 bg-transparent px-1 shadow-none sm:px-4">
          <button
            type="button"
            aria-label={activeSection === "home" ? "Back to chat" : "Back to settings"}
            onClick={goBack}
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] bg-white text-[#34363b] transition hover:bg-[#f7f8fa]"
          >
            <ArrowLeft aria-hidden="true" className="size-[21px]" />
          </button>
          <h1 className="flex h-11 min-w-0 flex-1 items-center rounded-full border border-[#e5e6e9] bg-white px-4 text-lg font-semibold text-[#17181b]">
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
          className="absolute inset-0 overflow-y-auto overscroll-contain bg-transparent px-4 pb-6 pt-[88px] sm:px-6 sm:pb-8"
        >
          {activeSection === "home" && (
            <nav aria-label="Settings pages" className="space-y-3">
              {settingsSections.map(({ id, label, description, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => openSection(id)}
                  className="flex w-full items-center gap-3 rounded-[22px] border border-[#e6e8eb] bg-white p-4 text-left transition hover:bg-[#f8f9fb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9380dc] sm:p-5"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#f3efff] text-[#7754ce]">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[#202126]">{label}</span>
                    <span className="mt-1 block text-sm leading-5 text-[#777a81]">
                      {description}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-[#96989d]" />
                </button>
              ))}
            </nav>
          )}

          {activeSection === "personal" && (
            <section
              aria-labelledby="personal-settings-title"
              className="rounded-[24px] border border-[#e6e8eb] p-4 sm:p-5"
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
                <p className="flex items-center gap-2 py-4 text-sm text-[#777a81]">
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  Loading personal settings…
                </p>
              ) : (
                <form className="space-y-4" onSubmit={savePersonalization}>
                  <label className="block text-xs font-medium text-[#656870]">
                    Name
                    <input
                      value={personalization.display_name}
                      onChange={(event) =>
                        setPersonalization((current) => ({
                          ...current,
                          display_name: event.target.value,
                        }))
                      }
                      maxLength={80}
                      placeholder="What should CheyaVerse call you?"
                      className="mt-1.5 h-11 w-full rounded-xl border border-[#e1e3e7] bg-white px-3 text-sm text-[#26272c] outline-none focus:border-[#9380dc]"
                    />
                  </label>
                  <label className="block text-xs font-medium text-[#656870]">
                    Custom prompt
                    <textarea
                      value={personalization.custom_prompt}
                      onChange={(event) =>
                        setPersonalization((current) => ({
                          ...current,
                          custom_prompt: event.target.value,
                        }))
                      }
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
                      onChange={(event) =>
                        setPersonalization((current) => ({
                          ...current,
                          chat_style: event.target.value,
                        }))
                      }
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
                      !isDatabaseReady || isLoadingPersonalization || !!personalizationError || isSavingPersonalization
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
            className="rounded-[24px] border border-[#e6e8eb] p-4 sm:p-5"
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#f3efff] text-[#7754ce]">
                <KeyRound aria-hidden="true" className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="ai-settings-title" className="font-semibold text-[#202126]">
                  Gemini APIs
                </h2>
                <p className="mt-1 text-sm leading-5 text-[#777a81]">
                  Gemini API keys are private to your signed-in account and sync across its devices.
                  Keys are tried one by one, rotating after each successful request.
                </p>
              </div>
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
                  className="space-y-3 rounded-2xl bg-[#f7f8fa] p-3.5"
                  onSubmit={addApiKey}
                >
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="block text-xs font-medium text-[#656870]">
                      Gemini model
                      <select
                        value={selectedModel}
                        onChange={(event) => {
                          const model = GEMINI_MODELS.find(
                            (candidate) => candidate === event.currentTarget.value,
                          );
                          if (model) setSelectedModel(model);
                        }}
                        className="mt-1.5 h-11 w-full rounded-xl border border-[#e1e3e7] bg-white px-3 text-sm text-[#26272c] outline-none focus:border-[#9380dc]"
                      >
                        {GEMINI_MODELS.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
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
                    <p className="flex items-center gap-2 py-4 text-sm text-[#777a81]">
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                      Loading API keys…
                    </p>
                  ) : apiKeys.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-[#dfe1e5] px-3 py-4 text-center text-sm text-[#858890]">
                      No Gemini API keys added yet.
                    </p>
                  ) : (
                    apiKeys.map((apiKey, index) => (
                      <article
                        key={apiKey.id}
                        className="rounded-2xl border border-[#eceef0] px-3.5 py-3"
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
            aria-labelledby="account-settings-title"
            className="rounded-[24px] border border-[#e6e8eb] p-4 sm:p-5"
          >
            <div className="mb-4">
              <h2 id="account-settings-title" className="font-semibold text-[#202126]">
                Account sync
              </h2>
              <p className="mt-1 text-sm leading-5 text-[#777a81]">
                Your private settings, Gemini API keys, chats, and memories sync through your account.
              </p>
            </div>
            {!isDatabaseReady ? (
              <p className="rounded-2xl bg-[#f7f8fa] px-3.5 py-3 text-sm leading-5 text-[#686b72]">
                Preparing your signed-in account…
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 rounded-2xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
                  <Check aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 truncate">
                    {accountEmail ?? "Google account connected"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  disabled={isSigningOut}
                  className="flex h-10 items-center justify-center gap-2 rounded-full border border-[#e1e3e7] px-4 text-sm font-medium text-[#34363b] hover:bg-[#f7f8fa] disabled:opacity-60"
                >
                  {isSigningOut ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  ) : null}
                  Sign out
                </button>
              </div>
            )}
            <p className="mt-3 text-xs leading-5 text-[#858890]">
              CheyaVerse manages the shared database. Your data is isolated from other accounts;
              configure only your Gemini API key below.
            </p>
          </section>
            </>
          )}
        </div>
      </section>

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
            className="max-h-[min(90dvh,900px)] w-full max-w-[680px] overflow-y-auto rounded-[26px] bg-white p-5 shadow-2xl sm:p-6"
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

            <ol className="space-y-4 text-sm leading-6 text-[#55575e]">
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

            <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-900">
              Do not paste Google OAuth credentials, database credentials, or service-role keys
              here. Account sign-in, bot protection, and database infrastructure are managed by
              CheyaVerse.
            </div>
            <button
              type="button"
              onClick={() => setIsHelpOpen(false)}
              className="mt-5 h-11 w-full rounded-xl bg-[#26272c] text-sm font-medium text-white hover:bg-[#3a3b41]"
            >
              Got it
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
