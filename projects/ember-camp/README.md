# Ember Camp — Conversational English Survival

Next.js 16 game for learning **conversational English from A1 to C2** through comprehensible input, contextual missions and survival progression.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The complete campaign works **without any API key**.

## Neural conversation + natural TTS

Copy `.env.example` to `.env.local` and add your OpenAI API key:

```env
OPENAI_API_KEY=...
OPENAI_DIALOGUE_MODEL=gpt-5.6-luna
OPENAI_TTS_MODEL=gpt-4o-mini-tts
```

- `/api/dialogue` uses the Responses API when configured and automatically falls back to the deterministic local conversation engine if the provider fails.
- `/api/tts` requests neural MP3 speech. If unavailable, the browser selects the best installed English voice it can find.
- The API key is server-only. It is never exposed to the client bundle.

## Verification

```bash
npm run verify
npm run verify:full
```

`verify` checks the content/asset contract, TypeScript and a real Next.js production build. `verify:full` additionally starts the production server and tests `/`, `/api/dialogue` and `/api/tts`.

## Vercel

This project is designed to live at `projects/ember-camp` inside the `aprendiendo-react` pnpm workspace. In Vercel, configure the project **Root Directory** as `projects/ember-camp`. Keep the normal Next.js framework defaults; do not add legacy `builds`/catch-all `routes` configuration.

Optional server environment variables in Vercel: `OPENAI_API_KEY`, `OPENAI_DIALOGUE_MODEL`, `OPENAI_TTS_MODEL`. Without them, the game remains playable using its local conversation engine and device TTS fallback.
