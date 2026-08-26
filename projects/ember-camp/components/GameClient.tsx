'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import RealtimeVoice from '@/components/RealtimeVoice';
import WorldMap from '@/components/WorldMap';
import { cefrLevels } from '@/data/cefr';
import { missions } from '@/data/missions';
import type { DialogueMessage, DialogueResult, Mission } from '@/lib/types';

type Resources = { wood: number; food: number; water: number; warmth: number };
type SaveState = { missionIndex: number; xp: number; resources: Resources; learned: string[]; completed: string[] };

const initialState: SaveState = {
  missionIndex: 0,
  xp: 0,
  resources: { wood: 1, food: 2, water: 2, warmth: 55 },
  learned: [],
  completed: [],
};
const SAVE_KEY = 'ember-camp-save-v1';

function clampResource(value: number) { return Math.max(0, Math.min(999, value)); }
function normalizeTranscript(value: string) { return value.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

export default function GameClient() {
  const [save, setSave] = useState<SaveState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [history, setHistory] = useState<DialogueMessage[]>([]);
  const [input, setInput] = useState('');
  const [sceneResolved, setSceneResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const [voiceLive, setVoiceLive] = useState(false);
  const [sceneSignal, setSceneSignal] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const mission = missions[Math.min(save.missionIndex, missions.length - 1)];
  const finished = save.missionIndex >= missions.length;
  const levelIndex = cefrLevels.indexOf(mission.level);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SAVE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as SaveState;
        if (Number.isInteger(parsed.missionIndex) && parsed.resources) setSave(parsed);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  }, [save, hydrated]);

  useEffect(() => {
    if (!finished) {
      setHistory([{ role: 'npc', text: mission.opening }]);
      setSceneResolved(false);
      setHintVisible(false);
      setVoiceLive(false);
      setSceneSignal('');
      setInput('');
    }
  }, [mission.id, finished]);

  const day = Math.floor(Math.min(save.missionIndex, missions.length - 1) / 3) + 1;
  const progress = Math.round((Math.min(save.missionIndex, missions.length) / missions.length) * 100);
  const levelStats = useMemo(
    () => cefrLevels.map((level) => ({ level, complete: missions.filter((m) => m.level === level).every((m) => save.completed.includes(m.id)) })),
    [save.completed],
  );

  const browserSpeak = useCallback((text: string, currentMission: Mission) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices().filter((voice) => /^en(-|_)/i.test(voice.lang));
    const preferred = voices.find((voice) => /natural|neural|premium|enhanced|google us english|samantha|ava|daniel/i.test(voice.name)) ?? voices[0];
    if (preferred) utterance.voice = preferred;
    utterance.lang = preferred?.lang || 'en-US';
    utterance.rate = [0.82, 0.88, 0.94, 1, 1.03, 1.06][cefrLevels.indexOf(currentMission.level)];
    window.speechSynthesis.speak(utterance);
  }, []);

  const speakFallback = useCallback(async (text: string) => {
    if (!text || voiceLive) return;
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, characterId: mission.characterId, speed: [0.88, 0.92, 0.96, 1, 1.02, 1.04][levelIndex] }),
      });
      if (!response.ok || !response.headers.get('content-type')?.includes('audio/')) throw new Error('neural unavailable');
      const blob = await response.blob();
      if (audioRef.current) {
        audioRef.current.pause();
        if (audioRef.current.src.startsWith('blob:')) URL.revokeObjectURL(audioRef.current.src);
      }
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      audio.onerror = () => browserSpeak(text, mission);
      await audio.play();
    } catch {
      browserSpeak(text, mission);
    }
  }, [browserSpeak, levelIndex, mission, voiceLive]);

  const resolveScene = useCallback((_reason?: string) => {
    setSceneResolved(true);
    setSceneSignal('Something in the situation has shifted. You can stay and keep talking, or leave when it feels natural.');
  }, []);

  const addNpcTranscript = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setHistory((current) => {
      const lastNpc = [...current].reverse().find((item) => item.role === 'npc');
      if (lastNpc && normalizeTranscript(lastNpc.text) === normalizeTranscript(clean)) return current;
      return [...current, { role: 'npc', text: clean }];
    });
  }, []);

  const sendTypedMessage = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || busy || finished || voiceLive) return;
    setBusy(true);
    setInput('');
    const priorHistory = history;
    setHistory((current) => [...current, { role: 'player', text: clean }]);

    try {
      const response = await fetch('/api/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId: mission.id, message: clean, history: priorHistory, goalCompleted: sceneResolved }),
      });
      if (!response.ok) throw new Error(`dialogue ${response.status}`);
      const result = await response.json() as DialogueResult;
      setHistory((current) => [...current, { role: 'npc', text: result.reply }]);
      if (result.goalCompleted) resolveScene();
      void speakFallback(result.reply);
    } catch {
      const reply = mission.retryResponse;
      setHistory((current) => [...current, { role: 'npc', text: reply }]);
      void speakFallback(reply);
    } finally {
      setBusy(false);
    }
  }, [busy, finished, history, mission, resolveScene, sceneResolved, speakFallback, voiceLive]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void sendTypedMessage(input);
  }

  function leaveScene() {
    if (!sceneResolved || finished) return;
    setSave((current) => {
      const learned = current.learned.includes(mission.learnedPhrase) ? current.learned : [...current.learned, mission.learnedPhrase];
      const resources = { ...current.resources };
      for (const [key, delta] of Object.entries(mission.resources)) {
        const typedKey = key as keyof Resources;
        resources[typedKey] = clampResource(resources[typedKey] + Number(delta));
      }
      return {
        missionIndex: current.missionIndex + 1,
        xp: current.xp + mission.xp,
        resources,
        learned,
        completed: current.completed.includes(mission.id) ? current.completed : [...current.completed, mission.id],
      };
    });
  }

  function restart() {
    localStorage.removeItem(SAVE_KEY);
    setSave(initialState);
    setHistory([]);
    setSceneResolved(false);
    setSceneSignal('');
  }

  if (!hydrated) return <main className="loading-screen">Loading Ember Camp…</main>;

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand">
          <Image src="/assets/ui/logo.svg" alt="" width={48} height={48} />
          <div><strong>EMBER CAMP</strong><small>Live the story in English.</small></div>
        </div>
        <div className="resources" aria-label="Camp resources">
          <span>🪵 <b>{save.resources.wood}</b></span><span>🥫 <b>{save.resources.food}</b></span><span>💧 <b>{save.resources.water}</b></span><span>🔥 <b>{save.resources.warmth}</b></span><span>⭐ <b>{save.xp}</b></span>
        </div>
      </header>

      <div className="game-layout">
        <section className="map-panel">
          <div className="map-head"><span>DAY {day}</span><span>{Math.min(save.missionIndex, missions.length)}/{missions.length} SCENES</span></div>
          <div className="cefr-strip">{levelStats.map(({ level, complete }, index) => <span key={level} className={`${complete ? 'done' : ''} ${!finished && index === levelIndex ? 'current' : ''}`}>{level}</span>)}</div>
          <WorldMap mission={mission} completedMissionIds={save.completed} allMissions={missions} />
          <div className="campaign-progress"><span style={{ width: `${progress}%` }} /></div>
          <p className="map-caption">No answer path. Listen, talk, react, and let the world respond.</p>
        </section>

        <aside className="side-panel">
          {!finished ? (
            <section className="conversation-card immersive-card">
              <div className="mission-meta"><span>SCENE {save.missionIndex + 1} · DAY {day}</span><b>{mission.level}</b></div>
              <h1>{mission.title}</h1>
              <p className="location-label">📍 {mission.location}</p>
              <div className="scene-note">{mission.scene}</div>

              <RealtimeVoice
                mission={mission}
                onSceneResolved={resolveScene}
                onNpcTranscript={addNpcTranscript}
                onLiveChange={setVoiceLive}
              />

              {sceneSignal && <div className="world-event" aria-live="polite"><span>🌿</span><p>{sceneSignal}</p></div>}

              {!voiceLive && (
                <details className="text-fallback">
                  <summary>Prefer typing for this moment?</summary>
                  <form className="composer" onSubmit={onSubmit}>
                    <input value={input} onChange={(event) => setInput(event.target.value)} disabled={busy} placeholder={`Say something to ${mission.characterName}…`} aria-label="Your message" autoComplete="off" />
                    <button type="submit" disabled={busy || !input.trim()}>{busy ? '…' : '➜'}</button>
                  </form>
                </details>
              )}

              <details className="transcript-details">
                <summary>Conversation transcript</summary>
                <div className="chat transcript-chat">
                  {history.map((message, index) => (
                    <div className={`message-row ${message.role}`} key={`${message.role}-${index}`}>
                      {message.role === 'npc' && <Image className="portrait" src={mission.portrait} alt={mission.characterName} width={40} height={40} />}
                      <div className="bubble"><span>{message.text}</span>{message.role === 'npc' && !voiceLive && <button className="speaker" type="button" onClick={() => void speakFallback(message.text)} aria-label={`Listen to ${mission.characterName}`}>🔊</button>}</div>
                    </div>
                  ))}
                </div>
              </details>

              <div className="conversation-tools immersive-tools">
                <button type="button" onClick={() => setHintVisible((value) => !value)}>👀 {hintVisible ? 'Hide context' : 'Notice the scene'}</button>
                {sceneResolved && <button className="continue" type="button" onClick={leaveScene}>Leave scene →</button>}
              </div>
              {hintVisible && <div className="hint-box">{mission.contextClue}</div>}
            </section>
          ) : (
            <section className="conversation-card finale">
              <div className="trophy">🏆</div><h1>C2 Survivor</h1>
              <p>You reached C2 by living through conversations — not by selecting answers. The world now expects you to handle implication, humor, disagreement, ambiguity and subtext in real time.</p>
              <button className="continue" type="button" onClick={restart}>Start a new journey</button>
            </section>
          )}

          <section className="journal-card">
            <div className="journal-head"><h2>📓 Things that became familiar</h2><span>{save.learned.length} patterns</span></div>
            <div className="phrase-list">{save.learned.length ? save.learned.slice(-9).map((phrase) => <span key={phrase}>{phrase}</span>) : <p>Useful language will accumulate here after you leave scenes.</p>}</div>
          </section>
        </aside>
      </div>
    </main>
  );
}
