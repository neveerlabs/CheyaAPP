import type { AppSupabaseClient } from "./supabase";

type ProductHelpArticle = {
  id: string;
  title: string;
  keywords: string;
  content: string;
};

const productHelpArticles: ProductHelpArticle[] = [
  {
    id: "chat-header",
    title: "Room chat: header, notifications, and navigation",
    keywords: "chat room header logo CheyaAPP back settings notifications bell inbox unread mark read clear notification approve admin push",
    content:
      "ROOM CHAT — HEADER AND NOTIFICATIONS\nThe CheyaAPP logo/name identifies the chat. The Notifications bell opens the account inbox and, for admins, pending AI message approvals. Inbox items can be opened and marked read; “Mark all notifications as read” marks every inbox item read. “Clear notification inbox” removes inbox notifications only; it does not delete chats or pending admin approvals. Admin approval cards let the administrator approve delivery or cancel a prepared broadcast. A push notification is delivered by the browser to a registered device; it is separate from an inbox item and from a chat message. The Settings button opens Settings. The “Report a problem” control opens the app's bug-report form.",
  },
  {
    id: "chat-composer",
    title: "Room chat: compose, send, plus button, voice, and thinking",
    keywords: "chat plus + attach media file photo camera microphone voice send enter visualizer think thinking mode composer upload",
    content:
      "ROOM CHAT — COMPOSER\nThe message field accepts text. Send submits the message; Enter behavior can be configured separately for desktop and mobile in Settings > General. The plus button opens media actions: choose a photo/video or file from the device, or open the camera when supported. Photos, videos, and other files are saved to storage without being sent to an AI model for editing. Photos are checked for duplicates by their decoded pixel content, so metadata-only changes do not create another stored image while the previous file is retained. The media grid stays non-interactive while a file is being saved; a failed save shows a warning and retry button, and a preview becomes available only after saving finishes. Crop selects an area of a photo and saves the cropped result as an attachment. Cropping is only available for photos, not videos, and does not affect media already sent. Clicking the microphone starts recording and displays a live waveform; X cancels, and the stop button immediately adds the voice note as a chat message, uploads it, and submits it to Cheya without showing it in the regular attachment grid or requiring another send step. Cheya transcribes the speech into the user message, listens to the audio as message content, and replies with text. Sent voice notes have a play/pause control, waveform, duration, and file size. Voice note audio is retained in private storage for 24 hours. Visualize is a voice/audio visualization action where available. Think toggles Thinking mode for the next response; it can add a concise explanation summary to the response. The AI reads attached files only when those files are successfully attached to the submitted message. Large/unsupported files may be rejected or processed before upload.",
  },
  {
    id: "message-actions",
    title: "Room chat: actions on user and assistant messages",
    keywords: "edit delete regenerate retry copy like dislike report message version branch user assistant response action",
    content:
      "ROOM CHAT — MESSAGE ACTIONS\nUser message actions include Copy, Edit, and Delete this message and everything after it. Editing saves a new version of that user message and regenerates its next assistant reply. If an unresolved product-help request is tied to an edited question, the old request and draft are withdrawn and the admin is notified; the edited version is forwarded only if it still needs admin help. Deleting a user message withdraws its unresolved help request and invalidates any draft. Regenerating an assistant reply does not change the user's question or cancel its pending help request. Deleting a user message removes that message and the following conversation branch/messages, related insights, and generated Gemini TTS audio; saved long-term memories remain, with their deleted source link detached. Assistant actions include like/dislike feedback, copy, report, read response aloud, and regenerate response. Version arrows appear when a message has multiple versions and switch the displayed version; they do not delete versions. Regenerate creates a new response version to the same user message. Read response aloud opens the speech player and may use cached/generated Gemini speech or a fallback source. The retry icon on a failed user submission retries sending that message. Scroll-to-latest jumps to the newest conversation content.",
  },
  {
    id: "speech",
    title: "Speech playback and Gemini TTS",
    keywords: "audio TTS read aloud speaker playback Gemini text to speech voice cache sound",
    content:
      "SPEECH PLAYBACK\n“Read response aloud” opens the speech player for an assistant response. Playback may reuse the cached Gemini TTS audio for that message version and voice, generate Gemini speech, or fall back to another available speech source. Playback controls pause/resume or close the player; waveform/word progress is informational. Gemini TTS API keys and preferred voice are configured separately from chat Gemini API keys in Settings > Configure. Cached generated Gemini audio is temporary and is removed when its message/branch or all chat history is deleted.",
  },
  {
    id: "settings-overview",
    title: "Settings navigation and page overview",
    keywords: "settings page configure general personal memory messages changelogs account privacy terms navigation",
    content:
      "SETTINGS — OVERVIEW\nSettings home links to General (chat behavior, notifications, appearance, and web search), Personal (display name, personal instructions, and conversation style), Configure (Gemini chat API keys and separate Gemini TTS keys/voice), Memory (saved long-term memories and chat history controls), Messages (inbox, reminders, forwarded user-to-admin messages, and admin approvals), Changelogs (public source/commit history), and Account (account identity, active sessions, sign-out, and account controls). Privacy Policy and Terms of Service are available from the legal-page controls. The back arrow returns to the previous page. The bug icon opens the problem report form. Configure has a help icon for API setup guidance.",
  },
  {
    id: "settings-general",
    title: "Settings > General",
    keywords: "general settings enter key desktop mobile time format font size appearance web search notifications push",
    content:
      "SETTINGS > GENERAL\nEnter key behavior can be configured for desktop, mobile, or both: Device default follows platform behavior, Enter sends submits the message, and Enter adds a line inserts a newline. Time format can follow the device or use 12-hour/24-hour time. Chat font size adjusts the displayed conversation text and includes a preview. Web search toggles whether Cheya can use its live web-search tool for current or specialized external information. Browser push permission is configured separately by the device/browser; enabling it allows supported push notifications and can require browser permission. Changes are saved to the account settings.",
  },
  {
    id: "settings-personal",
    title: "Settings > Personal",
    keywords: "personal settings display name custom prompt instruction chat style personalization",
    content:
      "SETTINGS > PERSONAL\nDisplay name is the preferred name Cheya may use naturally. Personal instructions add user-provided guidance to Cheya's system instructions. Conversation style describes the preferred tone/communication style. These settings personalize replies; they are not app-wide product documentation and do not change permissions. Save applies the updated personal settings to the account.",
  },
  {
    id: "settings-configure",
    title: "Settings > Configure: API keys and voice",
    keywords: "configure API key Gemini save database Supabase where store add test remove reveal hide API key TTS voice setup",
    content:
      "SETTINGS > CONFIGURE\nGemini APIs holds the chat-generation API keys. Add Gemini API key adds a key to the signed-in account; Test API checks a configured key; Remove API removes it from that account. Show/hide only changes whether the key is visible in the field. These chat keys are stored in the app's Supabase database associated with the account, not in the browser's public prompt. Gemini TTS keys are a separate list used only for generated speech, and have their own save/test/remove controls and voice selector. Testing a TTS key generates real sample audio and consumes TTS quota. An API key is a secret: do not paste it into chat or share it. The setup-help icon opens instructions for configuring Gemini API access. Chat API keys and TTS API keys have separate usage, access, quota, and billing.",
  },
  {
    id: "settings-memory",
    title: "Settings > Memory and chat history",
    keywords: "memory public shared FAQ long-term saved memory edit delete chat history delete chats branches insights clear preserve memory",
    content:
      "SETTINGS > MEMORY\nSaved memories are durable account-level facts/preferences Cheya can use when relevant; they are separate from individual chat messages and insights. A memory can be added, edited, or deleted individually. The shared public product-help memory is different: it stores generalized, administrator-confirmed app guidance for all signed-in accounts, not personal facts or private admin discussion. Chat history controls show messages and allow clearing all chat history. Clear chats deletes messages, every saved conversation branch, message insights, and cached generated Gemini TTS audio. It preserves long-term memories, API keys, and settings; source-message links on preserved memories are detached. It is irreversible. Deleting one message/branch in the room similarly removes its branch messages and insights/audio but preserves any long-term memory by detaching its source.",
  },
  {
    id: "settings-messages",
    title: "Settings > Messages",
    keywords: "messages inbox notification reminders forwarded by users admin approval delivery",
    content:
      "SETTINGS > MESSAGES\nInbox lists messages delivered to the account inbox, including administrator messages and AI-failure notices. Active reminders lists scheduled reminders and offers their available management actions. For admins, “Messages forwarded by users” contains user messages relayed to administrators in chat; these are distinct from inbox notifications. “Messages awaiting approval” lists AI-prepared outbound admin messages. Approving one delivers it to the selected account(s) or all accounts as an inbox message and may send push; cancelling prevents delivery. An AI-forwarded question about how to use CheyaAPP instead appears as a direct chat message in admin chat, not as an inbox request. Cheya can synthesize an answer draft from the admin discussion; it must show the draft and ask the admin to confirm it. The user receives the answer only after explicit confirmation; corrections update the draft and require confirmation again.",
  },
  {
    id: "settings-account",
    title: "Settings > Account",
    keywords: "account email provider sessions devices active sign out delete account export data",
    content:
      "SETTINGS > ACCOUNT\nAccount displays the signed-in identity/provider and account session/device activity. Account sessions show browser/device sessions and their last activity; controls can sign out other sessions. Sign out ends the current session. Delete account is a separate irreversible action requiring explicit confirmation; it removes the account and associated account data and stored files according to the confirmation text. It is not the same as Clear chats, which preserves the account, settings, API keys, and long-term memories.",
  },
  {
    id: "settings-changelogs",
    title: "Settings > Changelogs",
    keywords: "changelog changes commits source history updates git",
    content:
      "SETTINGS > CHANGELOGS\nChangelogs displays public project/source commit history and changes. It is informational and does not configure or modify the user's account.",
  },
  {
    id: "settings-legal",
    title: "Privacy Policy and Terms of Service",
    keywords: "privacy terms legal policy data handling service",
    content:
      "LEGAL PAGES\nPrivacy Policy explains how CheyaAPP handles information. Terms of Service describes terms for using CheyaAPP. These pages are informational; they do not change settings. For interpretation of a legal provision not stated in the page, do not invent legal advice; ask the administrator or suggest reviewing the published policy.",
  },
  {
    id: "account-data",
    title: "Where account data is stored and who can access it",
    keywords: "where data stored database Supabase API keys Gemini data privacy admin access other users",
    content:
      "DATA AND ACCOUNT BOUNDARIES\nChat messages, message versions, saved memories, insights, settings, and chat API-key records are stored in the configured Supabase-backed app database. Private uploaded media and generated Gemini TTS cache files use private Supabase Storage buckets and have retention/cleanup behavior. A regular user can access only their own data through app permissions. Admin-only AI tools can search other accounts only when the administrator asks and the tool specifically authorizes it; a regular user's AI must never access another account's records. Do not claim that an administrator can see API-key secret values or private file bytes unless the app explicitly provides those capabilities.",
  },
];

