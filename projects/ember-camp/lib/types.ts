export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export type ResourceDelta = Partial<Record<'wood' | 'food' | 'water' | 'warmth', number>>;

export type QuickReply = {
  text: string;
  npcResponse: string;
  completesGoal: boolean;
};

export type Mission = {
  id: string;
  level: CefrLevel;
  title: string;
  zoneId: string;
  location: string;
  characterId: string;
  characterName: string;
  portrait: string;
  scene: string;
  opening: string;
  quickReplies: QuickReply[];
  goalKeywords: string[];
  successResponse: string;
  retryResponse: string;
  followupResponses: string[];
  contextClue: string;
  learnedPhrase: string;
  xp: number;
  resources: ResourceDelta;
};

export type Zone = {
  id: string;
  name: string;
  subtitle: string;
  asset: string;
  gridArea: string;
};

export type DialogueMessage = { role: 'npc' | 'player'; text: string };

export type DialogueResult = {
  understood: boolean;
  goalCompleted: boolean;
  reply: string;
  source: 'local' | 'ai';
};
