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

Each user connects their own Supabase project and signs in with Supabase Auth. Enable the Email
provider in Supabase Authentication settings. Before connecting:

1. Run [`supabase/schema.sql`](./supabase/schema.sql) in the project's Supabase SQL Editor.
2. In Settings, enter the Supabase Project URL and publishable (or legacy anon) key.
3. Create an account or sign in. Row Level Security limits settings and Gemini API keys to that account.
4. Add one or more Gemini API keys and select `gemini-3.1-flash-lite` or `gemini-3.5-flash-lite`.

The Supabase URL and publishable key are retained in the browser as bootstrap settings and copied
to the signed-in user's database. Gemini API keys are stored in that user's Supabase table and sent
from the browser directly to Google's Gemini API. Never use a Supabase service-role key in this
client-side app. A user who can sign in can access their own Gemini keys from their browser. The
Settings page's `?` help button includes the full setup checklist and copyable SQL schema.

## Notes

- The media menu opens the browser's device picker directly. Selected images and videos show
  square previews, other files show an extension tile, and each attachment can be removed before
  sending. Tap an image or video for a full-screen preview, or a text file to edit it before
  committing it back to the attachment.
- A browser cannot force Android to open a specific file-manager app; the OS chooses the picker
  based on the user's device configuration.
- Camera access requires browser permission and a secure context (HTTPS, or localhost).
- `dist/`, `node_modules/`, and local environment files are excluded from version control.
