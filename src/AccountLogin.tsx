import { useEffect, useRef, useState, type FormEvent } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { CircleAlert, LoaderCircle } from "lucide-react";
import cheyaLogo from "../assets/circle.png";
import { signInWithGoogle, type AppSupabaseClient } from "./lib/supabase";

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentityApi {
  initialize(options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
  }): void;
  renderButton(
    element: HTMLElement,
    options: {
      theme: "outline";
      size: "large";
      text: "continue_with";
      shape: "pill";
      width: number;
    },
  ): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleIdentityApi;
      };
    };
  }
}

let googleSdkPromise: Promise<void> | null = null;

function loadGoogleIdentitySdk(): Promise<void> {
  if (window.google?.accounts.id) return Promise.resolve();
  if (googleSdkPromise) return googleSdkPromise;

  googleSdkPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    const script = existingScript ?? document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      googleSdkPromise = null;
      reject(new Error("Could not load Google Sign-In. Check your connection and try again."));
    };
    if (!existingScript) document.head.append(script);
  });
  return googleSdkPromise;
}

interface AccountLoginProps {
  client: AppSupabaseClient | null;
  error: string;
}

export function AccountLogin({ client, error: initialError }: AccountLoginProps) {
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaRound, setCaptchaRound] = useState(0);
  const [accessCode, setAccessCode] = useState<string[]>(Array(6).fill(""));
  const [isCodeVerified, setIsCodeVerified] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState(initialError);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const accessCodeRefs = useRef<Array<HTMLInputElement | null>>([]);
  const captchaTokenRef = useRef<string | null>(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? "";
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";

  useEffect(() => {
    setError(initialError);
  }, [initialError]);

  useEffect(() => {
    captchaTokenRef.current = captchaToken;
    if (!captchaToken || !isCodeVerified || !client || !googleClientId || isSigningIn) {
      googleButtonRef.current?.replaceChildren();
      return;
    }

    let isMounted = true;
    void loadGoogleIdentitySdk()
      .then(() => {
        if (!isMounted || !googleButtonRef.current || !window.google) return;
        const identityApi = window.google.accounts.id;
        identityApi.initialize({
          client_id: googleClientId,
          auto_select: false,
          callback: ({ credential }) => {
            const verifiedCaptcha = captchaTokenRef.current;
            if (!verifiedCaptcha) {
              setError("Complete the human verification again before signing in.");
              return;
            }
            setIsSigningIn(true);
            setError("");
            void signInWithGoogle(client, credential, verifiedCaptcha)
              .catch((signInError: unknown) => {
                setError(
                  signInError instanceof Error
                    ? signInError.message
                    : "Google sign-in could not be completed.",
                );
              })
              .finally(() => {
                captchaTokenRef.current = null;
                setCaptchaToken(null);
                setCaptchaRound((round) => round + 1);
                setIsSigningIn(false);
              });
          },
        });
        googleButtonRef.current.replaceChildren();
        identityApi.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          width: Math.min(280, googleButtonRef.current.clientWidth || 280),
        });
      })
      .catch((sdkError: unknown) => {
        if (isMounted) {
          setError(
            sdkError instanceof Error ? sdkError.message : "Google Sign-In could not be loaded.",
          );
        }
      });

    return () => {
      isMounted = false;
      googleButtonRef.current?.replaceChildren();
    };
  }, [captchaToken, client, googleClientId, isCodeVerified, isSigningIn]);

  async function verifyAccessCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accessCode.join("").length !== 6 || isVerifyingCode) return;
    setIsVerifyingCode(true);
    setError("");
    try {
      const captchaToken = captchaTokenRef.current;
      if (!captchaToken) throw new Error("Complete human verification before checking the code.");
      const response = await fetch("/api/access-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: accessCode.join(""), captchaToken }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "statusMessage" in payload &&
          typeof payload.statusMessage === "string"
            ? payload.statusMessage
            : `Could not verify the access code (${response.status}).`;
        throw new Error(message);
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("verified" in payload) ||
        payload.verified !== true
      ) {
        throw new Error("The server returned an invalid access-code verification.");
      }
      setIsCodeVerified(true);
      setAccessCode(Array(6).fill(""));
      captchaTokenRef.current = null;
      setCaptchaToken(null);
      setCaptchaRound((round) => round + 1);
    } catch (verificationError) {
      setError(
        verificationError instanceof Error
          ? verificationError.message
          : "Could not verify the access code.",
      );
      setAccessCode(Array(6).fill(""));
      accessCodeRefs.current[0]?.focus();
      captchaTokenRef.current = null;
      setCaptchaToken(null);
      setCaptchaRound((round) => round + 1);
    } finally {
      setIsVerifyingCode(false);
    }
  }

  function updateAccessCode(index: number, value: string) {
    const digits = value.replace(/\D/g, "");
    if (!digits) {
      setAccessCode((current) => current.map((digit, item) => (item === index ? "" : digit)));
      return;
    }
    const entered = digits.slice(-6).split("");
    setAccessCode((current) => {
      const next = [...current];
      entered.forEach((digit, offset) => {
        if (index + offset < next.length) next[index + offset] = digit;
      });
      return next;
    });
    accessCodeRefs.current[Math.min(index + entered.length, 5)]?.focus();
  }

  return (
    <main className="fixed inset-0 flex flex-col items-center justify-start gap-4 overflow-y-auto bg-[#f5f6f8] px-4 py-6 sm:justify-center">
      <section
        aria-labelledby="account-login-title"
        className="w-full max-w-md shrink-0 rounded-[28px] border border-[#e7e8eb] bg-white p-6 shadow-sm sm:p-8"
      >
        <div className="mx-auto size-14 overflow-hidden rounded-full border border-[#e7e8eb] bg-white shadow-sm">
          <img
            src={cheyaLogo}
            alt="Cheya logo"
            className="size-full rounded-full object-cover"
            draggable={false}
          />
        </div>
        <h1
          id="account-login-title"
          className="mt-4 text-center text-xl font-semibold text-[#202126]"
        >
          Sign in to CheyaVerse
        </h1>
        <p className="mt-2 text-center text-sm leading-6 text-[#777a81]">
          Sign in to sync your chats, memories, settings, and Gemini API keys on every device.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-red-800"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p className="whitespace-pre-line">{error}</p>
          </div>
        )}

        {!client ? (
          <p role="alert" className="mt-5 rounded-2xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
            The CheyaVerse account service is not configured for this deployment.
          </p>
        ) : !siteKey ? (
          <p role="alert" className="mt-5 rounded-2xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
            Human verification is not configured yet. The administrator must add the Turnstile site
            key to the app environment.
          </p>
        ) : !googleClientId ? (
          <p role="alert" className="mt-5 rounded-2xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
            Google sign-in is not configured for this deployment.
          </p>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-4">
            <Turnstile
              key={captchaRound}
              siteKey={siteKey}
              onSuccess={(token) => {
                setError("");
                setCaptchaToken(token);
              }}
              onExpire={() => {
                captchaTokenRef.current = null;
                setCaptchaToken(null);
              }}
              onError={() => {
                captchaTokenRef.current = null;
                setCaptchaToken(null);
                setError("Human verification failed to load. Refresh the page and try again.");
              }}
            />
            {captchaToken && !isCodeVerified && (
              <form onSubmit={verifyAccessCode} className="flex w-full flex-col items-center gap-3">
                <label className="text-sm font-medium text-[#34363b]">
                  Enter your six-digit access code
                </label>
                <div className="flex justify-center gap-2" role="group" aria-label="Six-digit access code">
                  {accessCode.map((digit, index) => (
                    <input
                      key={index}
                      ref={(element) => {
                        accessCodeRefs.current[index] = element;
                      }}
                      aria-label={`Access code digit ${index + 1}`}
                      autoComplete={index === 0 ? "one-time-code" : "off"}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      disabled={isVerifyingCode}
                      value={digit}
                      onChange={(event) => updateAccessCode(index, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Backspace" && !digit && index > 0) {
                          accessCodeRefs.current[index - 1]?.focus();
                        }
                      }}
                      onPaste={(event) => {
                        const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
                        if (!pasted) return;
                        event.preventDefault();
                        updateAccessCode(index, pasted);
                      }}
                      className="size-11 rounded-xl border border-[#dfe1e5] bg-white text-center text-lg font-semibold text-[#26272c] outline-none focus:border-[#9380dc] focus:ring-2 focus:ring-[#9380dc]/20"
                    />
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={accessCode.join("").length !== 6 || isVerifyingCode}
                  className="flex h-10 items-center justify-center gap-2 rounded-full bg-[#26272c] px-5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {isVerifyingCode && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                  Verify access code
                </button>
              </form>
            )}
            {captchaToken && isCodeVerified && !isSigningIn && (
              <div aria-label="Sign in with Google" className="min-h-10">
                <div ref={googleButtonRef} />
              </div>
            )}
            {isSigningIn && (
              <p role="status" className="flex items-center gap-2 text-sm text-[#686b72]">
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                Signing in securely…
              </p>
            )}
            {!captchaToken && (
              <p className="text-center text-xs leading-5 text-[#858890]">
                Complete human verification to enable Google sign-in.
              </p>
            )}
          </div>
        )}
      </section>
      <nav aria-label="Legal information" className="flex shrink-0 items-center gap-4 pb-2 text-xs text-[#777a81]">
        <a href="/privacy" className="hover:text-[#25262a] hover:underline">
          Kebijakan Privasi
        </a>
        <a href="/terms" className="hover:text-[#25262a] hover:underline">
          Ketentuan Layanan
        </a>
      </nav>
    </main>
  );
}
