import React, { useState, useRef, useEffect } from 'react';
import { Zap, Play, Pause, RotateCcw, Wifi, WifiOff, Sparkles, Mic, MicOff, Edit2, AlertTriangle } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';

function MobileQuestionCard({ msg, onEditQuestion }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(msg.text);

  const handleSave = () => {
    if (draft.trim() && draft.trim() !== msg.text && onEditQuestion) {
      onEditQuestion(msg.id, draft.trim());
    }
    setIsEditing(false);
  };

  return (
    <div className="mobile-chat-question">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Interviewer Question
          </span>
          {msg.isEdited && (
            <span className="badge badge-amber" style={{ fontSize: 9, padding: '1px 4px' }}>
              Edited
            </span>
          )}
        </div>
        {onEditQuestion && (
          <button
            onClick={() => {
              setDraft(msg.text);
              setIsEditing(!isEditing);
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--gray-400)',
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              cursor: 'pointer',
              padding: '2px 4px'
            }}
          >
            <Edit2 size={11} /> {isEditing ? 'Cancel' : 'Edit'}
          </button>
        )}
      </div>

      {isEditing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={2}
            style={{
              width: '100%',
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--gray-300)',
              fontSize: 13,
              fontFamily: 'inherit'
            }}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              onClick={() => {
                setDraft(msg.text);
                setIsEditing(false);
              }}
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="btn btn-primary"
              style={{ fontSize: 11, padding: '3px 10px' }}
            >
              <Zap size={11} /> Update & Answer
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--gray-800)' }}>
            "{msg.text}"
          </div>

          {msg.rawText && msg.rawText !== msg.text && (
            <div style={{ fontSize: 10, color: 'var(--gray-400)', fontStyle: 'italic', marginTop: 3 }}>
              Raw: "{msg.rawText}"
            </div>
          )}

          {msg.uncertainWords?.length > 0 && !msg.isEdited && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#fffbeb',
              border: '1px solid #fef3c7',
              borderRadius: 6,
              padding: '3px 6px',
              marginTop: 6
            }}>
              <AlertTriangle size={11} style={{ color: '#d97706', flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: '#92400e', flex: 1 }}>
                Uncertain: {msg.uncertainWords.map(w => `"${w.word}" (${Math.round(w.confidence * 100)}%)`).join(', ')}
              </span>
              <button
                onClick={() => {
                  setDraft(msg.text);
                  setIsEditing(true);
                }}
                style={{
                  background: '#fff',
                  border: '1px solid #fde68a',
                  borderRadius: 4,
                  fontSize: 10,
                  padding: '1px 5px',
                  color: '#92400e',
                  cursor: 'pointer'
                }}
              >
                Fix
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

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
  onJoinSession,
  onEditQuestion
}) {
  const [manualCode, setManualCode] = useState('');
  const [isPhoneMicActive, setIsPhoneMicActive] = useState(false);
  const [micError, setMicError] = useState('');
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chatListRef = useRef(null);
  const messageRefs = useRef({});
  const activeAnswerIdRef = useRef(null);
  const scrolledFirstContentRef = useRef(false);
  const scrolledCompleteRef = useRef(false);

  const scrollToAnswerTop = useCallback((answerId, behavior = 'smooth') => {
    const container = chatListRef.current;
    const target = messageRefs.current[answerId];
    if (!container || !target) return;
    if (activeAnswerIdRef.current !== answerId) return; // Prevent old/interrupted answers from hijacking

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const relativeOffset = targetRect.top - containerRect.top;
    // 8px margin from the top of the chat list container ensures clean visibility
    const targetScrollTop = Math.max(0, container.scrollTop + relativeOffset - 8);

    container.scrollTo({
      top: targetScrollTop,
      behavior
    });
  }, []);

  // Align beginning of latest answer at top on first visible content and upon completion
  useEffect(() => {
    const latestAnswer = [...messages].reverse().find(m => m.role === 'answer');
    if (!latestAnswer) return;

    // Detect if a newer answer has started
    if (latestAnswer.id !== activeAnswerIdRef.current) {
      activeAnswerIdRef.current = latestAnswer.id;
      scrolledFirstContentRef.current = false;
      scrolledCompleteRef.current = false;
    }

    const hasVisibleContent = Boolean(latestAnswer.text && latestAnswer.text.trim().length > 0);

    // 1. When first visible content appears, position beginning near top
    if (hasVisibleContent && !scrolledFirstContentRef.current) {
      scrolledFirstContentRef.current = true;
      requestAnimationFrame(() => {
        if (activeAnswerIdRef.current === latestAnswer.id) {
          scrollToAnswerTop(latestAnswer.id, 'smooth');
        }
      });
      return;
    }

    // 2. While streaming, do NOT scroll to bottom; let content grow downward naturally

    // 3. When answer finishes, automatically align beginning at top once after final content has rendered
    const isFinished = latestAnswer.status === 'complete' || latestAnswer.status === 'interrupted';
    if (isFinished && !scrolledCompleteRef.current) {
      scrolledCompleteRef.current = true;
      // Double rAF ensures markdown layout and code block sizing are fully calculated
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (activeAnswerIdRef.current === latestAnswer.id) {
            scrollToAnswerTop(latestAnswer.id, 'smooth');
          }
        });
      });
    }
  }, [messages, scrollToAnswerTop]);

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
      <div className="mobile-chat-list" ref={chatListRef}>
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
              <MobileQuestionCard
                key={msg.id}
                msg={msg}
                onEditQuestion={onEditQuestion}
              />
            );
          }

          return (
            <div
              key={msg.id}
              ref={el => {
                if (el) messageRefs.current[msg.id] = el;
                else delete messageRefs.current[msg.id];
              }}
              className="mobile-chat-answer"
            >
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
        <div className="mobile-chat-bottom-spacer" />
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
