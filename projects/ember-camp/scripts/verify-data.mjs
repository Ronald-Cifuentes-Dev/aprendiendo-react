import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'app/layout.tsx','app/page.tsx','app/globals.css','app/api/dialogue/route.ts','app/api/tts/route.ts',
  'components/GameClient.tsx','components/WorldMap.tsx','data/missions.ts','data/zones.ts','data/cefr.ts',
  'lib/types.ts','lib/localDialogue.ts','lib/dialoguePrompt.ts','lib/openai.ts','public/manifest.webmanifest',
  'public/assets/ui/logo.svg','public/assets/ui/icon.svg'
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
console.log('verify:data passed — 18 missions, 6 CEFR levels, 9 zones, 7 portraits, all required files present.');
