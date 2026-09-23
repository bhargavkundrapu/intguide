import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  User, Sparkles, Zap, AlertCircle, CheckCircle, Clock,
  ArrowDown, RefreshCw, Copy, Check, ChevronDown, Edit2, AlertTriangle
} from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';

// ─────────────────────────────────────────────────────────────
//  Status badge
// ─────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  streaming:    { label: 'Answering', cls: 'badge-blue',  icon: null },
  complete:     { label: 'Complete',  cls: 'badge-green', icon: null },
  interrupted:  { label: 'Interrupted', cls: 'badge-amber', icon: null },
  error:        { label: 'Error',     cls: 'badge-red',   icon: null },
  pending:      { label: 'Pending',   cls: 'badge-gray',  icon: null },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span className={`badge ${cfg.cls}`} style={{ fontSize: 10 }}>
      {status === 'streaming' && <span className="status-dot live" style={{ marginRight: 3 }} />}
      {cfg.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
//  Single message bubble
// ─────────────────────────────────────────────────────────────
function QuestionBubble({ msg, onEditQuestion }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(msg.text);

  const handleSave = () => {
    if (draftText.trim() && draftText.trim() !== msg.text && onEditQuestion) {
      onEditQuestion(msg.id, draftText.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      setDraftText(msg.text);
      setIsEditing(false);
    }
  };

  return (
    <div className="chat-msg chat-msg-question">
      <div className="chat-msg-header">
        <div className="chat-role-label">
          <User size={12} />
          Interviewer
          {msg.isEdited && (
            <span className="badge badge-amber" style={{ fontSize: 9, padding: '1px 5px', marginLeft: 4 }}>
              Edited
            </span>
          )}
        </div>
        {onEditQuestion && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '2px 6px', color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 3 }}
            onClick={() => {
              setDraftText(msg.text);
              setIsEditing(!isEditing);
            }}
            title="Edit question & regenerate answer"
          >
            <Edit2 size={11} /> {isEditing ? 'Cancel' : 'Edit'}
          </button>
        )}
      </div>

      {isEditing ? (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            className="transcript-area"
            rows={2}
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            placeholder="Correct the question..."
            style={{ fontSize: 13, background: 'var(--card-bg)' }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => {
                setDraftText(msg.text);
                setIsEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              style={{ fontSize: 11, padding: '3px 10px' }}
              onClick={handleSave}
            >
              <Zap size={11} /> Regenerate Answer
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="chat-bubble-question">
            {msg.text}
          </div>

          {/* Raw transcript preserved separately */}
          {msg.rawText && msg.rawText !== msg.text && (
            <div style={{ fontSize: 11, color: 'var(--gray-400)', fontStyle: 'italic', marginTop: 4, paddingLeft: 4 }}>
              Raw: "{msg.rawText}"
            </div>
          )}

          {/* Uncertainty alert chip for important words */}
          {msg.uncertainWords?.length > 0 && !msg.isEdited && (
            <div className="uncertain-chip" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 6, padding: '4px 8px' }}>
              <AlertTriangle size={12} style={{ color: '#d97706', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#92400e' }}>
                Uncertain: {msg.uncertainWords.map(w => `"${w.word}" (${Math.round(w.confidence * 100)}%)`).join(', ')}
              </span>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 10, padding: '2px 6px', marginLeft: 'auto', background: '#ffffff', borderColor: '#fde68a' }}
                onClick={() => {
                  setDraftText(msg.text);
                  setIsEditing(true);
                }}
              >
                Correct
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MessageBubble({ msg, onContinue, onExplainMore, onEditQuestion }) {
  const [copied, setCopied] = useState(false);

  const copyText = () => {
    navigator.clipboard.writeText(msg.text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (msg.role === 'question') {
    return <QuestionBubble msg={msg} onEditQuestion={onEditQuestion} />;
  }

  // Answer message
  return (
    <div className={`chat-msg chat-msg-answer ${msg.isSuperseded ? 'chat-msg-superseded' : ''}`}>
      <div className="chat-msg-header">
        <div className="chat-role-label">
          <Sparkles size={12} />
          AI Copilot
          {msg.revision > 1 && !msg.isSuperseded && (
            <span className="badge badge-purple" style={{ fontSize: 9, padding: '1px 5px', marginLeft: 4 }}>
              v{msg.revision}
            </span>
          )}
          {msg.isSuperseded && (
            <span className="badge badge-amber" style={{ fontSize: 9, padding: '1px 5px', marginLeft: 4 }}>
              v{msg.revision || 1} (superseded)
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {msg.verificationStatus === 'verified' && (
            <span className="badge badge-green" style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <CheckCircle size={10} /> Verified
            </span>
          )}
          <StatusBadge status={msg.status} />
          {msg.ttft > 0 && (
            <span className="ttft-chip" style={{ fontSize: 10 }}>
              ⚡ {(msg.ttft / 1000).toFixed(2)}s
            </span>
          )}
          {msg.totalTime > 0 && (
            <span className="badge badge-gray" style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>
              {(msg.totalTime / 1000).toFixed(2)}s
            </span>
          )}
        </div>
      </div>

      <div className="chat-bubble-answer">
        {/* Active Coding Task Pill Summary */}
        {msg.taskPill && (
          <div className="task-pill" style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 10px',
            marginBottom: 8,
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--blue-700, #1d4ed8)',
            background: 'var(--blue-50, #eff6ff)',
            border: '1px solid var(--blue-200, #bfdbfe)',
            fontFamily: 'JetBrains Mono, monospace'
          }}>
            <span>⚡ {msg.taskPill}</span>
          </div>
        )}

        {/* Revision Note */}
        {msg.revisionNote && (
          <div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 8, fontStyle: 'italic' }}>
            {msg.revisionNote}
          </div>
        )}

        {msg.status === 'streaming' && !msg.text && (
          <div className="answer-generating" style={{ margin: 0 }}>
            <div className="spinner" />
            <span>Generating via Groq...</span>
          </div>
        )}

        {msg.text ? (
          <div className="answer-text">
            <MarkdownRenderer text={msg.text} isStreaming={msg.status === 'streaming'} />
          </div>
        ) : null}

        {/* Streaming cursor */}
        {msg.status === 'streaming' && msg.text && (
          <span className="streaming-cursor" />
        )}
      </div>

      {/* Footer actions */}
      {msg.text && (
        <div className="chat-msg-footer">
          <div style={{ display: 'flex', gap: 6 }}>
            {msg.status === 'interrupted' && onContinue && (
              <button
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => onContinue(msg.id)}
              >
                <RefreshCw size={11} />
                Continue
              </button>
            )}
            {msg.status === 'complete' && onExplainMore && (
              <button
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => onExplainMore(msg.id)}
              >
                <Zap size={11} />
                Explain More
              </button>
            )}
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '4px 8px' }}
            onClick={copyText}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Chat History container
// ─────────────────────────────────────────────────────────────
export default function ChatHistory({ messages, onContinue, onExplainMore, onEditQuestion }) {
  const containerRef = useRef(null);
  const bottomRef = useRef(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasNewMsg, setHasNewMsg] = useState(false);
  const prevMsgCount = useRef(0);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom < 100;
    setIsAtBottom(atBottom);
    if (atBottom) setHasNewMsg(false);
  }, []);

  // Auto-scroll only when already at bottom
  useEffect(() => {
    if (messages.length !== prevMsgCount.current) {
      prevMsgCount.current = messages.length;
      if (isAtBottom) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else {
        setHasNewMsg(true);
      }
    }
  }, [messages.length, isAtBottom]);


  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setHasNewMsg(false);
    setIsAtBottom(true);
  };

  if (messages.length === 0) {
    return (
      <div className="chat-empty-state">
        <Sparkles size={32} style={{ color: 'var(--gray-300)', marginBottom: 8 }} />
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-500)' }}>
          Ready for Live Interview
        </div>
        <div style={{ fontSize: 12, color: 'var(--gray-400)', maxWidth: 260, textAlign: 'center', marginTop: 4 }}>
          Start listening or type a question — answers will stream here and sync to your phone.
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        className="chat-history"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onContinue={onContinue}
            onExplainMore={onExplainMore}
            onEditQuestion={onEditQuestion}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* New answer indicator */}
      {hasNewMsg && !isAtBottom && (
        <button className="new-answer-btn" onClick={scrollToBottom}>
          <ArrowDown size={13} />
          New answer
        </button>
      )}
    </div>
  );
}
