import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { getServerEnvironmentVariable } from "../src/lib/server-supabase";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_TURNSTILE_ATTEMPTS = 2;
const attemptsByAddress = new Map<string, { count: number; resetAt: number }>();

function isMatchingCode(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export default defineEventHandler(async (event) => {
  const expectedCode = getServerEnvironmentVariable("APP_ACCESS_CODE");
  if (!expectedCode || !/^\d{6}$/.test(expectedCode)) {
    throw createError({
      statusCode: 503,
      statusMessage: "Sign-in access code is not configured correctly on the server.",
    });
  }

  const secret = getServerEnvironmentVariable("TURNSTILE_SECRET_KEY");
  if (!secret) {
    throw createError({
      statusCode: 503,
      statusMessage: "Turnstile verification is not configured on the server.",
    });
  }

  const body: unknown = await readBody(event);
  const candidate =
    typeof body === "object" && body !== null && "code" in body ? body.code : null;
  const captchaToken =
    typeof body === "object" && body !== null && "captchaToken" in body
      ? body.captchaToken
      : null;
  if (typeof candidate !== "string" || !/^\d{6}$/.test(candidate)) {
    throw createError({ statusCode: 400, statusMessage: "Enter the complete six-digit access code." });
  }
  if (typeof captchaToken !== "string" || captchaToken.length === 0 || captchaToken.length > 2048) {
    throw createError({ statusCode: 400, statusMessage: "Complete human verification before checking the code." });
  }

  const forwardedAddress = getHeader(event, "x-vercel-forwarded-for");
  const remoteIp = forwardedAddress?.split(",")[0].trim();
  const idempotencyKey = crypto.randomUUID();
  let captchaResponse: Response | null = null;
  let networkError: unknown;

  for (let attempt = 0; attempt < MAX_TURNSTILE_ATTEMPTS; attempt += 1) {
    const verificationData = new FormData();
    verificationData.set("secret", secret);
    verificationData.set("response", captchaToken);
    verificationData.set("idempotency_key", idempotencyKey);
    if (remoteIp) verificationData.set("remoteip", remoteIp);

    try {
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: verificationData,
        signal: AbortSignal.timeout(10_000),
      });
      if (
        response.ok ||
        (response.status < 500 && response.status !== 408 && response.status !== 425 && response.status !== 429) ||
        attempt === MAX_TURNSTILE_ATTEMPTS - 1
      ) {
        captchaResponse = response;
        break;
      }
      await response.body?.cancel();
    } catch (error) {
      networkError = error;
      if (attempt === MAX_TURNSTILE_ATTEMPTS - 1) break;
    }

    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }

  if (!captchaResponse) {
    throw createError({
      statusCode: 502,
      statusMessage: `Could not reach Cloudflare Turnstile after retrying: ${
        networkError instanceof Error ? networkError.message : "Unknown network error."
      }`,
    });
  }
  if (!captchaResponse.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `Cloudflare Turnstile verification failed with HTTP ${captchaResponse.status}.`,
    });
  }
  const captchaResult: unknown = await captchaResponse.json().catch(() => null);
  if (
    typeof captchaResult !== "object" ||
    captchaResult === null ||
    !("success" in captchaResult)
  ) {
    throw createError({
      statusCode: 502,
      statusMessage: "Cloudflare returned an invalid human-verification response.",
    });
  }
  if (captchaResult.success !== true) {
    const errorCodes =
      "error-codes" in captchaResult &&
      Array.isArray(captchaResult["error-codes"]) &&
      captchaResult["error-codes"].every((value) => typeof value === "string")
        ? captchaResult["error-codes"].join(", ")
        : "unknown error";
    throw createError({
      statusCode: 403,
      statusMessage: `Human verification failed or expired (${errorCodes}). Complete it again and retry.`,
    });
  }

  const address =
    forwardedAddress?.split(",")[0].trim() ?? event.node?.req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const attempt = attemptsByAddress.get(address);
  if (attempt && attempt.resetAt <= now) attemptsByAddress.delete(address);
  const currentAttempt = attemptsByAddress.get(address);
  if (currentAttempt && currentAttempt.count >= MAX_ATTEMPTS) {
    throw createError({
      statusCode: 429,
      statusMessage: "Too many incorrect access-code attempts. Try again in 15 minutes.",
    });
  }

  if (!isMatchingCode(candidate, expectedCode)) {
    const nextCount = (currentAttempt?.count ?? 0) + 1;
    attemptsByAddress.set(address, {
      count: nextCount,
      resetAt: currentAttempt?.resetAt ?? now + WINDOW_MS,
    });
    throw createError({
      statusCode: 401,
      statusMessage: "Incorrect access code.",
    });
  }

  attemptsByAddress.delete(address);
  return { verified: true };
});
