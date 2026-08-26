import type { DialogueMessage, DialogueResult, Mission } from '@/lib/types';

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function keywordHit(message: string, keywords: string[]) {
  const clean = normalize(message);
  return keywords.some((keyword) => clean.includes(normalize(keyword)));
}

export function evaluateLocally(
  mission: Mission,
  message: string,
  history: DialogueMessage[],
  alreadyCompleted = false,
): DialogueResult {
  const clean = normalize(message);
  if (!clean || clean.length < 2) {
    return { understood: false, goalCompleted: alreadyCompleted, reply: mission.retryResponse, source: 'local' };
  }

  const quick = mission.quickReplies.find((item) => {
    const q = normalize(item.text);
    const tokens = q.split(' ').filter((token) => token.length >= 4);
    return tokens.filter((token) => clean.includes(token)).length >= Math.min(2, Math.max(1, Math.floor(tokens.length / 3)));
  });

  if (quick) {
    return {
      understood: true,
      goalCompleted: alreadyCompleted || quick.completesGoal,
      reply: quick.npcResponse,
      source: 'local',
    };
  }

  if (keywordHit(message, mission.goalKeywords)) {
    return { understood: true, goalCompleted: true, reply: mission.successResponse, source: 'local' };
  }

  if (alreadyCompleted) {
    const playerTurns = history.filter((item) => item.role === 'player').length;
    return {
      understood: true,
      goalCompleted: true,
      reply: mission.followupResponses[playerTurns % mission.followupResponses.length] ?? mission.successResponse,
      source: 'local',
    };
  }

  const social = ['yes', 'yeah', 'sure', 'okay', 'ok', 'right', 'why', 'what', 'where', 'how', 'really', 'sorry', 'thanks', 'thank you'];
  if (social.some((word) => clean.includes(word))) {
    return { understood: true, goalCompleted: false, reply: mission.retryResponse, source: 'local' };
  }

  return { understood: false, goalCompleted: false, reply: mission.retryResponse, source: 'local' };
}
