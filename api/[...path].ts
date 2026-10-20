import {
  createError,
  defineEventHandler,
  getMethod,
  getRequestURL,
  type EventHandler,
} from "nitro/h3";
import accountAiAction from "../api-handlers/account-ai-action.post";
import accountAiError from "../api-handlers/account-ai-error.post";
import accountDelete from "../api-handlers/account-delete.post";
import accountInboxClear from "../api-handlers/account-inbox-clear.post";
import accessCode from "../api-handlers/access-code.post";
import adminAttachmentLink from "../api-handlers/admin-attachment-link.post";
import adminMessageApproval from "../api-handlers/admin-message-approval.post";
import adminRelayFeedback from "../api-handlers/admin-relay-feedback.post";
import chatAttachmentLink from "../api-handlers/chat-attachment-link.post";
import chatAttachmentsDelete from "../api-handlers/chat-attachments-delete.post";
import chatAttachments from "../api-handlers/chat-attachments.post";
import chatJobs from "../api-handlers/chat-jobs.post";
import chatMessageAttachments from "../api-handlers/chat-message-attachments.post";
import databaseKeepalive from "../api-handlers/database-keepalive.get";
import linkPreview from "../api-handlers/link-preview.post";
import pushConfig from "../api-handlers/push-config.get";
import pushSubscriptions from "../api-handlers/push-subscriptions.post";
import ttsAudioCacheGet from "../api-handlers/tts-audio-cache.get";
import ttsAudioCachePost from "../api-handlers/tts-audio-cache.post";
import webSearch from "../api-handlers/web-search.post";

const apiHandlers: Record<string, EventHandler> = {
  "POST /api/account-ai-action": accountAiAction,
  "POST /api/account-ai-error": accountAiError,
  "POST /api/account-delete": accountDelete,
  "POST /api/account-inbox-clear": accountInboxClear,
  "POST /api/access-code": accessCode,
  "POST /api/admin-attachment-link": adminAttachmentLink,
  "POST /api/admin-message-approval": adminMessageApproval,
  "POST /api/admin-relay-feedback": adminRelayFeedback,
  "POST /api/chat-attachment-link": chatAttachmentLink,
  "POST /api/chat-attachments-delete": chatAttachmentsDelete,
  "POST /api/chat-attachments": chatAttachments,
  "POST /api/chat-jobs": chatJobs,
  "POST /api/chat-message-attachments": chatMessageAttachments,
  "GET /api/database-keepalive": databaseKeepalive,
  "POST /api/link-preview": linkPreview,
  "GET /api/push-config": pushConfig,
  "POST /api/push-subscriptions": pushSubscriptions,
  "GET /api/tts-audio-cache": ttsAudioCacheGet,
  "POST /api/tts-audio-cache": ttsAudioCachePost,
  "POST /api/web-search": webSearch,
};

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname;
  const method = getMethod(event).toUpperCase();
  const handler = apiHandlers[`${method} ${path}`];

  if (handler) return handler(event);

  const allowedMethods = Object.keys(apiHandlers)
    .filter((route) => route.endsWith(` ${path}`))
    .map((route) => route.slice(0, route.indexOf(" ")));
  if (allowedMethods.length > 0) {
    throw createError({ statusCode: 405, statusMessage: "Method Not Allowed" });
  }

  throw createError({ statusCode: 404, statusMessage: "API route not found." });
});
