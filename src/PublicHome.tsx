import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import cheyaLogo from "../assets/circle.png";

export function PublicHome({ onSignIn }: { onSignIn: () => void }) {
  useEffect(() => {
    document.title = "CheyaAPP — Your AI chat workspace";
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    description?.setAttribute(
      "content",
      "CheyaAPP is your personal AI chat workspace.",
    );
  }, []);

  return (
    <main className="public-home-background fixed inset-0 flex flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain px-5 py-6 text-[#25262a] sm:px-8 sm:py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
        <header className="flex items-center justify-between rounded-full border border-[#e7e8eb] bg-white px-3 py-2 shadow-sm sm:px-4">
          <a href="/" className="flex min-w-0 items-center gap-2.5">
            <img
              src={cheyaLogo}
              alt=""
              className="size-10 shrink-0 rounded-full border border-[#e7e8eb] object-cover"
              draggable={false}
            />
            <span className="truncate text-base font-semibold tracking-tight">CheyaAPP</span>
          </a>
          <button
            type="button"
            onClick={onSignIn}
            className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#28292e] px-4 text-sm font-medium text-white transition hover:bg-[#41434a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
          >
            Sign in
            <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#777a82]">
              Your AI chat workspace
            </p>
            <h1 className="mt-5 text-5xl font-semibold tracking-[-0.055em] text-[#202126] sm:text-7xl">
              Meet your ideas
              <br />
              <span className="text-[#4389ae]">where they are.</span>
            </h1>
            <button
              type="button"
              onClick={onSignIn}
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-[#28292e] px-6 text-sm font-medium text-white transition hover:bg-[#41434a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
            >
              Open your chat
              <ArrowRight aria-hidden="true" className="size-4" />
            </button>
          </div>
        </section>

        <footer className="flex flex-col items-center gap-3 py-2 text-sm text-[#71747c] sm:flex-row sm:justify-center sm:gap-6">
          <nav aria-label="Legal information" className="flex flex-wrap items-center justify-center">
            <a href="/privacy" className="hover:text-[#25262a] hover:underline">
              Privacy Policy
            </a>
            <span aria-hidden="true" className="mx-4 h-4 w-px bg-[#c8cbd2]" />
            <a href="/terms" className="hover:text-[#25262a] hover:underline">
              Terms of Service
            </a>
            <span aria-hidden="true" className="mx-4 h-4 w-px bg-[#c8cbd2]" />
            <a href="mailto:neverlabs4@gmail.com" className="hover:text-[#25262a] hover:underline">
              Contact
            </a>
          </nav>
        </footer>
      </div>
    </main>
  );
}
