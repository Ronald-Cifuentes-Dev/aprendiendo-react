'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { buildRealtimeInstructions } from '@/lib/realtimePrompt';
import type { Mission } from '@/lib/types';

type Phase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';
type Provider = 'gemini' | 'openai' | 'none';

type Props = {
  mission: Mission;
  onSceneResolved: (reason: string) => void;
  onNpcTranscript: (text: string) => void;
  onLiveChange?: (live: boolean) => void;
};

type ProviderCapability = {
  available: boolean;
  model: string;
  transport: string;
  freeTierCapable?: boolean;
};

type Capability = {
  provider: Provider;
  gemini: ProviderCapability;
  openai: ProviderCapability;
};

const geminiVoices: Record<string, string> = {
  maya: 'Sulafat',
  nora: 'Kore',
  elena: 'Gacrux',
  ben: 'Achird',
  leo: 'Puck',
  marcus: 'Umbriel',
  adrian: 'Charon',
};

function phaseLabel(phase: Phase, name: string, muted: boolean, provider: Provider) {
  if (phase === 'connecting') return provider === 'gemini' ? 'Connecting to free Live voice…' : 'Connecting…';
  if (muted && ['listening', 'thinking', 'speaking'].includes(phase)) return 'Microphone muted';
  if (phase === 'listening') return 'Listening — speak naturally';
  if (phase === 'thinking') return `${name} is thinking…`;
  if (phase === 'speaking') return `${name} is talking — you can interrupt`;
  if (phase === 'error') return 'Voice connection ended';
  return 'Ready for a real conversation';
}

