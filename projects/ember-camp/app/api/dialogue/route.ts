import { NextResponse } from 'next/server';
import { missions } from '@/data/missions';
import { buildDialoguePrompt } from '@/lib/dialoguePrompt';
import { evaluateLocally } from '@/lib/localDialogue';
import { extractResponseText, openAIJson } from '@/lib/openai';
import type { DialogueMessage, DialogueResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RequestBody = {
  missionId?: string;
  message?: string;
  history?: DialogueMessage[];
  goalCompleted?: boolean;
};

const dialogueSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    understood: { type: 'boolean' },
    goalCompleted: { type: 'boolean' },
    reply: { type: 'string' },
  },
  required: ['understood', 'goalCompleted', 'reply'],
};

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const mission = missions.find((item) => item.id === body.missionId);
  const message = body.message?.trim() ?? '';
  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
  const goalCompleted = Boolean(body.goalCompleted);

  if (!mission || !message) {
    return NextResponse.json({ error: 'missionId and message are required' }, { status: 400 });
  }

  const local = evaluateLocally(mission, message, history, goalCompleted);
  if (!process.env.OPENAI_API_KEY) return NextResponse.json(local);

  try {
    const response = await openAIJson('/v1/responses', {
      model: process.env.OPENAI_DIALOGUE_MODEL || 'gpt-5.6-luna',
      input: buildDialoguePrompt(mission, message, history, goalCompleted),
      text: {
        format: {
          type: 'json_schema',
          name: 'ember_dialogue',
          strict: true,
          schema: dialogueSchema,
        },
      },
    });

    const payload = await response.json();
    const text = extractResponseText(payload);
    if (!text) throw new Error('OpenAI response contained no output_text');

    const parsed = JSON.parse(text) as Omit<DialogueResult, 'source'>;
    if (
      typeof parsed.reply !== 'string' ||
      typeof parsed.understood !== 'boolean' ||
      typeof parsed.goalCompleted !== 'boolean'
    ) {
      throw new Error('Invalid dialogue schema');
    }

    return NextResponse.json({
      ...parsed,
      goalCompleted: goalCompleted || parsed.goalCompleted,
      source: 'ai',
    } satisfies DialogueResult);
  } catch (error) {
    console.error('[dialogue] AI fallback:', error);
    return NextResponse.json(local, { headers: { 'x-ember-fallback': 'local' } });
  }
}
