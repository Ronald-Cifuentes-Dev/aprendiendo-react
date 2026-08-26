import { NextResponse } from 'next/server';
import { openAIJson } from '@/lib/openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const voices: Record<string, { voice: string; instructions: string }> = {
  maya: { voice: 'marin', instructions: 'Warm, grounded woman in her early thirties. Natural American English, conversational, emotionally present, never announcer-like.' },
  nora: { voice: 'marin', instructions: 'Confident practical woman. Natural conversational American English with subtle energy and realistic pauses.' },
  elena: { voice: 'marin', instructions: 'Thoughtful direct woman. Calm conversational English; use subtext naturally and avoid theatrical delivery.' },
  ben: { voice: 'cedar', instructions: 'Friendly relaxed man. Natural conversational American English, warm and informal, with realistic pacing.' },
  leo: { voice: 'cedar', instructions: 'Young adult man, casual and expressive. Natural conversational English, not polished narration.' },
  marcus: { voice: 'cedar', instructions: 'Calm cautious man. Everyday conversational English, slightly serious but human and spontaneous.' },
  adrian: { voice: 'cedar', instructions: 'Diplomatic articulate man. Natural educated conversational English with subtle dry humor, never robotic.' },
};

type Body = { text?: string; characterId?: string; speed?: number };

type GatewayModelsResponse = {
  data?: Array<{ id?: string; type?: string }>;
};

export async function GET() {
  const gatewayToken = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  let gatewaySpeechModels: string[] = [];
  let gatewayReachable = false;

  if (gatewayToken) {
    try {
      const response = await fetch('https://ai-gateway.vercel.sh/v1/models', {
        headers: { Authorization: `Bearer ${gatewayToken}` },
        cache: 'no-store',
      });
      gatewayReachable = response.ok;
      if (response.ok) {
        const payload = (await response.json()) as GatewayModelsResponse;
        gatewaySpeechModels = (payload.data ?? [])
          .map((item) => item.id ?? '')
          .filter((id) => /tts|speech/i.test(id))
          .sort();
      }
    } catch (error) {
      console.error('[tts] AI Gateway capability probe failed:', error);
    }
  }

  return NextResponse.json({
    status: 'ok',
    route: 'tts',
    directOpenAIConfigured: Boolean(process.env.OPENAI_API_KEY),
    vercelOidcAvailable: Boolean(process.env.VERCEL_OIDC_TOKEN),
    aiGatewayKeyConfigured: Boolean(process.env.AI_GATEWAY_API_KEY),
    gatewayReachable,
    gatewaySpeechModels,
    directModel: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    builtInVoices: ['marin', 'cedar'],
    fallback: 'browser-speech-synthesis',
    maxInputCharacters: 4096,
  });
}

export async function POST(request: Request) {
  let body: Body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ available: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const text = body.text?.trim() ?? '';
  if (!text || text.length > 4096) {
    return NextResponse.json({ available: false, error: 'text must contain 1–4096 characters' }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ available: false, fallback: 'browser' }, { status: 503 });
  }

  const profile = voices[body.characterId ?? ''] ?? voices.maya;
  const speed = Math.min(1.15, Math.max(0.75, Number(body.speed) || 1));

  try {
    const response = await openAIJson('/v1/audio/speech', {
      model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: profile.voice,
      input: text,
      instructions: profile.instructions,
      response_format: 'mp3',
      speed,
    });
    const audio = await response.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=3600',
        'X-Ember-Voice-Source': 'neural',
        'X-Ember-Voice': profile.voice,
      },
    });
  } catch (error) {
    console.error('[tts] neural fallback:', error);
    return NextResponse.json({ available: false, fallback: 'browser' }, { status: 503 });
  }
}