function floatTo16BitPCMBase64(input: Float32Array) {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function downsample(input: Float32Array, inputRate: number, outputRate = 16000) {
  if (inputRate === outputRate) return input.slice();
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  let inputOffset = 0;
  for (let i = 0; i < outputLength; i++) {
    const nextOffset = Math.min(input.length, Math.round((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (; inputOffset < nextOffset; inputOffset++) {
      sum += input[inputOffset];
      count++;
    }
    output[i] = count ? sum / count : 0;
  }
  return output;
}

function decodePcm16Base64(value: string) {
  const binary = atob(value);
  const length = Math.floor(binary.length / 2);
  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const lo = binary.charCodeAt(i * 2);
    const hi = binary.charCodeAt(i * 2 + 1);
    let sample = (hi << 8) | lo;
    if (sample >= 0x8000) sample -= 0x10000;
    result[i] = sample / 0x8000;
  }
  return result;
}

export default function RealtimeVoice({ mission, onSceneResolved, onNpcTranscript, onLiveChange }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [capability, setCapability] = useState<Capability | null>(null);
  const [activeProvider, setActiveProvider] = useState<Provider>('none');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const geminiSocketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const geminiReadyRef = useRef(false);
  const nextPlaybackTimeRef = useRef(0);
  const playbackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const geminiTranscriptRef = useRef('');

  const localStreamRef = useRef<MediaStream | null>(null);
  const resolvedRef = useRef(false);
  const startedRef = useRef(false);

  const sendOpenAIEvent = useCallback((event: unknown) => {
    const dc = dcRef.current;
    if (dc?.readyState === 'open') dc.send(JSON.stringify(event));
  }, []);

  const clearGeminiPlayback = useCallback(() => {
    for (const source of playbackSourcesRef.current) {
      try { source.stop(); } catch {}
    }
    playbackSourcesRef.current.clear();
    nextPlaybackTimeRef.current = audioContextRef.current?.currentTime ?? 0;
  }, []);

  const closeTransport = useCallback(() => {
    startedRef.current = false;
    geminiReadyRef.current = false;

    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;

    geminiSocketRef.current?.close();
    geminiSocketRef.current = null;
    clearGeminiPlayback();

    micProcessorRef.current?.disconnect();
    micProcessorRef.current = null;
    micSourceRef.current?.disconnect();
    micSourceRef.current = null;
    silentGainRef.current?.disconnect();
    silentGainRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
    }

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});

    setActiveProvider('none');
    onLiveChange?.(false);
  }, [clearGeminiPlayback, onLiveChange]);

  const stop = useCallback(() => {
    closeTransport();
    setMuted(false);
    setError('');
    setPhase('idle');
  }, [closeTransport]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/gemini-token', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/realtime', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]).then(([gemini, openai]) => {
      if (cancelled) return;
      const value: Capability = {
        provider: gemini?.available ? 'gemini' : openai?.available ? 'openai' : 'none',
        gemini: {
          available: Boolean(gemini?.available),
          model: gemini?.model || 'gemini-3.1-flash-live-preview',
          transport: 'websocket',
          freeTierCapable: true,
        },
        openai: {
          available: Boolean(openai?.available),
          model: openai?.model || 'gpt-realtime-2.1',
          transport: 'webrtc',
        },
      };
      setCapability(value);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    resolvedRef.current = false;
    geminiTranscriptRef.current = '';
    stop();
  }, [mission.id, stop]);

  useEffect(() => () => closeTransport(), [closeTransport]);

  const playGeminiChunk = useCallback((base64: string) => {
    const context = audioContextRef.current;
    if (!context) return;
    const samples = decodePcm16Base64(base64);
    if (!samples.length) return;

    const buffer = context.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    playbackSourcesRef.current.add(source);
    source.onended = () => playbackSourcesRef.current.delete(source);

    const now = context.currentTime;
    const startAt = Math.max(now + 0.015, nextPlaybackTimeRef.current || now);
    source.start(startAt);
    nextPlaybackTimeRef.current = startAt + buffer.duration;
    setPhase('speaking');
  }, []);

  const handleGeminiMessage = useCallback((event: MessageEvent<string>) => {
    let message: any;
    try { message = JSON.parse(event.data); } catch { return; }

    if (message.setupComplete) {
      geminiReadyRef.current = true;
      setPhase('thinking');
      const socket = geminiSocketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          realtimeInput: {
            text: `Begin the scene now as ${mission.characterName}. Speak first naturally and in character. Do not explain the game or mention that a session started.`,
          },
        }));
      }
      return;
    }

    const content = message.serverContent;
    if (content) {
      if (content.interrupted) {
        clearGeminiPlayback();
        geminiTranscriptRef.current = '';
        setPhase('listening');
      }

      if (content.outputTranscription?.text) {
        geminiTranscriptRef.current += content.outputTranscription.text;
      }

      if (Array.isArray(content.modelTurn?.parts)) {
        for (const part of content.modelTurn.parts) {
          if (part?.inlineData?.data) playGeminiChunk(part.inlineData.data);
        }
      }

      if (content.turnComplete) {
        const transcript = geminiTranscriptRef.current.trim();
        if (transcript) onNpcTranscript(transcript);
        geminiTranscriptRef.current = '';
        setPhase('listening');
      } else if (!content.modelTurn?.parts?.length && !content.interrupted) {
        setPhase('thinking');
      }
    }

    if (message.toolCall?.functionCalls) {
      const responses = [];
      for (const call of message.toolCall.functionCalls as any[]) {
        if (call.name === 'complete_scene') {
          const reason = typeof call.args?.reason === 'string' && call.args.reason.trim()
            ? call.args.reason.trim()
            : 'The situation can naturally move forward.';
          if (!resolvedRef.current) {
            resolvedRef.current = true;
            onSceneResolved(reason);
          }
          responses.push({ name: call.name, id: call.id, response: { result: { ok: true, sceneResolved: true } } });
        } else if (call.name === 'wait_for_user') {
          responses.push({ name: call.name, id: call.id, response: { result: { ok: true, action: 'wait' } } });
        } else {
          responses.push({ name: call.name, id: call.id, response: { result: { ok: false, error: 'Unknown tool' } } });
        }
      }
      const socket = geminiSocketRef.current;
      if (responses.length && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
      }
    }
  }, [clearGeminiPlayback, mission.characterName, onNpcTranscript, onSceneResolved, playGeminiChunk]);

  const handleOpenAIEvent = useCallback((raw: MessageEvent<string>) => {
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
              .map((part: any) => typeof part?.transcript === 'string' ? part.transcript : typeof part?.text === 'string' ? part.text : '')
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
            sendOpenAIEvent({
              type: 'conversation.item.create',
              item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ ok: true, sceneResolved: true }) },
            });
            sendOpenAIEvent({
              type: 'response.create',
              response: { instructions: 'Continue naturally in character. The situation is resolved, but never mention an objective, score, tool, lesson, or completion.' },
            });
          }

          if (item?.type === 'function_call' && item.name === 'wait_for_user') {
            sendOpenAIEvent({
              type: 'conversation.item.create',
              item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ ok: true, action: 'wait' }) },
            });
          }
        }
        if (!event.response?.status || event.response.status === 'completed') setPhase('listening');
        break;
      }
      case 'error':
        console.error('[openai-realtime-client]', event.error || event);
        closeTransport();
        setMuted(false);
        setError(event.error?.message || 'The realtime voice session hit an error.');
        setPhase('error');
        break;
      default:
        break;
    }
  }, [closeTransport, onNpcTranscript, onSceneResolved, sendOpenAIEvent]);

  const startGemini = useCallback(async () => {
    setActiveProvider('gemini');
    const tokenResponse = await fetch('/api/gemini-token', { method: 'POST' });
    if (!tokenResponse.ok) {
      const detail = await tokenResponse.json().catch(() => ({}));
      throw new Error(detail.error || `Gemini Live could not start (${tokenResponse.status}).`);
    }
    const tokenData = await tokenResponse.json() as { token: string; model: string };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
    localStreamRef.current = stream;

    const context = new AudioContext();
    audioContextRef.current = context;
    await context.resume();
    nextPlaybackTimeRef.current = context.currentTime;

    const source = context.createMediaStreamSource(stream);
    micSourceRef.current = source;
    const processor = context.createScriptProcessor(4096, 1, 1);
    micProcessorRef.current = processor;
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    silentGainRef.current = silentGain;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);

    const endpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(tokenData.token)}`;
    const socket = new WebSocket(endpoint);
    geminiSocketRef.current = socket;
    startedRef.current = true;

    processor.onaudioprocess = (audioEvent) => {
      if (!geminiReadyRef.current || socket.readyState !== WebSocket.OPEN) return;
      const channel = audioEvent.inputBuffer.getChannelData(0);
      const samples = downsample(channel, context.sampleRate, 16000);
      socket.send(JSON.stringify({
        realtimeInput: {
          audio: { data: floatTo16BitPCMBase64(samples), mimeType: 'audio/pcm;rate=16000' },
        },
      }));
    };

    socket.onopen = () => {
      const instructions = buildRealtimeInstructions(mission);
      socket.send(JSON.stringify({
        setup: {
          model: `models/${tokenData.model}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: geminiVoices[mission.characterId] || 'Achird' },
              },
            },
          },
          systemInstruction: { parts: [{ text: instructions }] },
          tools: [{
            functionDeclarations: [
              {
                name: 'complete_scene',
                description: 'Silently mark the current story situation as resolved enough to allow the world to progress. Do not call this just because a keyword appeared.',
                parameters: {
                  type: 'OBJECT',
                  properties: { reason: { type: 'STRING', description: 'A short internal reason describing why the situation can now progress.' } },
                  required: ['reason'],
                },
              },
              {
                name: 'wait_for_user',
                description: 'Use when there is only silence, background noise, or no meaningful utterance and the natural action is to wait rather than fill the silence.',
                parameters: { type: 'OBJECT', properties: {} },
              },
            ],
          }],
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
              prefixPaddingMs: 80,
              silenceDurationMs: 500,
            },
            activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          sessionResumption: {},
          contextWindowCompression: { slidingWindow: {} },
        },
      }));
    };

    socket.onmessage = handleGeminiMessage;
    socket.onerror = () => {
      if (!startedRef.current) return;
      closeTransport();
      setMuted(false);
      setError('Gemini Live voice hit a connection error.');
      setPhase('error');
    };
    socket.onclose = (event) => {
      if (!startedRef.current) return;
      closeTransport();
      setMuted(false);
      setError(event.reason || 'Gemini Live voice connection closed.');
      setPhase('error');
    };

    onLiveChange?.(true);
  }, [closeTransport, handleGeminiMessage, mission, onLiveChange]);

  const startOpenAI = useCallback(async () => {
    setActiveProvider('openai');
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    startedRef.current = true;

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setPhase('listening');
        onLiveChange?.(true);
      }
      if (['failed', 'disconnected'].includes(pc.connectionState) && startedRef.current) {
        closeTransport();
        setMuted(false);
        setError('The voice connection was interrupted.');
        setPhase('error');
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (remoteAudioRef.current && stream) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch(() => {});
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
    localStreamRef.current = stream;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

    const dc = pc.createDataChannel('oai-events');
    dcRef.current = dc;
    dc.addEventListener('message', handleOpenAIEvent);
    dc.addEventListener('open', () => {
      sendOpenAIEvent({
        type: 'response.create',
        response: { instructions: `Begin the scene now as ${mission.characterName}. Speak first, naturally and in character.` },
      });
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (!offer.sdp) throw new Error('Could not create a WebRTC offer.');

    const response = await fetch(`/api/realtime?missionId=${encodeURIComponent(mission.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || `OpenAI Realtime could not start (${response.status}).`);
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
  }, [closeTransport, handleOpenAIEvent, mission.characterName, mission.id, onLiveChange, sendOpenAIEvent]);

  const start = useCallback(async () => {
    if (startedRef.current) return;
    setError('');
    setPhase('connecting');

    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot access a microphone.');
      if (!capability || capability.provider === 'none') throw new Error('No live voice provider is configured yet.');
      if (capability.provider === 'gemini') await startGemini();
      else await startOpenAI();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Advanced voice could not start.';
      closeTransport();
      setMuted(false);
      setError(message);
      setPhase('error');
    }
  }, [capability, closeTransport, startGemini, startOpenAI]);

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    const nextMuted = !muted;
    track.enabled = !nextMuted;
    setMuted(nextMuted);
  }

  const live = startedRef.current && ['connecting', 'listening', 'thinking', 'speaking'].includes(phase);
  const startDisabled = capability === null || capability.provider === 'none';
  const providerLabel = activeProvider === 'gemini' ? 'Gemini Live · free tier' : activeProvider === 'openai' ? 'OpenAI Realtime' : capability?.provider === 'gemini' ? 'Gemini Live · free tier available' : capability?.provider === 'openai' ? 'OpenAI Realtime available' : 'Voice provider not configured';

  return (
    <div className="voice-stage">
      <audio ref={remoteAudioRef} autoPlay className="remote-audio" />
      <div className={`voice-orb ${phase}`} aria-hidden="true">
        <span className="voice-ring ring-one" />
        <span className="voice-ring ring-two" />
        <Image src={mission.portrait} alt="" width={92} height={92} priority />
      </div>
      <div className="voice-copy">
        <div className="live-line">
          <span className={`live-dot ${live ? 'on' : ''}`} />
          <strong>{phaseLabel(phase, mission.characterName, muted, activeProvider || capability?.provider || 'none')}</strong>
        </div>
        <p>{live ? `Just talk to ${mission.characterName}. You can pause, change direction, or interrupt.` : 'One conversation. Your voice, their voice, no scripted answer path.'}</p>
        <small className="voice-provider">{providerLabel}</small>
      </div>

      <div className="voice-controls">
        {!live ? (
          <button type="button" className="voice-primary" onClick={() => void start()} disabled={startDisabled}>
            <span>🎙️</span>{' '}
            {capability === null ? 'Checking voice…' : capability.provider !== 'none' ? `Talk with ${mission.characterName}` : 'Live voice needs a free key'}
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

      {capability && capability.provider === 'none' && (
        <p className="voice-config-note">For the free live mode, create a Gemini API key in Google AI Studio and add <code>GEMINI_API_KEY</code> in Vercel. Gemini 3.1 Flash Live has a free tier; OpenAI remains an optional fallback.</p>
      )}
      {error && <p className="voice-error" role="alert">{error}</p>}
    </div>
  );
}
