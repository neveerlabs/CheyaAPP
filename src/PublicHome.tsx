import { useEffect } from "react";
import { ArrowRight, Brain, Files, History, Search } from "lucide-react";
import cheyaLogo from "../assets/circle.png";

export function PublicHome({ onSignIn }: { onSignIn: () => void }) {
  useEffect(() => {
    document.title = "CheyaAPP — Your AI chat workspace";
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    description?.setAttribute(
      "content",
      "CheyaAPP is an AI chat workspace for conversations, personal context, web research, and temporary file and media attachments.",
    );
  }, []);

  return (
    <main className="min-h-full overflow-y-auto bg-[#f5f6f8] px-4 py-6 text-[#25262a] sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
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

        <section className="relative mt-5 overflow-hidden rounded-[32px] border border-[#e7e8eb] bg-white px-6 py-12 shadow-[0_8px_32px_rgba(25,32,43,0.05)] sm:px-12 sm:py-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-32 size-80 rounded-full bg-[#e9f7fd] blur-3xl"
          />
          <div className="relative max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#e5e6e9] bg-white px-3 py-1.5 text-xs font-medium text-[#62656d]">
              <span className="size-2 rounded-full bg-[#42a776]" />
              Your AI chat workspace
            </p>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-[#202126] sm:text-6xl">
              Meet your ideas
              <br />
              <span className="text-[#4389ae]">where they are.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#62656d] sm:text-lg sm:leading-8">
              CheyaAPP is a personal AI chat workspace for asking questions, exploring ideas, and
              keeping useful conversation context together in one place.
            </p>
            <button
              type="button"
              onClick={onSignIn}
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-[#28292e] px-6 text-sm font-medium text-white transition hover:bg-[#41434a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229fe3]"
            >
              Open your chat
              <ArrowRight aria-hidden="true" className="size-4" />
            </button>
            <p className="mt-3 text-xs leading-5 text-[#858890]">
              Sign in with Google to access your saved workspace.
            </p>
          </div>
        </section>

        <section aria-labelledby="features-title" className="mt-10">
          <div className="max-w-xl">
            <h2 id="features-title" className="text-xl font-semibold tracking-tight text-[#25262a]">
              A thoughtful space for AI conversations
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#71747c]">
              Chat, context, and helpful tools designed to work together.
            </p>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <FeatureCard
              icon={Brain}
              title="AI conversations"
              description="Ask questions and explore ideas with Gemini models using an API key you configure."
            />
            <FeatureCard
              icon={History}
              title="Context that stays with you"
              description="Keep conversation history, personal settings, and useful AI-generated context synced to your account."
            />
            <FeatureCard
              icon={Files}
              title="Files and media"
              description="Attach images, videos, and files for an AI conversation. Attachments are private and retained for up to 24 hours."
            />
            <FeatureCard
              icon={Search}
              title="Web research"
              description="Use web search tools to explore a topic and review source links alongside AI findings."
            />
          </div>
        </section>

        <footer className="mt-10 flex flex-col gap-3 border-t border-[#e1e3e7] py-5 text-sm text-[#71747c] sm:flex-row sm:items-center sm:justify-between">
          <span>CheyaAPP — an AI chat workspace.</span>
          <nav aria-label="Legal information" className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="/privacy" className="hover:text-[#25262a] hover:underline">
              Privacy Policy
            </a>
            <a href="/terms" className="hover:text-[#25262a] hover:underline">
              Terms of Service
            </a>
            <a href="mailto:neverlabs4@gmail.com" className="hover:text-[#25262a] hover:underline">
              Contact
            </a>
          </nav>
        </footer>
      </div>
    </main>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Brain;
  title: string;
  description: string;
}) {
  return (
    <article className="rounded-2xl border border-[#e7e8eb] bg-white p-5">
      <div className="flex size-10 items-center justify-center rounded-xl bg-[#eef7fb] text-[#4389ae]">
        <Icon aria-hidden="true" className="size-5" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-[#25262a]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#71747c]">{description}</p>
    </article>
  );
}
