# Ember Camp — Live Conversational English Survival

Next.js 16 voice-first game for learning **conversational English from A1 to C2** through comprehensible input, survival scenes, and unscripted interaction.

The core experience is deliberately not a quiz: there are no visible answer choices, correctness banners, or forced dialogue trees. Each scene gives an AI character a world state and an invisible story condition; the learner talks naturally until the situation changes.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Advanced voice — OpenAI Realtime

The primary conversation mode uses the OpenAI Realtime API over browser WebRTC.

```env
OPENAI_API_KEY=...
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_DIALOGUE_MODEL=gpt-5.6-luna
OPENAI_TTS_MODEL=gpt-4o-mini-tts
```

The browser never receives `OPENAI_API_KEY`. It creates an SDP offer and sends it to `/api/realtime`; the server creates the OpenAI Realtime call and returns the SDP answer.

Realtime sessions use:

- `gpt-realtime-2.1`
- WebRTC audio in/out
- `semantic_vad` turn detection
- `interrupt_response: true` for barge-in/interruption
- `marin` and `cedar` character voices
- a hidden `complete_scene` function tool so story progress is separated from the conversation surface
- a `wait_for_user` tool so silence/background noise does not force artificial chatter

Characters are prompted as people in the world, not tutors. They should react to unexpected questions, remember prior turns, disagree, joke, volunteer details, and accept imperfect grammar whenever the meaning is clear. They do not expose CEFR levels, answer keys, objectives, scoring, or correction unless the learner explicitly asks.

## Fallbacks

The full map/campaign remains usable without an API key:

- typing uses `/api/dialogue` and the deterministic local engine if AI is unavailable;
- replaying typed NPC lines uses `/api/tts` when available and browser speech as a final fallback;
- advanced full-duplex voice itself requires `OPENAI_API_KEY`, because WebRTC Realtime sessions must be created by an authenticated server endpoint.

## Verification

```bash
npm run verify
npm run verify:full
```

`verify:data` now fails if mechanical quick-reply rendering is reintroduced or if the Realtime contract loses `gpt-realtime-2.1`, `semantic_vad`, interruption support, or the invisible scene-completion tool.

`verify:full` starts the production server and exercises `/`, `/api/dialogue`, `/api/realtime`, and `/api/tts`.

## Vercel

Root Directory: `projects/ember-camp`

Keep native Next.js framework defaults. Do not add legacy `builds`/catch-all `routes` configuration.

For real advanced voice in production, set `OPENAI_API_KEY` in Vercel for the production/preview environments. `OPENAI_REALTIME_MODEL` is optional; it defaults to `gpt-realtime-2.1`.
