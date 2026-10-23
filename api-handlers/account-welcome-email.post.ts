import nodemailer from "nodemailer";
import { createError, defineEventHandler, getHeader } from "nitro/h3";
import { createAuthenticatedServerClient, createServiceRoleClient, getServerEnvironmentVariable } from "../src/lib/server-supabase";

const MAX_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;
const STALE_CLAIM_MS = 10 * 60 * 1000;
const contactEmail = "neverlabs4@gmail.com";
const defaultWelcomeEmailSubject = "Welcome to CheyaAPP";
const defaultWelcomeEmailFromName = "Welcome to CheyaAPP";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

export default defineEventHandler(async (event) => {
  const accessToken = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before requesting a welcome email." });
  }

  const authClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const accountCreatedAt = Date.parse(user.created_at);
  const accountAge = Date.now() - accountCreatedAt;
  if (!Number.isFinite(accountCreatedAt) || accountAge < 0 || accountAge > MAX_ACCOUNT_AGE_MS) {
    return { sent: false, reason: "not_a_new_account" };
  }
  if (
    !user.email_confirmed_at ||
    !user.email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)
  ) {
    return { sent: false, reason: "verified_email_unavailable" };
  }

  const smtpHost = getServerEnvironmentVariable("SMTP_HOST");
  const smtpPort = Number(getServerEnvironmentVariable("SMTP_PORT") ?? "587");
  const smtpUser = getServerEnvironmentVariable("SMTP_USER");
  const smtpPassword = getServerEnvironmentVariable("SMTP_PASSWORD");
  const smtpFrom = getServerEnvironmentVariable("SMTP_FROM");
  const welcomeEmailFromName =
    getServerEnvironmentVariable("WELCOME_EMAIL_FROM_NAME") ?? defaultWelcomeEmailFromName;
  if (!smtpHost || !smtpUser || !smtpPassword || !smtpFrom || ![465, 587].includes(smtpPort)) {
    throw createError({
      statusCode: 503,
      statusMessage: "Welcome email is not configured. Add the SMTP settings to the server environment.",
    });
  }

  const serviceClient = createServiceRoleClient();
  const now = new Date();
  const staleClaimBefore = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  const { data: claimedProfile, error: claimError } = await serviceClient
    .from("account_profiles")
    .update({ welcome_email_claimed_at: now.toISOString() })
    .eq("user_id", user.id)
    .is("welcome_email_sent_at", null)
    .or(`welcome_email_claimed_at.is.null,welcome_email_claimed_at.lt.${staleClaimBefore}`)
    .select("user_id")
    .maybeSingle();
  if (claimError) {
    throw new Error(`Could not claim the new-account welcome email: ${claimError.message}`);
  }
  if (!claimedProfile) return { sent: false, reason: "already_sent_or_in_progress" };

  const greetingName =
    typeof user.user_metadata.full_name === "string" && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : typeof user.user_metadata.name === "string" && user.user_metadata.name.trim()
        ? user.user_metadata.name.trim()
        : null;
  const greeting = greetingName ? `Hi ${greetingName},` : "Hi there,";
  const htmlGreeting = escapeHtml(greeting);
  const text = `${greeting}

Welcome to CheyaAPP! Your account is ready. We're glad you've joined us.

You can open CheyaAPP and start chatting whenever you're ready.

If you have any questions, contact us at ${contactEmail}.

Regards, neverlabs`;
  const html = `<p>${htmlGreeting}</p><p>Welcome to <strong><a href="https://cheya-app.vercel.app/">CheyaAPP!</a></strong> Your account is ready. We're glad you've joined us.</p><p>You can open CheyaAPP and start chatting whenever you're ready.</p><p>If you have any questions, <a href="mailto:${contactEmail}">contact us</a>.</p><p>Regards, neverlabs</p>`;
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    requireTLS: smtpPort === 587,
    auth: { user: smtpUser, pass: smtpPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  try {
    await transporter.sendMail({
      from: { name: welcomeEmailFromName, address: smtpUser },
      to: user.email,
      subject:
        getServerEnvironmentVariable("WELCOME_EMAIL_SUBJECT") ?? defaultWelcomeEmailSubject,
      text,
      html,
    });
  } catch (error) {
    const { error: releaseError } = await serviceClient
      .from("account_profiles")
      .update({ welcome_email_claimed_at: null })
      .eq("user_id", user.id)
      .is("welcome_email_sent_at", null);
    if (releaseError) {
      console.error("Could not release the failed welcome-email claim.", releaseError);
    }
    console.error("New-account welcome email delivery failed.", error);
    throw createError({
      statusCode: 502,
      statusMessage: "SMTP could not deliver the welcome email.",
    });
  }

  const { error: markSentError } = await serviceClient
    .from("account_profiles")
    .update({
      welcome_email_sent_at: new Date().toISOString(),
      welcome_email_claimed_at: null,
    })
    .eq("user_id", user.id)
    .is("welcome_email_sent_at", null);
  if (markSentError) {
    console.error("Welcome email was delivered but its delivery status could not be recorded.", markSentError);
    throw new Error(`Welcome email was delivered but could not be marked sent: ${markSentError.message}`);
  }

  return { sent: true };
});