const stopWords = new Set([
  "apa", "bagaimana", "gimana", "dimana", "mana", "untuk", "dengan", "yang", "dan",
  "di", "ke", "dari", "ini", "itu", "saya", "aku", "kamu", "dong", "ya", "kah",
  "the", "what", "where", "how", "does", "do", "can", "i", "my", "in", "to", "and",
]);

function tokens(text: string): string[] {
  return [...new Set(
    text
      .toLocaleLowerCase()
      .replace(/[^a-z0-9+]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !stopWords.has(token)),
  )];
}

export async function searchProductHelp(client: AppSupabaseClient, query: string): Promise<{
  found: boolean;
  articles: Array<{ title: string; content: string }>;
}> {
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return { found: false, articles: [] };
  const ranked = productHelpArticles
    .map((article) => {
      const title = tokens(article.title);
      const keywords = tokens(article.keywords);
      const body = tokens(article.content);
      const score = queryTokens.reduce(
        (total, token) =>
          total +
          (title.includes(token) ? 5 : 0) +
          (keywords.includes(token) ? 3 : 0) +
          (body.includes(token) ? 1 : 0),
        0,
      );
      return { article, score };
    })
    .filter(({ score }) => score >= 3)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  const { data, error } = await client.rpc("search_product_help_memories", {
    p_query: query.slice(0, 500),
    p_limit: 3,
  });
  if (error) throw new Error(`Could not search public product-help memory: ${error.message}`);

  const publicArticles = data.map((article) => ({
    title: article.title,
    content: article.content,
  }));
  const combined = [...publicArticles, ...ranked.map(({ article }) => ({
    title: article.title,
    content: article.content,
  }))];
  const uniqueArticles = [...new Map(combined.map((article) => [article.title, article])).values()].slice(0, 3);
  return {
    found: uniqueArticles.length > 0,
    articles: uniqueArticles,
  };
}
