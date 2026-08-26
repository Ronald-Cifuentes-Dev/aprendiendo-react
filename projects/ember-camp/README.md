# Ember Camp — Live Conversational English Survival

Next.js 16 voice-first game for learning **conversational English from A1 to C2** through comprehensible input, survival scenes, and unscripted interaction.

The core experience is deliberately not a quiz: there are no visible answer choices, correctness banners, or forced dialogue trees. Each scene gives an AI character a world state and an invisible story condition; the learner talks naturally until the situation changes.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Preferred live voice — Gemini 3.1 Flash Live Free Tier

The preferred provider is Google Gemini Live because `gemini-3.1-flash-live-preview` currently has a free API tier for audio input/output (subject to Google's quotas and free-tier terms).

```env
GEMINI_API_KEY=...
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
```

Security architecture:

1. `GEMINI_API_KEY` stays on the Next.js server.
2. `/api/gemini-token` exchanges it for a short-lived single-session ephemeral token.
3. The browser connects directly to Gemini Live through the constrained `v1beta` WebSocket endpoint.
4. The permanent API key is never embedded in client JavaScript.

Gemini sessions use native audio-in/audio-out, automatic activity detection, interruption on user speech, 16 kHz PCM microphone input, 24 kHz PCM model audio, input/output transcription, function calling, session resumption support, and character-specific voices.

## Optional premium fallback — OpenAI Realtime

If Gemini is not configured but OpenAI is, Ember Camp automatically falls back to OpenAI Realtime over browser WebRTC.

```env
OPENAI_API_KEY=...
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_DIALOGUE_MODEL=gpt-5.6-luna
OPENAI_TTS_MODEL=gpt-4o-mini-tts
```

OpenAI sessions use `semantic_vad`, interruption/barge-in, and the same invisible `complete_scene` / `wait_for_user` story tools.

## Provider priority

At runtime the client chooses:

1. Gemini Live when `GEMINI_API_KEY` is configured.
2. OpenAI Realtime when `OPENAI_API_KEY` is configured.
3. Typed immersive conversation when neither live provider is configured.

Characters are prompted as people in the world, not tutors. They react to unexpected questions, remember prior turns, disagree, joke, volunteer details, and accept imperfect grammar whenever the meaning is clear. They do not expose CEFR levels, answer keys, objectives, scoring, or correction unless the learner explicitly asks.

## Important free-tier note

Google's free Gemini API tier has usage quotas and its terms currently state that free-tier content may be used to improve Google products. It is free of API usage charges within those limits, not an unlimited SLA. If the quota is exhausted, the app keeps the typed fallback available.

## Verification

```bash
npm run verify
npm run verify:full
```

`verify:data` fails if mechanical quick-reply rendering is reintroduced or if either live voice contract disappears.

`verify:full` starts the production server and exercises `/`, `/api/dialogue`, `/api/gemini-token`, `/api/realtime`, and `/api/tts`.

## Vercel

Root Directory: `projects/ember-camp`

Keep native Next.js framework defaults. Do not add legacy `builds`/catch-all `routes` configuration.

For the free live provider, create a Gemini API key in Google AI Studio and set `GEMINI_API_KEY` in Vercel for Production/Preview. `GEMINI_LIVE_MODEL` is optional and defaults to `gemini-3.1-flash-live-preview`.
