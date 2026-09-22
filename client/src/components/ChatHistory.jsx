import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  User, Sparkles, Zap, AlertCircle, CheckCircle, Clock,
  ArrowDown, RefreshCw, Copy, Check, ChevronDown
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
//  Simple inline markdown renderer (no deps)
// ─────────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return null;

  // Close any unclosed code fences at end
  const fenceCount = (text.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) text = text + '\n```';

  const lines = text.split('\n');
  const elements = [];
  let i = 0;
  let keyCounter = 0;
  const k = () => keyCounter++;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <div key={k()} className="code-block-wrapper">
          {lang && <div className="code-lang-label">{lang}</div>}
          <pre className="code-block"><code>{codeLines.join('\n')}</code></pre>
        </div>
      );
      i++; // skip closing ```
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      elements.push(<h4 key={k()} className="md-h4">{inlineMarkdown(line.slice(4))}</h4>);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h3 key={k()} className="md-h3">{inlineMarkdown(line.slice(3))}</h3>);
      i++; continue;
    }
    if (line.startsWith('# ')) {
      elements.push(<h2 key={k()} className="md-h2">{inlineMarkdown(line.slice(2))}</h2>);
      i++; continue;
    }

    // Bullet lists
    if (line.match(/^[\-\*] /)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[\-\*] /)) {
        items.push(<li key={k()}>{inlineMarkdown(lines[i].slice(2))}</li>);
        i++;
      }
      elements.push(<ul key={k()} className="md-ul">{items}</ul>);
      continue;
    }

    // Numbered lists
    if (line.match(/^\d+\. /)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(<li key={k()}>{inlineMarkdown(lines[i].replace(/^\d+\. /, ''))}</li>);
        i++;
      }
      elements.push(<ol key={k()} className="md-ol">{items}</ol>);
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      elements.push(<div key={k()} style={{ height: 8 }} />);
      i++; continue;
    }

    // Normal paragraph
    elements.push(<p key={k()} className="md-p">{inlineMarkdown(line)}</p>);
    i++;
  }

  return elements;
}

function inlineMarkdown(text) {
  // Bold+italic, bold, italic, inline code
  const parts = [];
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={m.index}><em>{m[2]}</em></strong>);
    else if (m[3]) parts.push(<strong key={m.index}>{m[3]}</strong>);
    else if (m[4]) parts.push(<em key={m.index}>{m[4]}</em>);
    else if (m[5]) parts.push(<code key={m.index} className="inline-code">{m[5]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

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
function MessageBubble({ msg, onContinue, onExplainMore }) {
  const [copied, setCopied] = useState(false);

  const copyText = () => {
    navigator.clipboard.writeText(msg.text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (msg.role === 'question') {
    return (
      <div className="chat-msg chat-msg-question">
        <div className="chat-msg-header">
          <div className="chat-role-label">
            <User size={12} />
            Interviewer
          </div>
        </div>
        <div className="chat-bubble-question">
          {msg.text}
        </div>
      </div>
    );
  }

  // Answer message
  return (
    <div className="chat-msg chat-msg-answer">
      <div className="chat-msg-header">
        <div className="chat-role-label">
          <Sparkles size={12} />
          AI Copilot
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
        {msg.status === 'streaming' && !msg.text && (
          <div className="answer-generating" style={{ margin: 0 }}>
            <div className="spinner" />
            <span>Generating via Groq...</span>
          </div>
        )}

        {msg.text ? (
          <div className="answer-text">
            {renderMarkdown(msg.text)}
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
export default function ChatHistory({ messages, onContinue, onExplainMore }) {
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

  // Auto-scroll on streaming updates when at bottom
  useEffect(() => {
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  });

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
