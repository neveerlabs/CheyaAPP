import { useEffect, useRef, useState } from "react";
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
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState(initialError);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const captchaTokenRef = useRef<string | null>(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? "";
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";

  useEffect(() => {
    setError(initialError);
  }, [initialError]);

  useEffect(() => {
    captchaTokenRef.current = captchaToken;
    if (!captchaToken || !client || !googleClientId || isSigningIn) {
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
  }, [captchaToken, client, googleClientId, isSigningIn]);

  return (
    <main className="fixed inset-0 flex items-center justify-center bg-[#f5f6f8] p-4">
      <section
        aria-labelledby="account-login-title"
        className="w-full max-w-md rounded-[28px] border border-[#e7e8eb] bg-white p-6 shadow-sm sm:p-8"
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
            {captchaToken && !isSigningIn && (
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
    </main>
  );
}
