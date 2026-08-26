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

export function GET() {
  return NextResponse.json({
    status: 'ok',
    route: 'tts',
    neuralConfigured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
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
