const ACCOUNT_SESSION_STORAGE_KEY = "cheyaverse.account-session-id";

export function getAccountSessionId(): string {
  const existing = window.sessionStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = crypto.randomUUID();
  window.sessionStorage.setItem(ACCOUNT_SESSION_STORAGE_KEY, id);
  return id;
}

export function clearAccountSessionId(): void {
  window.sessionStorage.removeItem(ACCOUNT_SESSION_STORAGE_KEY);
}

export function getAccountSessionLocation(): { origin: string; path: string } {
  return {
    origin: window.location.origin,
    path: window.location.pathname,
  };
}

export function getAccountSessionDeviceLabel(userAgent: string): string {
  if (/android|iphone|ipad|ipod|mobile/i.test(userAgent)) return "Mobile";
  return "Computer";
}

export function getAccountSessionBrowserLabel(userAgent: string): string {
  if (/edg\//i.test(userAgent)) return "Microsoft Edge";
  if (/opr\/|opera/i.test(userAgent)) return "Opera";
  if (/firefox\//i.test(userAgent)) return "Firefox";
  if (/crios|chrome\//i.test(userAgent)) return "Google Chrome";
  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) return "Safari";
  return "Unknown browser";
}
