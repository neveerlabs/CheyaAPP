# CheyaVerse

A mobile-first personal AI chat interface built with React, TypeScript, Vite, and Tailwind CSS.

## Requirements

- Node.js 20 or newer
- npm

## Getting started

```bash
npm install
npm run dev
```

Vite prints the local development URL when the server starts.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Type-check and create a production build in `dist/` |
| `npm run preview` | Preview the production build locally |

## Supabase and Gemini setup

Each user connects their own Supabase project. Enable **Anonymous Sign-Ins** in Supabase
Authentication settings; the app automatically creates a private per-browser session, so no app
email/password account is needed. Before connecting:

1. Run [`supabase/schema.sql`](./supabase/schema.sql) in the project's Supabase SQL Editor.
2. In Settings, enter the Supabase Project URL and publishable (or legacy anon) key.
3. The app creates a Supabase session automatically. Row Level Security limits settings and Gemini
   API keys to that browser session.
4. In **Personal**, set a name, custom prompt, and conversation style. In **Configure**, add one
   or more Gemini API keys using `gemini-3.1-flash-lite` or `gemini-3.5-flash-lite`.
5. Run the latest `supabase/schema.sql` whenever the project has an older schema. It adds the
   chat, insight, memory, and pgvector tables plus the semantic-search functions.

The Supabase URL and publishable key are retained in the browser as bootstrap settings and copied
to that session's database. Gemini API keys are stored in the session's Supabase rows and sent from
the browser directly to Google's Gemini API. Never use a Supabase service-role key in this
client-side app. Anonymous sessions are specific to a browser; clearing browser data or switching
devices loses access to that session's data. The Settings page's help button includes the full setup
checklist and copyable SQL schema.

Text chat messages, per-message conversation insights, and semantic embeddings are stored in the
connected Supabase project and protected by row-level security. Gemini analyzes each user message
for tentative, non-clinical conversation insights and uses relevant past messages, saved memories,
recent insights, and Personal settings as context. Its database tools are limited to the current
user's chat, memories, and insights; the app asks before deleting a record. The browser sends
message text to Gemini for replies, insights, and embeddings.

Assistant replies support Markdown, including fenced code blocks and `_underlined text_` (single
underscores are rendered as underline in this app). User messages stay in compact bubbles; assistant
replies use the full conversation width and include controls for feedback, regeneration, reporting,
and copying. The **Think** toggle shows progress stages and an optional user-facing summary of the
context used; it does not expose private internal reasoning.

## Notes

- The media menu opens the browser's device picker directly. Selected images and videos show
  square previews, other files show an extension tile, and each attachment can be removed before
  sending. Tap an image or video for a full-screen preview, or a text file to edit it before
  committing it back to the attachment.
- A browser cannot force Android to open a specific file-manager app; the OS chooses the picker
  based on the user's device configuration.
- Camera access requires browser permission and a secure context (HTTPS, or localhost).
- `dist/`, `node_modules/`, and local environment files are excluded from version control.
