import React, { useState } from 'react';
import { Zap, Play, Pause, RotateCcw, Wifi, WifiOff, Key, Check, Sparkles } from 'lucide-react';

export default function MobileView({
  wsConnected,
  sessionId,
  question,
  aiAnswer,
  aiStatus,
  ttft,
  totalTime,
  isPaused,
  onTriggerAnswer,
  onExplainMore,
  onClear,
  onTogglePause,
  onJoinSession
}) {
  const [manualCode, setManualCode] = useState('');

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
          {ttft > 0 && (
            <span className="ttft-chip">⚡ {(ttft / 1000).toFixed(2)}s</span>
          )}
          {wsConnected ? (
            <span className="badge badge-green">
              <Wifi size={10} />
              Synced
            </span>
          ) : (
            <span className="badge badge-amber">
              <WifiOff size={10} />
              Connecting
            </span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="mobile-content">
        {/* Session Connect (when not connected) */}
        {!wsConnected && (
          <div className="mobile-card">
            <div className="mobile-card-header">Join Session Manually</div>
            <div className="mobile-card-body">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Session code (e.g. SESSION-1234)"
                  value={manualCode}
                  onChange={e => setManualCode(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    border: '1px solid var(--gray-300)',
                    borderRadius: 7,
                    fontSize: 13,
                    fontFamily: 'JetBrains Mono, monospace',
                    outline: 'none'
                  }}
                />
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12 }}
                  onClick={() => { if (manualCode && onJoinSession) onJoinSession(manualCode); }}
                >
                  Join
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Question Card */}
        <div className="mobile-card">
          <div className="mobile-card-header">Interviewer Question</div>
          <div className="mobile-card-body">
            {question ? (
              <div className="mobile-question-text">"{question}"</div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--gray-400)', fontStyle: 'italic' }}>
                Listening for live interview question...
              </div>
            )}
          </div>
        </div>

        {/* Answer Card */}
        <div className="mobile-card" style={{ flex: 1 }}>
          <div className="mobile-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>AI Copilot Answer</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {totalTime > 0 && (
                <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--gray-500)' }}>
                  {(totalTime / 1000).toFixed(2)}s
                </span>
              )}
              {aiStatus === 'done' && <span className="badge badge-green">Done</span>}
            </div>
          </div>
          <div className="mobile-card-body">
            {aiStatus === 'generating' && !aiAnswer && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0' }}>
                <div className="spinner" />
                <span style={{ fontSize: 13, color: 'var(--blue-600)', fontWeight: 500 }}>
                  Generating answer...
                </span>
              </div>
            )}

            {aiAnswer ? (
              <div className="mobile-answer-text">{aiAnswer}</div>
            ) : aiStatus !== 'generating' && (
              <div style={{
                minHeight: 120, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center'
              }}>
                <Sparkles size={28} style={{ color: 'var(--gray-300)' }} />
                <div style={{ fontSize: 13, color: 'var(--gray-500)', fontWeight: 500 }}>Ready for Live Answer</div>
                <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>
                  Tap "Answer" or speak on laptop
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="mobile-bottombar">
        <button
          className="mobile-action-btn primary"
          onClick={() => onTriggerAnswer(question)}
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
