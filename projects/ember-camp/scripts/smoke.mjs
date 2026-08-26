import { spawn } from 'node:child_process';

const port = 3217;
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], { stdio: ['ignore','pipe','pipe'], env: { ...process.env, PORT: String(port) } });
let output = ''; child.stdout.on('data', (d) => output += d); child.stderr.on('data', (d) => output += d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let ready = false;
  for (let i=0;i<30;i++){ await sleep(500); try { const r=await fetch(`http://127.0.0.1:${port}/`); if(r.ok){ready=true; break;} } catch {} }
  if(!ready) throw new Error(`Next server did not become ready. ${output}`);
  const home = await fetch(`http://127.0.0.1:${port}/`); const html=await home.text();
  if(!home.ok || !html.includes('EMBER CAMP')) throw new Error('Home page smoke test failed');
  const dialogue = await fetch(`http://127.0.0.1:${port}/api/dialogue`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({missionId:'a1-wood',message:'Sure, I can get some wood.',history:[],goalCompleted:false}) });
  const dj=await dialogue.json(); if(!dialogue.ok || !dj.reply || !dj.goalCompleted) throw new Error(`Dialogue smoke test failed: ${JSON.stringify(dj)}`);
  const realtime = await fetch(`http://127.0.0.1:${port}/api/realtime`); const rt=await realtime.json();
  if(!realtime.ok || rt.model !== 'gpt-realtime-2.1' || rt.transport !== 'webrtc' || rt.turnDetection !== 'semantic_vad') throw new Error(`Realtime capability contract failed: ${JSON.stringify(rt)}`);
  const tts=await fetch(`http://127.0.0.1:${port}/api/tts`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'Hello',characterId:'maya'})});
  if (![200,503].includes(tts.status)) throw new Error(`TTS contract failed with ${tts.status}`);
  console.log('smoke passed — home, immersive dialogue fallback, Realtime capability, and TTS fallback contracts are functional.');
} finally { child.kill('SIGTERM'); }
