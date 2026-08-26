
'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import WorldMap from '@/components/WorldMap';
import { cefrLevels } from '@/data/cefr';
import { missions } from '@/data/missions';
import type { DialogueMessage, DialogueResult, Mission } from '@/lib/types';

type Resources = { wood: number; food: number; water: number; warmth: number };
type SaveState = { missionIndex: number; xp: number; resources: Resources; learned: string[]; completed: string[] };
const initialState: SaveState = { missionIndex: 0, xp: 0, resources: { wood: 1, food: 2, water: 2, warmth: 55 }, learned: [], completed: [] };
const SAVE_KEY = 'ember-camp-save-v1';

function clampResource(value: number) { return Math.max(0, Math.min(999, value)); }

export default function GameClient() {
  const [save, setSave] = useState<SaveState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [history, setHistory] = useState<DialogueMessage[]>([]);
  const [input, setInput] = useState('');
  const [goalCompleted, setGoalCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [hintVisible, setHintVisible] = useState(false);
  const [audioStatus, setAudioStatus] = useState('Tap any speaker to hear natural English.');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);

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
      setGoalCompleted(false);
      setFeedback('');
      setHintVisible(false);
    }
  }, [mission.id, finished]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [history]);

  const day = Math.floor(Math.min(save.missionIndex, missions.length - 1) / 3) + 1;
  const progress = Math.round((Math.min(save.missionIndex, missions.length) / missions.length) * 100);

  const browserSpeak = useCallback((text: string, currentMission: Mission) => {
    if (!('speechSynthesis' in window)) { setAudioStatus('No speech engine is available in this browser.'); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices().filter((v) => /^en(-|_)/i.test(v.lang));
    const preferred = voices.find((v) => /natural|neural|premium|enhanced|google us english|samantha|ava|daniel/i.test(v.name)) ?? voices[0];
    if (preferred) utterance.voice = preferred;
    utterance.lang = preferred?.lang || 'en-US';
    utterance.rate = [0.82, 0.88, 0.94, 1, 1.03, 1.06][cefrLevels.indexOf(currentMission.level)];
    utterance.pitch = 1;
    utterance.onstart = () => setAudioStatus(`Device voice${preferred ? `: ${preferred.name}` : ''}`);
    utterance.onerror = () => setAudioStatus('The device voice could not play.');
    window.speechSynthesis.speak(utterance);
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text) return;
    setAudioStatus('Preparing voice…');
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, characterId: mission.characterId, speed: [0.88,0.92,0.96,1,1.02,1.04][levelIndex] }),
      });
      if (!response.ok || !response.headers.get('content-type')?.includes('audio/')) throw new Error('neural unavailable');
      const blob = await response.blob();
      if (audioRef.current) { audioRef.current.pause(); URL.revokeObjectURL(audioRef.current.src); }
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      audio.onplay = () => setAudioStatus(`Neural voice · ${response.headers.get('x-ember-voice') || 'natural voice'}`);
      audio.onerror = () => browserSpeak(text, mission);
      await audio.play();
    } catch {
      browserSpeak(text, mission);
    }
  }, [browserSpeak, levelIndex, mission]);

  const sendMessage = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || busy || finished) return;
    setBusy(true); setFeedback(''); setInput('');
    const priorHistory = history;
    setHistory((h) => [...h, { role: 'player', text: clean }]);
    try {
      const response = await fetch('/api/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId: mission.id, message: clean, history: priorHistory, goalCompleted }),
      });
      if (!response.ok) throw new Error(`dialogue ${response.status}`);
      const result = await response.json() as DialogueResult;
      setHistory((h) => [...h, { role: 'npc', text: result.reply }]);
      setGoalCompleted((done) => done || result.goalCompleted);
      setFeedback(result.goalCompleted ? `✓ ${result.source === 'ai' ? 'Natural AI conversation' : 'Understood'} — objective complete.` : result.understood ? 'They understood you. Keep the conversation going.' : 'They need you to say it another way.');
      void speak(result.reply);
    } catch {
      setHistory((h) => [...h, { role: 'npc', text: mission.retryResponse }]);
      setFeedback('Connection issue. The local conversation fallback kept the mission active.');
    } finally { setBusy(false); }
  }, [busy, finished, goalCompleted, history, mission, speak]);

  function onSubmit(event: FormEvent) { event.preventDefault(); void sendMessage(input); }

  function continueMission() {
    if (!goalCompleted || finished) return;
    setSave((current) => {
      const learned = current.learned.includes(mission.learnedPhrase) ? current.learned : [...current.learned, mission.learnedPhrase];
      const resources = { ...current.resources };
      for (const [key, delta] of Object.entries(mission.resources)) {
        const k = key as keyof Resources; resources[k] = clampResource(resources[k] + Number(delta));
      }
      return {
        missionIndex: current.missionIndex + 1,
        xp: current.xp + mission.xp,
        resources, learned,
        completed: current.completed.includes(mission.id) ? current.completed : [...current.completed, mission.id],
      };
    });
  }

  function restart() {
    localStorage.removeItem(SAVE_KEY); setSave(initialState); setHistory([]); setGoalCompleted(false); setFeedback('');
  }

  const levelStats = useMemo(() => cefrLevels.map((level) => ({ level, complete: missions.filter((m) => m.level === level).every((m) => save.completed.includes(m.id)) })), [save.completed]);

  if (!hydrated) return <main className="loading-screen">Loading Ember Camp…</main>;

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand"><Image src="/assets/ui/logo.svg" alt="" width={48} height={48} /><div><strong>EMBER CAMP</strong><small>Survive by understanding people.</small></div></div>
        <div className="resources" aria-label="Camp resources">
          <span>🪵 <b>{save.resources.wood}</b></span><span>🥫 <b>{save.resources.food}</b></span><span>💧 <b>{save.resources.water}</b></span><span>🔥 <b>{save.resources.warmth}</b></span><span>⭐ <b>{save.xp}</b></span>
        </div>
      </header>

      <div className="game-layout">
        <section className="map-panel">
          <div className="map-head"><span>DAY {day}</span><span>{Math.min(save.missionIndex, missions.length)}/{missions.length} CONVERSATIONS</span></div>
          <div className="cefr-strip">{levelStats.map(({ level, complete }, index) => <span key={level} className={`${complete ? 'done' : ''} ${!finished && index === levelIndex ? 'current' : ''}`}>{level}</span>)}</div>
          <WorldMap mission={mission} completedMissionIds={save.completed} allMissions={missions} />
          <div className="campaign-progress"><span style={{ width: `${progress}%` }} /></div>
          <p className="map-caption">English opens the world: listen → infer → respond → see what happens.</p>
        </section>

        <aside className="side-panel">
          {!finished ? (
            <section className="conversation-card">
              <div className="mission-meta"><span>CONVERSATION {save.missionIndex + 1} OF {missions.length}</span><b>{mission.level}</b></div>
              <h1>{mission.title}</h1>
              <p className="location-label">📍 {mission.location}</p>
              <div className="scene-note">{mission.scene}</div>
              <div className="chat" ref={chatRef}>
                {history.map((message, index) => (
                  <div className={`message-row ${message.role}`} key={`${message.role}-${index}`}>
                    {message.role === 'npc' && <Image className="portrait" src={mission.portrait} alt={mission.characterName} width={44} height={44} />}
                    <div className="bubble"><span>{message.text}</span>{message.role === 'npc' && <button className="speaker" type="button" onClick={() => void speak(message.text)} aria-label={`Listen to ${mission.characterName}`}>🔊</button>}</div>
                  </div>
                ))}
              </div>

              <div className="quick-replies" aria-label="Natural reply ideas">
                {mission.quickReplies.map((reply) => <button type="button" key={reply.text} onClick={() => void sendMessage(reply.text)} disabled={busy}>{reply.text}</button>)}
              </div>
              <form className="composer" onSubmit={onSubmit}>
                <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} placeholder="Say it your way in English…" aria-label="Your reply" />
                <button type="submit" disabled={busy || !input.trim()}>{busy ? '…' : '➜'}</button>
              </form>
              {feedback && <div className="feedback" aria-live="polite">{feedback}</div>}
              {hintVisible && <div className="hint-box">👀 {mission.contextClue}</div>}
              <div className="conversation-tools">
                <button type="button" onClick={() => void speak(history.filter((m) => m.role === 'npc').at(-1)?.text || mission.opening)}>🔊 Hear again</button>
                <button type="button" onClick={() => setHintVisible((v) => !v)}>🧠 Context clue</button>
                {goalCompleted && <button className="continue" type="button" onClick={continueMission}>Continue →</button>}
              </div>
              <p className="audio-status">{audioStatus}</p>
            </section>
          ) : (
            <section className="conversation-card finale"><div className="trophy">🏆</div><h1>C2 Survivor</h1><p>You made it from concrete A1 survival talk to C2 subtext, diplomacy, understatement and emotional implication.</p><button className="continue" type="button" onClick={restart}>Start again</button></section>
          )}

          <section className="journal-card">
            <div className="journal-head"><h2>📓 Survival English</h2><span>{save.learned.length} phrases</span></div>
            <div className="phrase-list">{save.learned.length ? save.learned.slice(-9).map((phrase) => <span key={phrase}>{phrase}</span>) : <p>Useful conversational patterns appear here as you survive.</p>}</div>
          </section>
        </aside>
      </div>
    </main>
  );
}
