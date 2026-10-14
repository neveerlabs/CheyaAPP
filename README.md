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
5. If the project already has the previous schema, run the updated `supabase/schema.sql` again to
   add the Personal settings columns.

The Supabase URL and publishable key are retained in the browser as bootstrap settings and copied
to that session's database. Gemini API keys are stored in the session's Supabase rows and sent from
the browser directly to Google's Gemini API. Never use a Supabase service-role key in this
client-side app. Anonymous sessions are specific to a browser; clearing browser data or switching
devices loses access to that session's data. The Settings page's help button includes the full setup
checklist and copyable SQL schema.

## Notes

- The media menu opens the browser's device picker directly. Selected images and videos show
  square previews, other files show an extension tile, and each attachment can be removed before
  sending. Tap an image or video for a full-screen preview, or a text file to edit it before
  committing it back to the attachment.
- A browser cannot force Android to open a specific file-manager app; the OS chooses the picker
  based on the user's device configuration.
- Camera access requires browser permission and a secure context (HTTPS, or localhost).
- `dist/`, `node_modules/`, and local environment files are excluded from version control.
