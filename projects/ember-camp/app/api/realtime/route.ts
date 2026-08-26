import { NextResponse } from 'next/server';
import { missions } from '@/data/missions';
import { buildRealtimeInstructions, getRealtimeVoice } from '@/lib/realtimePrompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_MODEL = 'gpt-realtime-2.1';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    route: 'realtime',
    available: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_REALTIME_MODEL || DEFAULT_MODEL,
    transport: 'webrtc',
    turnDetection: 'semantic_vad',
    interruption: true,
    voices: ['marin', 'cedar'],
  });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Advanced voice is not configured on the server.', code: 'REALTIME_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const missionId = url.searchParams.get('missionId');
  const mission = missions.find((item) => item.id === missionId);
  if (!mission) {
    return NextResponse.json({ error: 'Unknown scene.' }, { status: 404 });
  }

  const sdp = await request.text();
  if (!sdp || !sdp.includes('v=0')) {
    return NextResponse.json({ error: 'A WebRTC SDP offer is required.' }, { status: 400 });
  }

  const session = {
    type: 'realtime',
    model: process.env.OPENAI_REALTIME_MODEL || DEFAULT_MODEL,
    output_modalities: ['audio'],
    instructions: buildRealtimeInstructions(mission),
    audio: {
      input: {
        turn_detection: {
          type: 'semantic_vad',
          eagerness: mission.level === 'A1' || mission.level === 'A2' ? 'low' : 'auto',
          create_response: true,
          interrupt_response: true,
        },
      },
      output: {
        voice: getRealtimeVoice(mission.characterId),
      },
    },
    tools: [
      {
        type: 'function',
        name: 'complete_scene',
        description: 'Silently mark that the learner has meaningfully engaged with the current real-world situation enough for the story to progress. Use semantic meaning, not exact wording. Call at most once.',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Brief private reason the scene can now progress.' },
          },
          required: ['reason'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'wait_for_user',
        description: 'Use when there is only silence, background noise, or no meaningful utterance and the natural action is to remain quiet and wait.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    ],
    tool_choice: 'auto',
  };

  const form = new FormData();
  form.set('sdp', sdp);
  form.set('session', JSON.stringify(session));

  try {
    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      cache: 'no-store',
    });

    const answer = await response.text();
    if (!response.ok) {
      console.error('[realtime] OpenAI session error:', response.status, answer.slice(0, 800));
      return NextResponse.json(
        { error: 'Could not start advanced voice.', providerStatus: response.status },
        { status: 502 },
      );
    }

    return new Response(answer, {
      status: 200,
      headers: {
        'Content-Type': 'application/sdp',
        'Cache-Control': 'no-store',
        'X-Ember-Realtime-Model': session.model,
      },
    });
  } catch (error) {
    console.error('[realtime] session creation failed:', error);
    return NextResponse.json({ error: 'Could not reach the realtime voice service.' }, { status: 502 });
  }
}
