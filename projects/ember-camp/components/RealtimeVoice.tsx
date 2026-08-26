'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import type { Mission } from '@/lib/types';

type Phase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

type Props = {
  mission: Mission;
  onSceneResolved: (reason: string) => void;
  onNpcTranscript: (text: string) => void;
  onLiveChange?: (live: boolean) => void;
};

type Capability = {
  available: boolean;
  model: string;
  transport: string;
};

function phaseLabel(phase: Phase, name: string) {
  if (phase === 'connecting') return 'Connecting…';
  if (phase === 'listening') return 'Listening — speak naturally';
  if (phase === 'thinking') return `${name} is thinking…`;
  if (phase === 'speaking') return `${name} is talking — you can interrupt`;
  if (phase === 'error') return 'Voice connection ended';
  return 'Ready for a real conversation';
}

export default function RealtimeVoice({ mission, onSceneResolved, onNpcTranscript, onLiveChange }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [capability, setCapability] = useState<Capability | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resolvedRef = useRef(false);
  const startedRef = useRef(false);

  const sendEvent = useCallback((event: unknown) => {
    const dc = dcRef.current;
    if (dc?.readyState === 'open') dc.send(JSON.stringify(event));
  }, []);

  const stop = useCallback(() => {
    startedRef.current = false;
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    setMuted(false);
    setPhase('idle');
    onLiveChange?.(false);
  }, [onLiveChange]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/realtime', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not check advanced voice.');
        return response.json() as Promise<Capability>;
      })
      .then((value) => { if (!cancelled) setCapability(value); })
      .catch(() => { if (!cancelled) setCapability({ available: false, model: 'gpt-realtime-2.1', transport: 'webrtc' }); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    resolvedRef.current = false;
    stop();
  }, [mission.id, stop]);

  useEffect(() => () => stop(), [stop]);

  const handleRealtimeEvent = useCallback((raw: MessageEvent<string>) => {
    let event: any;
    try { event = JSON.parse(raw.data); } catch { return; }

    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        setPhase('listening');
        break;
      case 'input_audio_buffer.speech_stopped':
      case 'response.created':
        setPhase('thinking');
        break;
      case 'response.output_audio.delta':
      case 'response.audio.delta':
      case 'response.output_audio_transcript.delta':
        setPhase('speaking');
        break;
      case 'response.done': {
        const output = Array.isArray(event.response?.output) ? event.response.output : [];
        for (const item of output) {
          if (item?.type === 'message' && Array.isArray(item.content)) {
            const transcript = item.content
              .map((content: any) => typeof content?.transcript === 'string' ? content.transcript : typeof content?.text === 'string' ? content.text : '')
              .filter(Boolean)
              .join(' ')
              .trim();
            if (transcript) onNpcTranscript(transcript);
          }

          if (item?.type === 'function_call' && item.name === 'complete_scene') {
            let reason = 'The situation can naturally move forward.';
            try {
              const args = JSON.parse(item.arguments || '{}');
              if (typeof args.reason === 'string' && args.reason.trim()) reason = args.reason.trim();
            } catch {}

            if (!resolvedRef.current) {
              resolvedRef.current = true;
              onSceneResolved(reason);
            }
            sendEvent({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: item.call_id,
                output: JSON.stringify({ ok: true, sceneResolved: true }),
              },
            });
            sendEvent({
              type: 'response.create',
              response: {
                instructions: 'Continue the conversation naturally in character. The situation is resolved, but do not mention an objective, score, tool, lesson, or completion. The learner may keep talking as long as they want.',
              },
            });
          }

          if (item?.type === 'function_call' && item.name === 'wait_for_user') {
            sendEvent({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: item.call_id,
                output: JSON.stringify({ ok: true, action: 'wait' }),
              },
            });
          }
        }
        if (!event.response?.status || event.response.status === 'completed') setPhase('listening');
        break;
      }
      case 'error':
        console.error('[realtime-client]', event.error || event);
        setError(event.error?.message || 'The realtime voice session hit an error.');
        setPhase('error');
        break;
      default:
        break;
    }
  }, [onNpcTranscript, onSceneResolved, sendEvent]);

  const start = useCallback(async () => {
    if (startedRef.current) return;
    setError('');
    setPhase('connecting');

    try {
      if (!capability?.available) throw new Error('Advanced voice needs OpenAI Realtime to be enabled on the server.');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot access a microphone.');

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      startedRef.current = true;

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setPhase('listening');
          onLiveChange?.(true);
        }
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState) && startedRef.current) {
          setError('The voice connection was interrupted.');
          setPhase('error');
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (audioRef.current && stream) {
          audioRef.current.srcObject = stream;
          audioRef.current.play().catch(() => {});
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
      localStreamRef.current = stream;
      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.addEventListener('message', handleRealtimeEvent);
      dc.addEventListener('open', () => {
        sendEvent({
          type: 'response.create',
          response: {
            instructions: `Begin the scene now as ${mission.characterName}. Speak first, naturally and in character. Do not explain the game or say you are beginning.`,
          },
        });
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!offer.sdp) throw new Error('Could not create a WebRTC offer.');

      const response = await fetch(`/api/realtime?missionId=${encodeURIComponent(mission.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || `Advanced voice could not start (${response.status}).`);
      }

      const answerSdp = await response.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Advanced voice could not start.';
      setError(message);
      startedRef.current = false;
      dcRef.current?.close();
      dcRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setPhase('error');
      onLiveChange?.(false);
    }
  }, [capability?.available, handleRealtimeEvent, mission.characterName, mission.id, onLiveChange, sendEvent]);

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    const nextMuted = !muted;
    track.enabled = !nextMuted;
    setMuted(nextMuted);
    setPhase(nextMuted ? 'idle' : 'listening');
  }

  const live = ['listening', 'thinking', 'speaking'].includes(phase);

  return (
    <div className="voice-stage">
      <audio ref={audioRef} autoPlay playsInline className="remote-audio" />
      <div className={`voice-orb ${phase}`} aria-hidden="true">
        <span className="voice-ring ring-one" />
        <span className="voice-ring ring-two" />
        <Image src={mission.portrait} alt="" width={92} height={92} priority />
      </div>
      <div className="voice-copy">
        <div className="live-line">
          <span className={`live-dot ${live ? 'on' : ''}`} />
          <strong>{phaseLabel(phase, mission.characterName)}</strong>
        </div>
        <p>{live ? `Just talk to ${mission.characterName}. There are no answer buttons and you can interrupt at any time.` : 'One conversation. Your voice, their voice, no scripted answer path.'}</p>
      </div>

      <div className="voice-controls">
        {!live && phase !== 'connecting' ? (
          <button type="button" className="voice-primary" onClick={() => void start()} disabled={capability === null}>
            <span>🎙️</span> {capability === null ? 'Checking voice…' : `Talk with ${mission.characterName}`}
          </button>
        ) : (
          <>
            <button type="button" className={`voice-control ${muted ? 'active' : ''}`} onClick={toggleMute}>
              {muted ? '🔇 Unmute' : '🎙️ Mute'}
            </button>
            <button type="button" className="voice-control danger" onClick={stop}>End conversation</button>
          </>
        )}
      </div>

      {capability && !capability.available && (
        <p className="voice-config-note">Advanced voice is built in, but this deployment still needs <code>OPENAI_API_KEY</code> to create Realtime WebRTC sessions.</p>
      )}
      {error && <p className="voice-error" role="alert">{error}</p>}
    </div>
  );
}
