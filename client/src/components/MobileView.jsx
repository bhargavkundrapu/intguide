import React, { useState, useRef, useEffect } from 'react';
import { Zap, Play, Pause, RotateCcw, Wifi, WifiOff, Sparkles } from 'lucide-react';

export default function MobileView({
  wsConnected,
  sessionId,
  messages = [],
  isPaused,
  onTriggerAnswer,
  onExplainMore,
  onClear,
  onTogglePause,
  onJoinSession
}) {
  const [manualCode, setManualCode] = useState('');
  const bottomRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Get latest question and answer for quick reference
  const latestQuestion = [...messages].reverse().find(m => m.role === 'question');
  const latestAnswer = [...messages].reverse().find(m => m.role === 'answer');
  const isGenerating = latestAnswer?.status === 'streaming';

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

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {latestAnswer?.ttft > 0 && (
            <span className="ttft-chip">⚡ {(latestAnswer.ttft / 1000).toFixed(2)}s</span>
          )}
          {wsConnected ? (
            <span className="badge badge-green"><Wifi size={10} /> Synced</span>
          ) : (
            <span className="badge badge-amber"><WifiOff size={10} /> Connecting</span>
          )}
        </div>
      </div>

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
        {messages.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40, textAlign: 'center' }}>
            <Sparkles size={28} style={{ color: 'var(--gray-300)' }} />
            <div style={{ fontSize: 14, color: 'var(--gray-500)', fontWeight: 500 }}>Ready for Live Answer</div>
            <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>Tap "Answer" or speak on laptop</div>
          </div>
        )}

        {messages.map(msg => {
          if (msg.role === 'question') {
            return (
              <div key={msg.id} className="mobile-chat-question">
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                  Interviewer
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
                  <span style={{ fontSize: 13 }}>Generating...</span>
                </div>
              )}

              {msg.text && (
                <div style={{ fontSize: 15, color: 'var(--gray-800)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                  {msg.text}
                  {msg.status === 'streaming' && <span className="streaming-cursor" />}
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
          onClick={() => onTriggerAnswer(latestQuestion?.text)}
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
