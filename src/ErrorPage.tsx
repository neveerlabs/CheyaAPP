import { Component, type ErrorInfo, type ReactNode } from "react";
import { ArrowLeft, RotateCw } from "lucide-react";

interface ErrorPageProps {
  code?: string;
  title: string;
  description: string;
  details?: string;
  onHome?: () => void;
  onRetry?: () => void;
  showIcon?: boolean;
}

export function ErrorPage({
  title,
  description,
  details,
  onHome,
  onRetry,
}: ErrorPageProps) {
  return (
    <main className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-[radial-gradient(ellipse_at_top_left,_rgba(48,160,235,0.12),_transparent_48%),#f5f6f8] px-5 py-8 text-[#202126]">
      <section
        aria-label={title}
        className="w-full max-w-lg py-6 text-center sm:py-8"
      >
        <p className="text-sm leading-6 text-[#626873]">{description}</p>
        {details && (
          <p
            role="alert"
            className="mt-5 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-[#777f8b]"
          >
            {details}
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
          {onHome && (
            <button
              type="button"
              onClick={onHome}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#25272c] px-4 text-sm font-medium text-white transition hover:bg-[#3a3d44] sm:flex-1"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to home
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium text-[#34363b] transition hover:bg-black/[0.04] sm:flex-1"
            >
              <RotateCw aria-hidden="true" className="size-4" />
              Try again
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("The application encountered an unexpected error.", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorPage
          code="APP ERROR"
          title="Something went wrong"
          description="CheyaAPP could not display this page. Try reloading, or return home and try again."
          details={this.state.error.message}
          onHome={() => window.location.assign("/")}
          onRetry={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}
