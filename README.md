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
| `npm run build` | Type-check and create a production build in `.output/` |
| `npm run preview` | Preview the production build locally |

## Shared account service setup

CheyaVerse uses one operator-managed Supabase project for Google authentication and application
data. Users do not create or connect their own Supabase or Google OAuth projects. Row Level
Security isolates each account's chats, Gemini API keys, personalization, memories, feedback, and
insights.

### One-time operator setup

1. Run [`supabase/schema.sql`](./supabase/schema.sql) in the shared project's Supabase SQL Editor.
   Rerun the complete script when updating an existing project.
2. In Supabase **Authentication → Sign In / Providers**, enable Google. Create a Google OAuth web
   client and configure the Google provider in Supabase with its client ID and secret. In Google
   Cloud, authorize the app's local and deployed JavaScript origins, and add the Supabase callback
   URL shown in the provider setup.
3. In Supabase **Authentication → Bot and Abuse Protection**, enable Cloudflare Turnstile and enter
   the Turnstile secret key. The Turnstile site key is a frontend value; the secret key stays in
   Supabase.
4. Add these build-time variables in Vercel Project Settings → Environment Variables for the
   environments you deploy, then redeploy:

   ```env
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
   VITE_GOOGLE_CLIENT_ID=<google-oauth-web-client-id>
   VITE_TURNSTILE_SITE_KEY=<cloudflare-turnstile-site-key>
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-secret>
   CRON_SECRET=<random-secret-at-least-32-characters>
   TAVILY_API_KEY=<tavily-search-api-key>
   BRAVE_SEARCH_API_KEY=<brave-search-api-key>
   ```

   Use the same Supabase project and Google client ID across local development and deployments.
   These `VITE_*` values are included in the browser bundle and must be public values. Never expose
   a Supabase service-role/secret key or the Turnstile secret key in Vite, the browser, or Git.
   `SUPABASE_SERVICE_ROLE_KEY` is a server-only Vercel environment variable required by durable chat
   jobs and the database keepalive; add it to Development, Preview, and Production environments as
   needed. `CRON_SECRET` is server-only and protects the scheduled keepalive endpoint. Generate it
   with `openssl rand -base64 32`; add the same value to Vercel and local `.env.local`. The unprefixed
   `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are server-side settings (the server can fall back
   to their `VITE_*` counterparts. `TAVILY_API_KEY` and `BRAVE_SEARCH_API_KEY` are server-only search
   provider keys. Configure both in Vercel to enable independent provider failover; get them from
   the Tavily and Brave Search developer dashboards. Never use a `VITE_` prefix for these keys.

### Local development

Link this repository to the Vercel project, then pull its development environment variables into
the ignored local environment file:

```bash
vercel link
vercel env pull .env.local
npm install
npm run dev
```

Restart Vite after changing environment variables. Keep `.env.local` private and never commit it.
If you do not use the Vercel CLI, create `.env.local` with the four `VITE_*` values, the server-side
`SUPABASE_*` values, `CRON_SECRET`, and the optional provider keys above. Keep this file private;
`.env.local` is ignored by Git.

### User setup and data

Every user must sign in with Google after completing Cloudflare Turnstile verification. The app
blocks chat and Gemini configuration until the account is signed in; chat also requires at least
one Gemini API key. Users add their own Gemini key in **Settings → Configure**. The key is stored
with their Supabase account and sent directly from their browser to Google's Gemini API.

Existing data configured in an older browser can be imported to the central account at sign-in.
After a successful import, the old browser-specific Supabase connection is removed. The Settings
help button covers only how users create and add a Gemini API key; Google sign-in, CAPTCHA, and
database infrastructure are managed by the operator.

Text chat messages, per-message conversation insights, semantic embeddings, and job status are
stored in the connected Supabase project and protected by row-level security. A server-side Vercel
Workflow processes each queued chat job, so refreshing the browser does not cancel generation.
Supabase Realtime keeps chat and settings data in sync across tabs and signed-in devices. Gemini
analyzes each user message for tentative, non-clinical conversation insights and uses relevant past
messages, saved memories, recent insights, and Personal settings as context. Its database tools are
limited to the current user's chat, memories, and insights.

Assistant and user messages support GitHub-Flavored Markdown, including tables such as
`| Key | Title |` followed by `|--|--|`, fenced code blocks, and `_underlined text_` (single
underscores are rendered as underline in this app). Tables scroll horizontally when needed.
Assistant replies use the full conversation width and include controls for feedback, regeneration,
reporting, and copying. Fenced code blocks show syntax colors, line numbers, and a copy control.
New assistant replies render with a fast typewriter effect. On opening the chat, the conversation
automatically scrolls to its latest message. The **Think** toggle shows progress stages and an
optional user-facing summary of the context used; it does not expose private internal reasoning.
Edited user messages and regenerated replies keep their earlier versions. Version navigation
restores the associated conversation branch—including its reply and later messages—and branch
snapshots are stored in Supabase after new replies, edits, and regenerations. Run the latest
`supabase/schema.sql` in the shared project's SQL Editor to enable this for an existing project.
If an older version has no snapshot, the app saves a fallback branch using the currently active
conversation and that selected version.
Like/dislike feedback is stored per reply version, and regeneration retrieves chat context and
insights from before the revised message. Reports are private per-version feedback stored alongside
the response (not sent to an administrator); the report details are included as stronger guidance
for regeneration and relevant future replies. Revising an earlier message keeps the remaining
conversation visible on that branch, and switching versions restores the complete saved branch.

Long-press a user message on mobile or use its desktop action menu to delete that message and the
entire later conversation branch. The operation also removes related versions, insights, feedback,
jobs, branch snapshots, and AI memories that were learned from a deleted message. Settings → Memory
lets users create, edit, and delete durable personal memories; Cheya can also save a clearly durable
user fact as a memory from chat. These memories are embedded and retrieved alongside RAG conversation
context.

Cheya can automatically use Google Search grounding for requests that need current or verifiable
web information. If grounding is unavailable or fails, the server retries and falls back to Tavily
and then Brave Search, with query refinement across five passes and at least three distinct source
URLs required. Configure both optional provider keys in Vercel for independent failover. Search
results include source URLs and page text; Tavily returns extracted page content, while Brave
results are supplemented by safely fetched public pages. Google Search grounding availability and
billing depend on the model and Gemini API account; five refinement passes may consume multiple
search requests, so account for applicable provider charges.

Messages containing up to two public HTTPS links can show a preview with page title, description,
site name, and available image/video metadata. Preview loading is authenticated, rejects local or
private network destinations, limits redirects and response size, and only reads HTML.

Vercel runs the database keepalive endpoint daily. After five days without application-table
activity, it performs and removes a small database pulse. Run the updated SQL schema and configure
`SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` in the Vercel environment before relying on this job.
The Free-plan inactivity policy can change, and a keepalive cannot guarantee that Supabase will
never pause a project; monitor Cron execution in Vercel and database status in Supabase.

## Notes

- The media menu opens the browser's device picker directly. Selected images and videos show
  square previews, other files show an extension tile, and each attachment can be removed before
  sending. Tap an image or video for a full-screen preview, or a text file to edit it before
  committing it back to the attachment.
- A browser cannot force Android to open a specific file-manager app; the OS chooses the picker
  based on the user's device configuration.
- Camera access requires browser permission and a secure context (HTTPS, or localhost).
- `dist/`, `node_modules/`, and local environment files are excluded from version control.
