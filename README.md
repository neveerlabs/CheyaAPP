# CheyaVerse

A mobile-first personal AI chat interface built with React, TypeScript, Vite, and Tailwind CSS.

## Requirements

- Node.js 24.x
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

CheyaVerse uses one operator-managed Supabase project for Google and GitHub authentication and
application data. Users do not create or connect their own Supabase or OAuth projects. Row Level
Security isolates each account's chats, Gemini API keys, personalization, memories, feedback, and
insights.
The Settings **General** page stores desktop/mobile Enter behavior independently, time display,
chat font size, and web-search availability in that account's `user_settings` row. Defaults preserve
the existing device-specific Enter behavior, current time format, current chat text sizes, and
enabled web search. Push subscriptions remain registered per account and device.

### One-time operator setup

1. Run [`supabase/schema.sql`](./supabase/schema.sql) in the shared project's Supabase SQL Editor.
   Rerun the complete script when updating an existing project.
2. In Supabase **Authentication → Sign In / Providers**, enable Google and GitHub. Create a Google
   OAuth web client and configure the Google provider in Supabase with its client ID and secret.
   Create a GitHub OAuth app and configure its client ID and secret in Supabase. Set the GitHub
   OAuth app's callback URL to `https://<project-ref>.supabase.co/auth/v1/callback`. In Google
   Cloud, authorize the app's local and deployed JavaScript origins.
3. In Supabase **Authentication → URL Configuration**, set the deployed app as the Site URL and add
   local and deployed app origins to the allowed redirect URLs. GitHub sign-in redirects back to
   the app origin after Supabase completes OAuth. Browser OAuth uses PKCE, so the final app callback
   uses a short-lived `?code=` parameter rather than putting session tokens in the URL fragment.
4. In Supabase **Authentication → Bot and Abuse Protection**, enable Cloudflare Turnstile and enter
   the Turnstile secret key. The Turnstile site key is a frontend value; the secret key stays in
   Supabase.
