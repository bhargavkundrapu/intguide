import React, { useState, useRef, useEffect } from 'react';
import { Zap, Play, Pause, RotateCcw, Wifi, WifiOff, Sparkles, Mic, MicOff } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';

export default function MobileView({
  wsConnected,
  sessionId,
  messages = [],
  isPaused,
  displayTranscript = '',
  onAudioChunk,
  onTriggerAnswer,
  onExplainMore,
  onClear,
  onTogglePause,
  onJoinSession
}) {
  const [manualCode, setManualCode] = useState('');
  const [isPhoneMicActive, setIsPhoneMicActive] = useState(false);
  const [micError, setMicError] = useState('');
  const bottomRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.text]);

  // Keep phone screen awake during interview HUD mode
  useEffect(() => {
    let wakeLock = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch (err) {}
    };

    requestWakeLock();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestWakeLock();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      wakeLock?.release().catch(() => {});
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Optional Phone Mic capture
  const togglePhoneMic = async () => {
    if (isPhoneMicActive) {
      // Stop mic
      if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setIsPhoneMicActive(false);
      return;
    }

    setMicError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone not supported on this browser (requires HTTPS).');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false
      });
      streamRef.current = stream;

      const candidateTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        ''
      ];
      const selectedType = candidateTypes.find(t => !t || MediaRecorder.isTypeSupported(t));
      const recorder = selectedType
        ? new MediaRecorder(stream, { mimeType: selectedType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && onAudioChunk) onAudioChunk(e.data);
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;
      setIsPhoneMicActive(true);
    } catch (err) {
      setMicError(err.message || 'Could not access phone microphone.');
      setTimeout(() => setMicError(''), 4000);
    }
  };

  // Get latest question and answer for quick reference
  const latestQuestion = [...messages].reverse().find(m => m.role === 'question');
  const latestAnswer = [...messages].reverse().find(m => m.role === 'answer');

  return (
    <div className="mobile-shell">
      {/* Top Bar */}
      <div className="mobile-topbar">
        <div className="mobile-topbar-logo">
          <div style={{
            width: 28, height: 28, background: 'var(--blue-600)', borderRadius: 7,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white'
          }}>
            <Zap size={14} />
          </div>
          Copilot HUD
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Optional Phone Mic Toggle */}
          <button
            onClick={togglePhoneMic}
            title={isPhoneMicActive ? 'Phone Mic Live' : 'Use Phone Mic'}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: isPhoneMicActive ? '#fef2f2' : '#f1f5f9',
              color: isPhoneMicActive ? '#dc2626' : '#64748b',
              border: isPhoneMicActive ? '1px solid #fecaca' : '1px solid #e2e8f0',
              cursor: 'pointer'
            }}
          >
            {isPhoneMicActive ? <Mic size={12} className="status-dot live" /> : <MicOff size={12} />}
            {isPhoneMicActive ? 'Mic On' : 'Mic'}
          </button>

          {latestAnswer?.ttft > 0 && (
            <span className="ttft-chip" style={{ fontSize: 10, padding: '3px 6px' }}>
              ⚡ {(latestAnswer.ttft / 1000).toFixed(2)}s
            </span>
          )}

          {wsConnected ? (
            <span className="badge badge-green" style={{ fontSize: 10, padding: '3px 7px' }}>
              <Wifi size={10} /> Synced
            </span>
          ) : (
            <span className="badge badge-amber" style={{ fontSize: 10, padding: '3px 7px' }}>
              <WifiOff size={10} /> Connecting
            </span>
          )}
        </div>
      </div>

      {micError && (
        <div style={{ background: '#fef2f2', color: '#dc2626', padding: '6px 12px', fontSize: 12, borderBottom: '1px solid #fecaca', textAlign: 'center' }}>
          {micError}
        </div>
      )}

      {/* Session join (offline) */}
      {!wsConnected && (
        <div style={{ padding: '10px 12px' }}>
          <div className="mobile-card">
            <div className="mobile-card-header">Join Session</div>
            <div className="mobile-card-body">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Session code (e.g. SESSION-1234)"
                  value={manualCode}
                  onChange={e => setManualCode(e.target.value)}
                  style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--gray-300)', borderRadius: 7, fontSize: 13, fontFamily: 'JetBrains Mono, monospace', outline: 'none' }}
                />
                <button className="btn btn-primary" style={{ fontSize: 12 }}
                  onClick={() => { if (manualCode && onJoinSession) onJoinSession(manualCode); }}>
                  Join
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat Messages */}
      <div className="mobile-chat-list">
        {/* Live Speech Indicator Card */}
        {displayTranscript && (
          <div className="mobile-live-transcript-card">
            <div className="mobile-live-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="status-dot live" />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue-600)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Listening To Interviewer
                </span>
              </div>
              <button
                className="mobile-quick-answer-badge"
                onClick={() => onTriggerAnswer(displayTranscript)}
              >
                <Zap size={11} /> Answer Now
              </button>
            </div>
            <div className="mobile-live-body">
              "{displayTranscript}"
            </div>
          </div>
        )}

        {messages.length === 0 && !displayTranscript && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40, textAlign: 'center' }}>
            <Sparkles size={28} style={{ color: 'var(--gray-300)' }} />
            <div style={{ fontSize: 14, color: 'var(--gray-500)', fontWeight: 500 }}>Ready for Live Answers</div>
            <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>
              {isPhoneMicActive ? 'Listening with phone microphone...' : 'Listening on laptop tab or mic...'}
            </div>
          </div>
        )}

        {messages.map(msg => {
          if (msg.role === 'question') {
            return (
              <div key={msg.id} className="mobile-chat-question">
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                  Interviewer Question
                </div>
                "{msg.text}"
              </div>
            );
          }

          return (
            <div key={msg.id} className="mobile-chat-answer">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--blue-600)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  AI Copilot
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {msg.status === 'streaming' && (
                    <span className="badge badge-blue" style={{ fontSize: 10 }}>
                      <div className="status-dot live" style={{ marginRight: 2 }} /> Answering
                    </span>
                  )}
                  {msg.status === 'complete' && <span className="badge badge-green" style={{ fontSize: 10 }}>Done</span>}
                  {msg.status === 'interrupted' && <span className="badge badge-amber" style={{ fontSize: 10 }}>Interrupted</span>}
                  {msg.ttft > 0 && <span className="ttft-chip" style={{ fontSize: 9 }}>⚡ {(msg.ttft / 1000).toFixed(2)}s</span>}
                </div>
              </div>

              {msg.status === 'streaming' && !msg.text && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--blue-600)' }}>
                  <div className="spinner" />
                  <span style={{ fontSize: 13 }}>Thinking...</span>
                </div>
              )}

              {msg.text && (
                <div style={{ fontSize: 14, color: 'var(--gray-800)', lineHeight: 1.65 }}>
                  <MarkdownRenderer text={msg.text} isStreaming={msg.status === 'streaming'} />
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Bottom Action Bar */}
      <div className="mobile-bottombar">
        <button
          className="mobile-action-btn primary"
          onClick={() => onTriggerAnswer(displayTranscript || latestQuestion?.text || '')}
        >
          <Zap size={16} />
          Answer
        </button>

        <button className="mobile-action-btn amber" onClick={onExplainMore}>
          <Zap size={16} />
          Explain
        </button>

        <button
          className={`mobile-action-btn ${isPaused ? 'amber' : ''}`}
          onClick={onTogglePause}
        >
          {isPaused ? <Play size={16} /> : <Pause size={16} />}
          {isPaused ? 'Resume' : 'Pause'}
        </button>

        <button className="mobile-action-btn danger" onClick={onClear}>
          <RotateCcw size={16} />
          Clear
        </button>
      </div>
    </div>
  );
}
