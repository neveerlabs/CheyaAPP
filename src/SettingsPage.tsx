import {
  ArrowLeft,
  Check,
  CircleAlert,
  CircleHelp,
  Copy,
  Database,
  Bug,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import schemaSql from "../supabase/schema.sql?raw";
import { generateGeminiReply, GeminiFailoverError } from "./lib/gemini";
import {
  createSupabaseClient,
  ensureSupabaseSession,
  GEMINI_MODELS,
  loadDatabaseConfig,
  saveApiStatus,
  saveDatabaseConfig,
  type ApiStatus,
  type AppSupabaseClient,
  type DatabaseConfig,
  type GeminiApiKey,
  type GeminiModel,
} from "./lib/supabase";

interface SettingsPageProps {
  onBack: () => void;
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

const sqlTokens =
  /(--[^\n]*|'(?:''|[^'])*'|\b(?:alter|and|cascade|check|create|default|delete|drop|enable|exists|for|grant|if|index|insert|not|null|on|or|owner|policy|primary|public|references|row|level|security|select|set|table|to|update|using|with)\b|\b(?:auth|authenticated|gen_random_uuid|now|public)\b|\b(?:true|false)\b)/gi;

function highlightSql(source: string) {
  return source.split(sqlTokens).map((token, index) => {
    if (token.startsWith("--")) {
      return (
        <span key={index} className="text-[#8892a6]">
          {token}
        </span>
      );
    }
    if (token.startsWith("'")) {
      return (
        <span key={index} className="text-[#a5d6a7]">
          {token}
        </span>
      );
    }
    if (/^(auth|authenticated|gen_random_uuid|now|public)$/i.test(token)) {
      return (
        <span key={index} className="text-[#82b1ff]">
          {token}
        </span>
      );
    }
    if (/^(true|false)$/i.test(token)) {
      return (
        <span key={index} className="text-[#ffcc80]">
          {token}
        </span>
      );
    }
    if (token.trim()) {
      return (
        <span key={index} className="text-[#c792ea]">
          {token}
        </span>
      );
    }
    return token;
  });
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [config, setConfig] = useState<DatabaseConfig | null>(null);
  const [client, setClient] = useState<AppSupabaseClient | null>(null);
  const [isDatabaseReady, setIsDatabaseReady] = useState(false);
  const [databaseSessionError, setDatabaseSessionError] = useState("");
  const [apiKeys, setApiKeys] = useState<GeminiApiKey[]>([]);
  const [selectedModel, setSelectedModel] = useState<GeminiModel>(GEMINI_MODELS[0]);
  const [newApiKey, setNewApiKey] = useState("");
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isSavingDatabase, setIsSavingDatabase] = useState(false);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [isAddingKey, setIsAddingKey] = useState(false);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [showPublishableKey, setShowPublishableKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [sqlCopied, setSqlCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const settingsContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = loadDatabaseConfig();
      if (saved) {
        setConfig(saved);
        setDatabaseUrl(saved.url);
        setPublishableKey(saved.publishableKey);
        setClient(createSupabaseClient(saved));
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    if (!client) {
      setIsDatabaseReady(false);
      setApiKeys([]);
      return;
    }

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
    if (!client || !isDatabaseReady || !config) return;

    let isMounted = true;
    void (async () => {
      try {
        const { data, error } = await client.auth.getUser();
        if (error) throw error;
        if (!data.user) throw new Error("The private Supabase session has no user ID.");

        const { error: saveError } = await client.from("user_settings").upsert(
          {
            user_id: data.user.id,
            supabase_url: config.url,
            publishable_key: config.publishableKey,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        if (saveError) throw saveError;
        if (isMounted) {
          setNotice("Supabase connection and Gemini settings are saved to your database.");
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(`Database settings could not be saved: ${getErrorMessage(error)}`);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [client, config, isDatabaseReady]);

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

  async function saveDatabase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    setDatabaseSessionError("");

    const normalizedUrl = databaseUrl.trim().replace(/\/+$/, "");
    const nextConfig = {
      url: normalizedUrl,
      publishableKey: publishableKey.trim(),
    };

    try {
      const parsedUrl = new URL(nextConfig.url);
      if (parsedUrl.protocol !== "https:") {
        throw new Error("Use the HTTPS Project URL from your Supabase project settings.");
      }
      if (parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash) {
        throw new Error("Enter only the Supabase Project URL, without a path or query string.");
      }
      if (!nextConfig.publishableKey) {
        throw new Error("Enter the Supabase publishable (anon) key.");
      }

      setIsSavingDatabase(true);
      let response: Response;
      try {
        response = await fetch(`${parsedUrl.origin}/auth/v1/settings`, {
          headers: { apikey: nextConfig.publishableKey },
          signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") {
          throw new Error("Supabase did not respond within 10 seconds. Check the Project URL and try again.");
        }
        throw new Error(
          "Could not reach Supabase Auth. Check the Project URL, publishable key, and network connection.",
        );
      }
      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(
          `Supabase rejected this connection (HTTP ${response.status}). ${
            responseText || "Check that the Project URL and publishable key belong to the same project."
          }`,
        );
      }

      saveDatabaseConfig(nextConfig);
      setConfig(nextConfig);
      setClient(createSupabaseClient(nextConfig));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSavingDatabase(false);
    }
  }

  async function addApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    if (!client || !isDatabaseReady) {
      setErrorMessage("Connect your Supabase database before adding API keys.");
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
      setNotice("Gemini API key removed.");
    } catch (error) {
      setErrorMessage(`Could not remove the API key: ${getErrorMessage(error)}`);
    } finally {
      setBusyKeyId(null);
    }
  }

  async function copySql() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(schemaSql);
      } else {
        throw new Error("Clipboard API is unavailable.");
      }
      setSqlCopied(true);
      window.setTimeout(() => setSqlCopied(false), 2000);
    } catch {
      let copied = false;
      const textarea = document.createElement("textarea");
      try {
        textarea.value = schemaSql;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      } finally {
        textarea.remove();
      }

      if (copied) {
        setSqlCopied(true);
        window.setTimeout(() => setSqlCopied(false), 2000);
      } else {
        setErrorMessage("Could not copy the SQL. Select the code block and copy it manually.");
      }
    }
  }

  return (
    <main className="fixed inset-0 flex justify-center bg-white">
      <section
        aria-label="Settings"
        className="flex h-full w-full max-w-[680px] flex-col overflow-hidden bg-transparent sm:my-5 sm:h-[calc(100%-40px)] sm:rounded-[30px]"
      >
        <header className="relative z-10 mb-3 flex h-[68px] shrink-0 items-center gap-2 border-0 bg-transparent px-1 shadow-none sm:px-4">
          <button
            type="button"
            aria-label="Back to chat"
            onClick={onBack}
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#e5e6e9] text-[#34363b] transition hover:bg-[#f7f8fa]"
          >
            <ArrowLeft aria-hidden="true" className="size-[21px]" />
          </button>
          <h1 className="flex h-11 min-w-0 flex-1 items-center rounded-full border border-[#e5e6e9] px-4 text-lg font-semibold text-[#17181b]">
            Settings
          </h1>
          <nav
            aria-label="Settings actions"
            className="flex h-11 shrink-0 items-center gap-0.5 rounded-full border border-[#e5e6e9] bg-transparent p-0.5"
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
              aria-label="Setup help"
              title="Setup help"
              onClick={() => setIsHelpOpen(true)}
              className="flex size-9 items-center justify-center rounded-full text-[#34363b] transition hover:bg-[#f7f8fa]"
            >
              <CircleHelp aria-hidden="true" className="size-[21px]" />
            </button>
          </nav>
        </header>

        <div
          ref={settingsContentRef}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain bg-white px-4 py-5 sm:rounded-b-[24px] sm:px-6 sm:py-6"
        >
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
                  Gemini API keys are private to this browser&apos;s Supabase session. Keys are tried
                  one by one, rotating after each successful request.
                </p>
              </div>
            </div>

            {!client || (!isDatabaseReady && !databaseSessionError) ? (
              <p className="rounded-2xl bg-[#f7f8fa] px-3.5 py-3 text-sm leading-5 text-[#686b72]">
                {!client
                  ? "Connect your Supabase database below to add and manage Gemini API keys."
                  : "Preparing your private database session…"}
              </p>
            ) : databaseSessionError ? (
              <p className="rounded-2xl border border-red-100 bg-red-50 px-3.5 py-3 text-sm leading-5 text-red-800">
                Database session could not start. In Supabase, enable{" "}
                <b>Authentication → Sign In / Providers → Anonymous Sign-Ins</b>, then click{" "}
                <b>Save and connect</b> again.
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
            aria-labelledby="database-settings-title"
            className="rounded-[24px] border border-[#e6e8eb] p-4 sm:p-5"
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eaf5ff] text-[#3186c4]">
                <Database aria-hidden="true" className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="database-settings-title" className="font-semibold text-[#202126]">
                  Supabase database
                </h2>
                <p className="mt-1 text-sm leading-5 text-[#777a81]">
                  Connect your own project. The connection is saved on this device and in your
                  database. A private anonymous session keeps your settings and API keys separate.
                </p>
              </div>
            </div>

            <form className="space-y-3" onSubmit={saveDatabase}>
              <label className="block text-xs font-medium text-[#656870]">
                Project URL
                <input
                  type="url"
                  value={databaseUrl}
                  onChange={(event) => setDatabaseUrl(event.target.value)}
                  placeholder="https://your-project.supabase.co"
                  autoComplete="url"
                  className="mt-1.5 h-11 w-full rounded-xl border border-[#e1e3e7] bg-white px-3 text-sm text-[#26272c] outline-none focus:border-[#9380dc]"
                />
              </label>
              <label className="block text-xs font-medium text-[#656870]">
                Publishable key (anon)
                <span className="mt-1.5 flex h-11 items-center rounded-xl border border-[#e1e3e7] bg-white px-3 focus-within:border-[#9380dc]">
                  <input
                    type={showPublishableKey ? "text" : "password"}
                    value={publishableKey}
                    onChange={(event) => setPublishableKey(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Paste your project's publishable key"
                    className="min-w-0 flex-1 bg-transparent text-sm text-[#26272c] outline-none placeholder:text-[#a2a3a7]"
                  />
                  <button
                    type="button"
                    aria-label={showPublishableKey ? "Hide publishable key" : "Show publishable key"}
                    onClick={() => setShowPublishableKey((visible) => !visible)}
                    className="ml-2 flex size-8 items-center justify-center rounded-full text-[#777a81] hover:bg-[#f4f5f7]"
                  >
                    {showPublishableKey ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </span>
              </label>
              <button
                type="submit"
                disabled={isSavingDatabase}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#e1e3e7] bg-white px-4 text-sm font-medium text-[#34363b] transition hover:bg-[#f7f8fa] disabled:opacity-60"
              >
                {isSavingDatabase && (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                )}
                Save and connect
              </button>
            </form>

            <p className="mt-3 text-xs leading-5 text-[#858890]">
              Use only the publishable/anon key here. Never enter a Supabase service-role or secret
              key in a browser app.
            </p>
          </section>
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
                Setup guide
              </h2>
              <p className="mt-1 text-sm leading-5 text-[#777a81]">
                Follow these steps to connect your own database and Gemini API keys.
              </p>
            </header>

            <ol className="space-y-5 text-sm leading-6 text-[#55575e]">
              <li>
                <strong className="text-[#27282d]">1. Create a Supabase account and project.</strong>
                <p className="mt-1">
                  Open{" "}
                  <a
                    href="https://supabase.com/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[#4d65ba] underline underline-offset-2"
                  >
                    supabase.com/dashboard
                  </a>{" "}
                  and sign in or create an account. Click <b>New project</b>, choose your
                  organization, then fill in the project name, a strong database password, and a
                  region close to you. Save the database password somewhere secure; this app does
                  not ask for or use it. Wait until the project has finished provisioning.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-5">
                  <li>Use your own project: every user needs their own Supabase project.</li>
                  <li>Never paste the database password or service-role/secret key into this app.</li>
                  <li>Keep the project region and database password details for your own records.</li>
                </ul>
              </li>
              <li>
                <strong className="text-[#27282d]">2. Enable anonymous sessions.</strong>
                <p className="mt-1">
                  In the Supabase dashboard, open <b>Authentication → Sign In / Providers</b> and
                  enable <b>Anonymous Sign-Ins</b>. The app creates a private Supabase session
                  automatically; you do not need to enter an email or password. RLS keeps rows
                  separated between browser sessions.
                </p>
                <p className="mt-2 text-xs leading-5 text-amber-800">
                  This session is tied to this browser. Clearing browser data or moving to another
                  device loses access to its Gemini keys; there is no account recovery.
                </p>
              </li>
              <li>
                <strong className="text-[#27282d]">3. Create the tables and access policies.</strong>
                <p className="mt-1">
                  Open <b>SQL Editor → New query</b> in your project. Copy the complete SQL below,
                  paste it into the editor, and click <b>Run</b>. It creates both tables and enables
                  Row Level Security (RLS) so each anonymous session can access only its own rows.
                </p>
                <div className="relative mt-3 overflow-hidden rounded-2xl border border-[#202638] bg-[#111827]">
                  <div className="flex h-11 items-center justify-between border-b border-white/10 bg-[#182132] px-3">
                    <span className="font-mono text-xs text-[#b8c3d8]">supabase/schema.sql</span>
                    <button
                      type="button"
                      onClick={() => void copySql()}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-xs font-medium text-[#e3e9f7] hover:bg-white/10"
                    >
                      {sqlCopied ? (
                        <Check aria-hidden="true" className="size-3.5 text-[#a5d6a7]" />
                      ) : (
                        <Copy aria-hidden="true" className="size-3.5" />
                      )}
                      {sqlCopied ? "Copied" : "Copy SQL"}
                    </button>
                  </div>
                  <pre
                    aria-label="Supabase schema SQL"
                    className="max-h-[38dvh] overflow-auto p-4 text-left font-mono text-[11px] leading-[1.65] text-[#d1d9e8] sm:text-xs"
                  >
                    <code>{highlightSql(schemaSql)}</code>
                  </pre>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#858890]">
                  If you already ran an older version of this script, run this updated script again
                  so new Gemini API rows get the current session&apos;s user ID automatically.
                </p>
              </li>
              <li>
                <strong className="text-[#27282d]">4. Copy the Supabase connection details.</strong>
                <p className="mt-1">
                  In the dashboard, open <b>Project Settings → API</b> (or <b>API Keys</b>). Copy
                  the <b>Project URL</b> and the <b>publishable key</b> (or legacy <b>anon</b>{" "}
                  key). Return here, enter both in <b>Supabase database</b>, then click{" "}
                  <b>Save and connect</b>. The app checks Supabase, creates a private anonymous
                  session, and saves the connection settings to the database. Do not use the{" "}
                  <b>secret</b> or <b>service_role</b> key.
                </p>
              </li>
              <li>
                <strong className="text-[#27282d]">5. Create a Gemini API key.</strong>
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
                  , sign in with Google, choose <b>Create API key</b>, select your Google Cloud
                  project if prompted, and copy the key. Check the project&apos;s Gemini API access,
                  billing, and usage limits in Google AI Studio/Cloud Console.
                </p>
              </li>
              <li>
                <strong className="text-[#27282d]">6. Add and test Gemini APIs.</strong>
                <p className="mt-1">
                  In <b>Gemini APIs</b>, choose{" "}
                  <code className="rounded bg-[#f2f3f5] px-1 py-0.5 text-xs">
                    gemini-3.1-flash-lite
                  </code>{" "}
                  or{" "}
                  <code className="rounded bg-[#f2f3f5] px-1 py-0.5 text-xs">
                    gemini-3.5-flash-lite
                  </code>
                  , paste the key, and click <b>Add API key</b>. Add more keys if you want. Press
                  the check button next to a key to send a small test request. A successful test
                  marks that entry Active. Chat tries keys in rotation and automatically moves to
                  another one when a Gemini request fails.
                </p>
              </li>
            </ol>

            <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-900">
              The Supabase URL and publishable key are kept on this device to establish the
              connection. Gemini keys are stored in your Supabase database with RLS. Gemini
              requests run from your browser. The private anonymous session is specific to this
              browser and cannot be recovered if its browser data is cleared.
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
