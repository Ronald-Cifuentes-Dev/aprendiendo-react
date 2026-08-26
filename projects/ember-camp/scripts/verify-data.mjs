import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'app/layout.tsx','app/page.tsx','app/globals.css','app/voice.css',
  'app/api/dialogue/route.ts','app/api/tts/route.ts','app/api/realtime/route.ts','app/api/gemini-token/route.ts',
  'components/GameClient.tsx','components/RealtimeVoice.tsx','components/WorldMap.tsx',
  'data/missions.ts','data/zones.ts','data/cefr.ts',
  'lib/types.ts','lib/localDialogue.ts','lib/dialoguePrompt.ts','lib/realtimePrompt.ts','lib/openai.ts',
  'public/manifest.webmanifest','public/assets/ui/logo.svg','public/assets/ui/icon.svg'
];
for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full) || fs.statSync(full).size === 0) throw new Error(`Missing required file: ${file}`);
}
for (const asset of ['woods','cookfire','river','market','base','bridge','ridge','council','gate']) {
  const file = path.join(root, 'public/assets/world', `${asset}.svg`);
  if (!fs.existsSync(file)) throw new Error(`Missing world asset: ${asset}`);
}
for (const person of ['maya','ben','leo','nora','marcus','elena','adrian']) {
  const file = path.join(root, 'public/assets/portraits', `${person}.svg`);
  if (!fs.existsSync(file)) throw new Error(`Missing portrait: ${person}`);
}
const missionSource = fs.readFileSync(path.join(root, 'data/missions.ts'), 'utf8');
for (const level of ['A1','A2','B1','B2','C1','C2']) {
  const count = (missionSource.match(new RegExp(`\\"level\\":\\"${level}\\"`, 'g')) || []).length;
  if (count !== 3) throw new Error(`${level} must contain 3 missions; found ${count}`);
}
const gameClient = fs.readFileSync(path.join(root, 'components/GameClient.tsx'), 'utf8');
if (gameClient.includes('mission.quickReplies.map')) throw new Error('Mechanical quick-reply UI must not return to the immersive game client.');

const realtimeRoute = fs.readFileSync(path.join(root, 'app/api/realtime/route.ts'), 'utf8');
for (const contract of ['gpt-realtime-2.1', 'semantic_vad', 'interrupt_response', 'complete_scene']) {
  if (!realtimeRoute.includes(contract)) throw new Error(`OpenAI Realtime fallback contract missing: ${contract}`);
}

const geminiRoute = fs.readFileSync(path.join(root, 'app/api/gemini-token/route.ts'), 'utf8');
for (const contract of ['gemini-3.1-flash-live-preview', 'auth_tokens', 'newSessionExpireTime', 'GEMINI_API_KEY']) {
  if (!geminiRoute.includes(contract)) throw new Error(`Gemini free-live contract missing: ${contract}`);
}
if (geminiRoute.includes('liveConnectConstraints')) throw new Error('Obsolete Gemini auth token field liveConnectConstraints must not be reintroduced.');

const realtimeClient = fs.readFileSync(path.join(root, 'components/RealtimeVoice.tsx'), 'utf8');
for (const contract of ['BidiGenerateContentConstrained', 'START_OF_ACTIVITY_INTERRUPTS', 'audio/pcm;rate=16000', 'Gemini Live · free tier']) {
  if (!realtimeClient.includes(contract)) throw new Error(`Gemini browser voice contract missing: ${contract}`);
}

console.log('verify:data passed — 18 missions, immersive UI, Gemini Live free-tier voice, OpenAI fallback, 9 zones, 7 portraits, all required files present.');
