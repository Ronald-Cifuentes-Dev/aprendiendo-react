import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';

type ProbeResult = {
  websocketOpened: boolean;
  setupComplete: boolean;
  audioReceived: boolean;
  turnComplete: boolean;
};

async function readSocketData(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  return '';
}

async function probeLive(token: string, model: string): Promise<ProbeResult> {
  const endpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint);
    const state: ProbeResult = {
      websocketOpened: false,
      setupComplete: false,
      audioReceived: false,
      turnComplete: false,
    };
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      if (error) reject(error);
      else resolve(state);
    };

    const timeout = setTimeout(() => {
      finish(new Error(`Live probe timed out (opened=${state.websocketOpened}, setup=${state.setupComplete}, audio=${state.audioReceived}, turn=${state.turnComplete})`));
    }, 20000);

    ws.addEventListener('open', () => {
      state.websocketOpened = true;
      ws.send(JSON.stringify({
        setup: {
          model: `models/${model}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Sulafat' },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: 'You are Maya in a survival camp. Speak natural conversational English. Keep this diagnostic reply very short.' }],
          },
          tools: [{
            functionDeclarations: [{
              name: 'complete_scene',
              description: 'Mark a story scene resolved when appropriate.',
              parameters: {
                type: 'OBJECT',
                properties: { reason: { type: 'STRING' } },
                required: ['reason'],
              },
            }],
          }],
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
              prefixPaddingMs: 80,
              silenceDurationMs: 500,
            },
            activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          sessionResumption: {},
          contextWindowCompression: { slidingWindow: {} },
        },
      }));
    });

    ws.addEventListener('message', async (event) => {
      const raw = await readSocketData(event.data);
      if (!raw) return;
      let message: any;
      try { message = JSON.parse(raw); } catch { return; }

      if (message.setupComplete && !state.setupComplete) {
        state.setupComplete = true;
        ws.send(JSON.stringify({ realtimeInput: { text: 'Say hello in one short sentence.' } }));
      }

      const content = message.serverContent;
      for (const part of content?.modelTurn?.parts ?? []) {
        if (part?.inlineData?.data) state.audioReceived = true;
      }
      if (content?.turnComplete) state.turnComplete = true;

      if (state.setupComplete && state.audioReceived && state.turnComplete) finish();
    });

    ws.addEventListener('error', () => finish(new Error('Gemini Live WebSocket emitted an error.')));
    ws.addEventListener('close', (event) => {
      if (!settled && !(state.setupComplete && state.audioReceived && state.turnComplete)) {
        finish(new Error(`Gemini Live closed early (code=${event.code}, reason=${event.reason || 'none'}, opened=${state.websocketOpened}, setup=${state.setupComplete}, audio=${state.audioReceived}, turn=${state.turnComplete})`));
      }
    });
  });
}

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_LIVE_MODEL || DEFAULT_MODEL;
  if (!apiKey) return NextResponse.json({ status: 'error', stage: 'environment', error: 'GEMINI_API_KEY missing' }, { status: 503 });

  const expireTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

  try {
    const tokenResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ uses: 1, expireTime, newSessionExpireTime }),
      cache: 'no-store',
    });

    if (!tokenResponse.ok) {
      const detail = await tokenResponse.text();
      return NextResponse.json({ status: 'error', stage: 'token', providerStatus: tokenResponse.status, detail: detail.slice(0, 800) }, { status: 502 });
    }

    const tokenPayload = await tokenResponse.json() as { name?: string };
    if (!tokenPayload.name) return NextResponse.json({ status: 'error', stage: 'token', error: 'No ephemeral token returned' }, { status: 502 });

    const live = await probeLive(tokenPayload.name, model);
    return NextResponse.json({ status: 'ok', model, tokenProvisioned: true, ...live }, { headers: { 'cache-control': 'no-store, max-age=0' } });
  } catch (error) {
    return NextResponse.json({ status: 'error', stage: 'live', error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