5. Add these environment variables in Vercel Project Settings → Environment Variables for the
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
   APP_ACCESS_CODE=<six-digit-sign-in-code>
   TURNSTILE_SECRET_KEY=<cloudflare-turnstile-secret-key>
   VAPID_PUBLIC_KEY=<web-push-public-key>
   VAPID_PRIVATE_KEY=<web-push-private-key>
   VAPID_SUBJECT=mailto:<operator-contact-email>
   TINYFISH_API_KEY=<tinyfish-api-key>
   TAVILY_API_KEY=<tavily-search-api-key>
   BRAVE_SEARCH_API_KEY=<brave-search-api-key>
   ```

   Generate a matching VAPID key pair with `npx web-push generate-vapid-keys`. Set the public and
   private keys as server environment variables (never `VITE_` variables); `VAPID_SUBJECT` should be
   a contact URI such as `mailto:you@example.com`. For local development, put the same three
   variables in the root `.env` file and restart the dev server. In the deployed environment, set
   them in the hosting provider's server-side environment-variable settings and redeploy.

The schema creates a protected `account_profiles` row for every existing and new auth user.
Accounts without a linked GitHub identity named `neveerlabs` receive the `user` role; an account
with that GitHub identity receives `admin`, including when the account was originally created with
Google. Chat, insights, memories, and other account data remain linked to that profile through
their existing `user_id`; no existing content is rewritten. The AI receives this role as account
context when generating a reply.
GitHub OAuth requests only the `read:user` scope. CheyaAPP uses the Google email for Google sign-in
and the GitHub profile username for GitHub sign-in. Supabase automatically links OAuth identities
that return the same verified email, and this cannot be disabled in the app. Linked identities
share one Supabase user and therefore the same app data. To keep a GitHub account separate from a
Google account with the same email, make the GitHub account's public email private and revoke
CheyaAPP from GitHub **Settings → Applications → Authorized OAuth Apps** so the old `user:email`
grant is removed. If Supabase has already linked the identities, the project administrator must
unlink the GitHub identity from that Supabase user before either account can be used separately.
Do not delete the Supabase user, since its existing chat and account data are attached to it.

   Use the same Supabase project and Google client ID across local development and deployments.
   These `VITE_*` values are included in the browser bundle and must be public values. Never expose
   a Supabase service-role/secret key or the Turnstile secret key in Vite, the browser, or Git.
   `SUPABASE_SERVICE_ROLE_KEY` is a server-only Vercel environment variable required by durable chat
   jobs, role-checked account AI actions, reminders, and the database keepalive; add it to Development, Preview, and Production environments as
   needed. `APP_ACCESS_CODE` is a server-only, exactly six-digit code required before OAuth sign-in;
   configure the same value in each Vercel environment where sign-in is enabled. The code endpoint
   verifies Turnstile server-side and limits repeated failures per server instance. `TURNSTILE_SECRET_KEY`
   is the Cloudflare secret key for that same Turnstile widget; it is needed because CAPTCHA tokens
   are single-use, so the login page asks for a fresh human verification after the access code has
   been accepted and before Google sign-in. Never use a `VITE_` prefix for either server-only value.
   The code is an additional shared sign-in gate, not a replacement for Supabase authentication or
   row-level security. `CRON_SECRET` is server-only and protects the scheduled keepalive endpoint. Generate it
   with `openssl rand -base64 32`; add the same value to Vercel and local `.env.local`. The unprefixed
   `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are server-side settings (the server can fall back
   to their `VITE_*` counterparts. `TINYFISH_API_KEY`, `TAVILY_API_KEY`, and
   `BRAVE_SEARCH_API_KEY` are server-only search provider keys. Get the TinyFish key from its API
   keys dashboard; never expose it with a `VITE_` prefix. DuckDuckGo requires no key and is used as
   a best-effort HTML search fallback; it may rate-limit automated requests. TinyFish is preferred
   when configured, then Google Search grounding, DuckDuckGo, and any configured Tavily/Brave
   providers are tried across refined search passes.
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` configure server-sent Web Push.
   Keep the private key server-only and use the same key pair in local, preview, and production
   environments that must deliver reminders. The app returns only the public key to the browser.

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
`SUPABASE_*` values, `CRON_SECRET`, `APP_ACCESS_CODE`, `TURNSTILE_SECRET_KEY`, the three VAPID
values, and any optional provider keys above. Keep this file private;
`.env.local` is ignored by Git.

### User setup and data

Every user must enter the operator's six-digit access code and sign in with Google or GitHub after completing
Cloudflare Turnstile verification. The app blocks chat and Gemini configuration until the account is signed in; chat also requires at least
one Gemini API key. Users add their own Gemini key in **Settings → Configure**. The key is stored
with their Supabase account and sent directly from their browser to Google's Gemini API.

Existing data configured in an older browser can be imported to the central account at sign-in.
After a successful import, the old browser-specific Supabase connection is removed. The Settings
help button covers only how users create and add a Gemini API key; Google sign-in, CAPTCHA, and
database infrastructure are managed by the operator.

### AI account access, messages, and reminders

The server verifies the account role for every cross-account AI action. User accounts can use
personal data tools only within their own account and can explicitly ask Cheya to relay a message
to the administrator. Relayed content appears only in the administrator's chat as untrusted quoted
content; it is not added to the notification inbox. Administrators can search account content and
prepare messages for one or more accounts; every outgoing admin message stays pending until an
administrator approves it in the chat header's notification inbox. Approved messages are added to each recipient's
inbox and sent as push notifications. Relayed messages appear in the administrator's chat with a
clear sender label and quoted-content boundary. API keys, push subscription credentials, and private file
bytes are never provided to the model. Forwarded attachments are restricted to the original 24-hour
retention window and are opened through a short-lived, administrator-only link.

Users and administrators can ask Cheya to schedule one-time or recurring reminders. Reminder times
use WIB (Asia/Jakarta), and recurring intervals support minutes, hours, days, weeks, months, and
years. Reminders appear as non-regenerable assistant messages in chat and are also sent as Web Push.
The notification bell in the chat header opens the account inbox. Devices without push permission
show an enable-notifications banner below the chat header; each device must enable it separately.
When explicitly asked to resend a file or media uploaded within 24 hours, Cheya can reference the
original upload in an assistant reply. Administrators can similarly reference another account's
unexpired upload in their own chat. These are database links to the private original object, not
new uploads or storage copies; expired or deleted files cannot be shared, and previews remain
short-lived and role-checked.
Push notifications are suppressed while any recent account session is active in the chat, and are
sent to every registered device for that account only when the recipient is away from chat. This
applies to assistant replies, reminders, account messages, relayed messages, and explicit AI push
tests. AI reply failures are recorded in the recipient's inbox instead of being rendered as chat
messages. Push delivery requires the VAPID environment variables above, the updated `supabase/schema.sql`,
and a deployment that runs durable workflows.

Text chat messages, per-message conversation insights, semantic embeddings, and job status are
stored in the connected Supabase project and protected by row-level security. A server-side Vercel
Workflow processes each queued chat job independently of the browser, so navigating away, refreshing,
or closing the page does not cancel generation after the job has been accepted. Chat status follows
Supabase Realtime with a five-second polling fallback and refreshes when the page becomes visible
again. For local development, keep the local server running until its workflow finishes; stopping
that server stops its local workflow runtime. Supabase Realtime keeps chat and settings data in sync
across tabs and signed-in devices. Account settings list all recorded web sessions, mark sessions
active when their heartbeat is under 90 seconds old, and show a live elapsed time for inactive ones.
The current browser reuses a persistent account-scoped session ID across page reloads and browser
restarts, while signed-in accounts in the same browser keep separate session IDs.
Session presence is marked active only while a web-app tab is visible, refreshed every 15 seconds,
and marked inactive when the browser reports the tab hidden or page closed.
Cheya's
primary role is a personal friend and listening companion; database and web tools are secondary and
used when useful or requested. Gemini analyzes every incoming message in recent context for tentative,
non-clinical conversation insight, but routine messages do not create a saved insight. Cheya may
silently listen when the user asks for quiet or clearly closes the conversation. It uses relevant
past messages, saved memories, recent insights, and Personal settings as context. Its database tools
are limited to the current user's chat, memories, and insights. Exact duplicate saved memories can be
cleaned up on an explicit request with confirmation; repeated chat messages are preserved because
they may be intentional.

When an uploaded image contains a supported barcode or QR code, the browser decodes its contents
locally and passes the result only as private context for the AI response. The decoded value is not
added to the visible chat message or stored as a separate database record; the original image is
still provided to the model when available.

Assistant and user messages support GitHub-Flavored Markdown, including tables such as
`| Key | Title |` followed by `|--|--|`, fenced code blocks, and `_underlined text_` (single
underscores are rendered as underline in this app). Tables scroll horizontally when needed.
Assistant replies use the full conversation width and include controls for feedback, regeneration,
reporting, speech playback, and copying. Speech is generated by Gemini TTS before playback; the
dedicated API key and voice are configured separately from chat keys in Settings → Configure.
Delivery is inferred from each response's text, and playback progress colors the played waveform
bars directly in dark blue while unplayed bars stay black. TTS requests use the configured Gemini
project's model access, billing, and quota. Fenced code blocks show syntax colors, line numbers, and
a copy control.
New assistant replies render with a fast typewriter effect. On opening the chat, the conversation
automatically scrolls to its latest message. The **Think** toggle shows progress stages and an
optional user-facing summary of the context used; it does not expose private internal reasoning.
Submitting from a mobile device keeps the keyboard open and scrolls the active response into view.
Editing a user message or regenerating an assistant reply hides later messages from the current chat
view and generates a replacement reply; the messages remain stored. Version navigation is available
on both user messages and assistant replies and restores the associated full conversation branch,
including later messages. Branch snapshots are refreshed as the conversation grows so an older
version does not restore as a short, truncated chat.
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
context. The **Clear chats** control in Settings → Memory removes all chat messages and their
cascading insights while preserving durable memories by detaching their optional source-message links.

Cheya automatically searches when current or verifiable web information would help. Search uses
TinyFish when configured, Google Search grounding, DuckDuckGo's public HTML results as a no-key
fallback, and optional Tavily/Brave providers across refined query passes. Results are inspected
through the safe public-page fetcher where possible, and the search requires at least three distinct
source URLs. DuckDuckGo's Instant Answer API is not a general web-results API; the HTML fallback can
be rate-limited, so configure `TINYFISH_API_KEY` in Vercel for a structured search API. Search may
make multiple provider requests; account for applicable provider quotas and charges.

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
- Uploaded videos are metadata-stripped and compressed with WebCodecs when the browser supports
  it; older or incompatible browsers use the slower media-recording fallback. Output videos that
  exceed the attachment size limit are rejected instead of being uploaded partially.
- A browser cannot force Android to open a specific file-manager app; the OS chooses the picker
  based on the user's device configuration.
- Camera access requires browser permission and a secure context (HTTPS, or localhost).
- `dist/`, `node_modules/`, and local environment files are excluded from version control.
