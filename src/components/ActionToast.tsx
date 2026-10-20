import { useEffect, useRef } from "react";

export function ActionToast({
  message,
  tone = "success",
  onDismiss,
  placement = "chat",
}: {
  message: string;
  tone?: "success" | "error";
  onDismiss: () => void;
  placement?: "chat" | "page";
}) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const toastMessage = message.replace(/\.+$/, "");

  useEffect(() => {
    const timer = window.setTimeout(() => onDismissRef.current(), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-[100] flex justify-center px-4 ${
        placement === "chat"
          ? "bottom-[calc(88px+env(safe-area-inset-bottom))] sm:bottom-6"
          : "bottom-[calc(20px+env(safe-area-inset-bottom))]"
      }`}
    >
      <div
        role={tone === "error" ? "alert" : "status"}
        aria-live={tone === "error" ? "assertive" : "polite"}
        className={`pointer-events-auto flex max-w-lg items-center rounded-full border px-4 py-1.5 text-xs leading-4 shadow-[0_8px_28px_rgba(30,30,40,0.2)] ${
          tone === "error"
            ? "border-red-200 bg-[#fff8f7] text-red-900"
            : "border-[#dce9df] bg-white text-[#285c39]"
        }`}
      >
        <p className="min-w-0 whitespace-pre-line">{toastMessage}</p>
      </div>
    </div>
  );
}
