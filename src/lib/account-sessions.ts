const ACCOUNT_SESSION_STORAGE_KEY = "cheyaverse.account-session-id";

function accountSessionStorageKey(userId: string): string {
  return `${ACCOUNT_SESSION_STORAGE_KEY}.${userId}`;
}

export function getAccountSessionId(userId: string): string {
  const storageKey = accountSessionStorageKey(userId);
  const existing = window.localStorage.getItem(storageKey);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;

  const legacySessionId = window.sessionStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY);
  if (legacySessionId && /^[0-9a-f-]{36}$/i.test(legacySessionId)) {
    window.localStorage.setItem(storageKey, legacySessionId);
    return legacySessionId;
  }

  const id = crypto.randomUUID();
  window.localStorage.setItem(storageKey, id);
  return id;
}

export function clearAccountSessionId(userId: string): void {
  window.localStorage.removeItem(accountSessionStorageKey(userId));
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
