import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    route: 'gemini-token',
    available: Boolean(process.env.GEMINI_API_KEY),
    provider: 'google',
    model: process.env.GEMINI_LIVE_MODEL || DEFAULT_MODEL,
    transport: 'websocket',
    freeTierCapable: true,
    ephemeralTokens: true,
  });
}

export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_LIVE_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured.' }, { status: 503 });
  }

  // Keep the permanent key server-side and issue a short-lived, single-use token.
  // We intentionally do NOT embed bidiGenerateContentSetup in the token. With the
  // current Gemini API, omitting it means the browser's first WebSocket `setup`
  // message remains authoritative for voice, tools, VAD and character instructions.
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        uses: 1,
        expireTime,
        newSessionExpireTime,
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('[gemini-token] provisioning failed:', response.status, detail.slice(0, 500));
      return NextResponse.json({ error: 'Gemini Live token provisioning failed.' }, { status: 502 });
    }

    const payload = await response.json() as { name?: string; expireTime?: string; newSessionExpireTime?: string };
    if (!payload.name) {
      return NextResponse.json({ error: 'Gemini did not return an ephemeral token.' }, { status: 502 });
    }

    return NextResponse.json({
      token: payload.name,
      model,
      expireTime: payload.expireTime || expireTime,
      provider: 'google',
    }, {
      headers: { 'cache-control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[gemini-token] error:', error);
    return NextResponse.json({ error: 'Gemini Live token provisioning failed.' }, { status: 502 });
  }
}
