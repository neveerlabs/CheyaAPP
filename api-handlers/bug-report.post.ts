import nodemailer from "nodemailer";
import { createError, defineEventHandler, getHeader, readMultipartFormData } from "nitro/h3";
import { createAuthenticatedServerClient, createServiceRoleClient, getServerEnvironmentVariable } from "../src/lib/server-supabase";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 3.5 * 1024 * 1024;
const MAX_DESCRIPTION_BYTES = 500 * 1024;
const recipient = "neverlabs4@gmail.com";
const allowedMediaTypes = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/3gpp",
  "video/mp4",
  "video/mpeg",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
]);

function safeFileName(fileName: string): string {
  return fileName
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .slice(0, 180) || "media";
}

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
    throw createError({ statusCode: 401, statusMessage: "Sign in before sending a bug report." });
  }

  const authClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const smtpHost = getServerEnvironmentVariable("SMTP_HOST");
  const smtpPort = Number(getServerEnvironmentVariable("SMTP_PORT") ?? "587");
  const smtpUser = getServerEnvironmentVariable("SMTP_USER");
  const smtpPassword = getServerEnvironmentVariable("SMTP_PASSWORD");
  const smtpFrom = getServerEnvironmentVariable("SMTP_FROM");
  if (!smtpHost || !smtpUser || !smtpPassword || !smtpFrom || ![465, 587].includes(smtpPort)) {
    throw createError({
      statusCode: 503,
      statusMessage: "Bug report email is not configured. Add the SMTP settings to the server environment.",
    });
  }

  const serviceClient = createServiceRoleClient();
  const { data: profile, error: profileError } = await serviceClient
    .from("account_profiles")
    .select("role, provider, email, github_username")
    .eq("user_id", user.id)
    .single();
  if (profileError) {
    throw new Error(`Could not load the bug report sender identity: ${profileError.message}`);
  }

  const contentType = getHeader(event, "content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw createError({ statusCode: 415, statusMessage: "Bug reports must use multipart form data." });
  }
  const parts = await readMultipartFormData(event);
  if (!parts) {
    throw createError({ statusCode: 400, statusMessage: "Bug report form data is missing." });
  }

  if (parts.some((part) => part.name !== "description" && part.name !== "media")) {
    throw createError({ statusCode: 400, statusMessage: "Bug report form data contains an unknown field." });
  }
  const descriptionParts = parts.filter((part) => part.name === "description");
  if (descriptionParts.length !== 1) {
    throw createError({ statusCode: 400, statusMessage: "Bug report form data must contain one description." });
  }
  const descriptionPart = descriptionParts[0];
  const description = descriptionPart
    ? new TextDecoder().decode(descriptionPart.data).trim()
    : "";
  if (!description) {
    throw createError({ statusCode: 400, statusMessage: "Describe the issue before sending the report." });
  }
  if (Buffer.byteLength(description, "utf8") > MAX_DESCRIPTION_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: "The report text is too large to send. Shorten the description and try again.",
    });
  }

  const mediaParts = parts.filter((part) => part.name === "media");
  if (mediaParts.length > MAX_FILES) {
    throw createError({ statusCode: 400, statusMessage: `Attach no more than ${MAX_FILES} photos or videos.` });
  }
  let totalFileBytes = 0;
  const attachments = mediaParts.map((part) => {
    if (!part.filename) {
      throw createError({ statusCode: 400, statusMessage: "Each media upload must include a file." });
    }
    const fileName = safeFileName(part.filename ?? "");
    const mediaType = (part.type ?? "").toLowerCase();
    if (!allowedMediaTypes.has(mediaType)) {
      throw createError({
        statusCode: 415,
        statusMessage: `${fileName} is not a supported photo or video format.`,
      });
    }
    if (part.data.byteLength > MAX_FILE_BYTES) {
      throw createError({
        statusCode: 413,
        statusMessage: `${fileName} exceeds the ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB per-file upload limit.`,
      });
    }
    totalFileBytes += part.data.byteLength;
    if (totalFileBytes > MAX_TOTAL_FILE_BYTES) {
      throw createError({
        statusCode: 413,
        statusMessage: `The combined media size cannot exceed ${(MAX_TOTAL_FILE_BYTES / (1024 * 1024)).toFixed(1)} MB.`,
      });
    }
    return {
      filename: fileName,
      content: Buffer.from(part.data),
      contentType: mediaType,
      contentDisposition: "attachment" as const,
    };
  });

  const provider = profile.provider === "github" ? "GitHub" : "Google";
  const accountEmail = profile.email ?? user.email ?? "Not available";
  const githubUsername = profile.github_username ?? "Not available";
  const senderDetails = [
    `Provider: ${provider}`,
    `Role: ${profile.role}`,
    `Account ID: ${user.id}`,
    `Account email: ${accountEmail}`,
    `GitHub username: ${githubUsername}`,
    `Submitted: ${new Date().toISOString()}`,
  ].join("\n");
  const replyTo =
    user.email_confirmed_at &&
    user.email &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)
      ? user.email
      : undefined;

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
      from: smtpFrom,
      to: recipient,
      ...(replyTo ? { replyTo } : {}),
      subject: `[CheyaAPP bug report] ${provider} · ${profile.role}`,
      priority: "high",
      headers: { Importance: "high" },
      text: `${senderDetails}\n\nReport:\n${description}`,
      html: `<h2>Bug report</h2><pre>${escapeHtml(senderDetails)}</pre><h3>Description</h3><p style="white-space:pre-wrap">${escapeHtml(description)}</p>`,
      attachments,
    });
  } catch (error) {
    console.error("Bug report SMTP delivery failed.", error);
    throw createError({
      statusCode: 502,
      statusMessage: "SMTP could not deliver the bug report. Your local draft has been kept.",
    });
  }

  return { sent: true };
});
