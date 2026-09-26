import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap, Volume2, QrCode, User, Pause, Play, RotateCcw,
  Sparkles, Smartphone, BookOpen, LayoutDashboard, Trash2, MessageSquare
} from 'lucide-react';
import AudioCapture from './components/AudioCapture';
import ContextDrawer from './components/ContextDrawer';
import PracticeSimulator from './components/PracticeSimulator';
import QrModal from './components/QrModal';
import MobileView from './components/MobileView';
import ChatHistory from './components/ChatHistory';

// ─────────────────────────────────────────────────────────────
//  App
// ─────────────────────────────────────────────────────────────
export default function App() {
  const urlParams = new URLSearchParams(window.location.search);
  const isMobileMode = urlParams.get('mode') === 'mobile';

  const [sessionId] = useState(() =>
    urlParams.get('session') || 'SESSION-' + Math.floor(1000 + Math.random() * 9000)
  );

  const [serverInfo, setServerInfo] = useState({ localIp: 'localhost', port: 5000, hasGroqKey: true, hasDeepgramKey: true });
  const [wsConnected, setWsConnected] = useState(false);
  const [mobileConnected, setMobileConnected] = useState(false);
  const [mobileCount, setMobileCount] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // ── Transcript state (live speech, not yet committed) ──
  const [interimTranscript, setInterimTranscript] = useState('');
  const [committedTranscript, setCommittedTranscript] = useState('');
  const [manualTranscript, setManualTranscript] = useState('');

  // ── Chat history: array of { id, role, text, status, ttft, totalTime, parentId, reqId } ──
  const [messages, setMessages] = useState([]);

  // ── Active generation tracking (reject stale chunks) ──
  const activeReqIdRef = useRef(null);

  // ── UI state ──
  const [candidateContext, setCandidateContext] = useState(null);
  const [isContextDrawerOpen, setIsContextDrawerOpen] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [activeNav, setActiveNav] = useState('dashboard');
  const [wsError, setWsError] = useState(null);
  const [deepgramActive, setDeepgramActive] = useState(false);

  const wsRef = useRef(null);

  // ─────────────────────────────────────────────────────────────
  //  Message helpers
  // ─────────────────────────────────────────────────────────────
  const upsertMessage = useCallback((newMsg) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === newMsg.id);
      if (idx === -1) return [...prev, newMsg];
      const updated = [...prev];
      updated[idx] = { ...updated[idx], ...newMsg };
      return updated;
    });
  }, []);

  const patchMessage = useCallback((id, patch) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], ...patch };
      return updated;
    });
  }, []);

  // ─────────────────────────────────────────────────────────────
  //  Server info + candidate context fetch
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/info').then(r => r.json()).then(d => setServerInfo(d)).catch(() => {});
    fetch('/api/context').then(r => r.json()).then(d => setCandidateContext(d)).catch(() => {});
  }, []);

  // ─────────────────────────────────────────────────────────────
  //  WebSocket connection
  // ─────────────────────────────────────────────────────────────
  const getWsUrl = () => {
    if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
    if (import.meta.env.VITE_BACKEND_URL) {
      try {
        const url = new URL(import.meta.env.VITE_BACKEND_URL);
        const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${url.host}`;
      } catch (e) {}
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (window.location.port === '3000') return `${proto}//${window.location.hostname}:5000`;
    return `${proto}//${window.location.host}`;
  };

  const getPairingUrl = () => {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      if (serverInfo.localIp && serverInfo.localIp !== 'localhost') {
        const port = window.location.port || '5000';
        return `http://${serverInfo.localIp}:${port}/?mode=mobile&session=${sessionId}`;
      }
    }
    return `${window.location.origin}/?mode=mobile&session=${sessionId}`;
  };

  useEffect(() => {
    let reconnectTimer = null;
    let retries = 0;
    const MAX_RETRIES = 8;

    function connect() {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setWsError(null);
        retries = 0;
        ws.send(JSON.stringify({
          type: 'register',
          session: sessionId,
          role: isMobileMode ? 'mobile' : 'laptop'
        }));
        if (!isMobileMode) {
          ws.send(JSON.stringify({ type: 'start_deepgram_flux' }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWsMessage(data);
        } catch (e) {}
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (retries < MAX_RETRIES) {
          const delay = Math.min(1000 * 2 ** retries, 20000);
          retries++;
          reconnectTimer = setTimeout(connect, delay);
        } else {
          setWsError('Connection lost. Please refresh the page.');
        }
      };

      ws.onerror = () => {};
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [sessionId, isMobileMode]);

  // ─────────────────────────────────────────────────────────────
  //  Central WS message handler
  // ─────────────────────────────────────────────────────────────
  const handleWsMessage = useCallback((data) => {
    switch (data.type) {

      // ── Peer/session events ──
      case 'registered':
        if (data.history?.length) {
          setMessages(data.history);
        }
        if (data.currentTranscript) {
          setCommittedTranscript(data.currentTranscript);
        }
        break;

      case 'peer_status':
        setMobileConnected(data.mobileConnected);
        setMobileCount(data.mobileCount || 0);
        break;

      case 'deepgram_status':
        setDeepgramActive(data.status === 'connected');
        break;

      // ── Transcript events ──
      case 'transcript_update':
        if (data.isFinal) {
          setCommittedTranscript(p => p ? p + ' ' + data.transcript : data.transcript);
          setInterimTranscript('');
        } else {
          setInterimTranscript(data.transcript);
        }
        break;

      // ── Question committed by server ──
      case 'question_committed':
        setCommittedTranscript('');
        setInterimTranscript('');
        setManualTranscript('');
        upsertMessage({
          id: data.msgId,
          role: 'question',
          text: data.text,
          rawText: data.rawText || data.text,
          uncertainWords: data.uncertainWords || [],
          isEdited: Boolean(data.isEdited),
          status: 'complete',
          parentId: null,
          reqId: null,
          ttft: 0,
          totalTime: 0,
          createdAt: Date.now()
        });
        break;

      case 'question_updated':
        setMessages(prev =>
          prev
            .map(m => (m.id === data.msgId ? {
              ...m,
              text: data.text,
              rawText: data.rawText || m.rawText || data.text,
              uncertainWords: data.uncertainWords !== undefined ? data.uncertainWords : m.uncertainWords,
              isEdited: data.isEdited !== undefined ? data.isEdited : m.isEdited
            } : m))
            .filter(m => !(m.role === 'answer' && m.parentId === data.msgId))
        );
        break;

      // ── Answer streaming events ──
      case 'chat_message':
        // New answer message created - ensure only one active answer per parent question
        activeReqIdRef.current = data.reqId;
        setMessages(prev => prev.filter(m => !(m.role === 'answer' && m.parentId === data.parentId && m.id !== data.msgId)));
        upsertMessage({
          id: data.msgId,
          role: 'answer',
          text: data.text || '',
          status: 'streaming',
          parentId: data.parentId,
          reqId: data.reqId,
          ttft: 0,
          totalTime: 0,
          createdAt: Date.now()
        });
        break;

      case 'chat_start':
        patchMessage(data.msgId, { ttft: data.ttft });
        break;

      case 'chat_chunk':
        // Accept chunk if matching current active request or if initializing first chunk
        if (activeReqIdRef.current && data.reqId !== activeReqIdRef.current) break;
        activeReqIdRef.current = data.reqId;
        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === data.msgId);
          if (idx === -1) {
            return [...prev, {
              id: data.msgId,
              role: 'answer',
              text: data.fullText,
              status: 'streaming',
              reqId: data.reqId,
              createdAt: Date.now()
            }];
          }
          const updated = [...prev];
          updated[idx] = { ...updated[idx], text: data.fullText, status: 'streaming' };
          return updated;
        });
        break;

      case 'chat_done':
        if (activeReqIdRef.current && data.reqId !== activeReqIdRef.current) break;
        activeReqIdRef.current = null;
        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === data.msgId);
          if (idx === -1) {
            return [...prev, {
              id: data.msgId,
              role: 'answer',
              text: data.fullText,
              status: 'complete',
              totalTime: data.totalTime,
              createdAt: Date.now()
            }];
          }
          const updated = [...prev];
          updated[idx] = { ...updated[idx], text: data.fullText, status: 'complete', totalTime: data.totalTime };
          return updated;
        });
        break;

      case 'chat_interrupted':
        if (!data.reqId || data.reqId === activeReqIdRef.current) {
          activeReqIdRef.current = null;
        }
        if (data.msgId) {
          patchMessage(data.msgId, {
            status: 'interrupted',
            ...(data.fullText ? { text: data.fullText } : {}),
            ...(data.totalTime ? { totalTime: data.totalTime } : {})
          });
        }
        break;

      case 'chat_error':
        activeReqIdRef.current = null;
        patchMessage(data.msgId, {
          status: 'error',
          errorMessage: data.message
        });
        break;

      // ── Legacy compatibility ──
      case 'ai_stream_start':
        break; // handled by chat_start now
      case 'ai_stream_chunk':
        break;
      case 'ai_stream_end':
        break;
      case 'ai_clear':
      case 'history_cleared':
        setMessages([]);
        setCommittedTranscript('');
        setInterimTranscript('');
        setManualTranscript('');
        break;

      case 'listening_status':
        setIsPaused(data.paused);
        break;

      case 'heartbeat_ping':
        wsRef.current?.send(JSON.stringify({ type: 'heartbeat_pong' }));
        break;
    }
  }, [upsertMessage, patchMessage]);

  // ─────────────────────────────────────────────────────────────
  //  Actions
  // ─────────────────────────────────────────────────────────────
  const handleAudioChunk = useCallback((blob) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && !isPaused) {
      wsRef.current.send(blob);
    }
  }, [isPaused]);

  const handleTranscriptUpdate = useCallback((text, isFinal) => {
    if (isPaused) return;
    if (isFinal) {
      setCommittedTranscript(p => p ? p + ' ' + text : text);
      setInterimTranscript('');
    } else {
      setInterimTranscript(text);
    }
    wsRef.current?.send(JSON.stringify({ type: 'transcript_sync', transcript: text, isFinal }));
  }, [isPaused]);

  const triggerAnswer = useCallback((questionText) => {
    const q = questionText || manualTranscript || committedTranscript || interimTranscript;
    wsRef.current?.send(JSON.stringify({ type: 'trigger_answer', question: (q || '').trim() }));
    setManualTranscript('');
  }, [manualTranscript, committedTranscript, interimTranscript]);

  const handleExplainMore = useCallback((msgId) => {
    // Find the question or answer to explain
    const aMsg = msgId ? messages.find(m => m.id === msgId) : [...messages].reverse().find(m => m.role === 'answer');
    const qMsg = aMsg ? messages.find(m => m.id === aMsg.parentId) : null;
    const lastQ = [...messages].reverse().find(m => m.role === 'question');
    const q = qMsg?.text || lastQ?.text || committedTranscript || manualTranscript || (aMsg?.text ? `the previous answer: ${aMsg.text.slice(0, 150)}` : 'the latest interview question');
    wsRef.current?.send(JSON.stringify({ type: 'explain_more', question: q }));
  }, [messages, committedTranscript, manualTranscript]);

  const handleContinue = useCallback((msgId) => {
    wsRef.current?.send(JSON.stringify({ type: 'continue_answer', msgId }));
  }, []);

  const handleEditQuestion = useCallback((msgId, newText) => {
    if (!msgId || !newText?.trim()) return;
    wsRef.current?.send(JSON.stringify({
      type: 'edit_question',
      msgId,
      newText: newText.trim()
    }));
  }, []);

  const handleTogglePause = useCallback(() => {
    const next = !isPaused;
    setIsPaused(next);
    wsRef.current?.send(JSON.stringify({ type: 'pause_listening', paused: next }));
  }, [isPaused]);

  const handleClearHistory = useCallback(() => {
    setMessages([]);
    setCommittedTranscript('');
    setInterimTranscript('');
    setManualTranscript('');
    wsRef.current?.send(JSON.stringify({ type: 'clear_history' }));
  }, []);

  const handleSaveContext = useCallback((ctx) => {
    setCandidateContext(ctx);
    fetch('/api/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx)
    }).catch(() => {});
  }, []);

  const handleJoinSession = (code) => {
    window.location.href = `${window.location.origin}/?mode=mobile&session=${code}`;
  };

  // ─────────────────────────────────────────────────────────────
  //  Computed values
  // ─────────────────────────────────────────────────────────────
  const latestAnswer = [...messages].reverse().find(m => m.role === 'answer');
  const latestQuestion = [...messages].reverse().find(m => m.role === 'question');
  const isGenerating = latestAnswer?.status === 'streaming';
  const pairingUrl = getPairingUrl();
  const displayTranscript = manualTranscript || committedTranscript || interimTranscript;

  // ─────────────────────────────────────────────────────────────
  //  Mobile view
  // ─────────────────────────────────────────────────────────────
  if (isMobileMode) {
    return (
      <MobileView
        wsConnected={wsConnected}
        sessionId={sessionId}
        messages={messages}
        isPaused={isPaused}
        displayTranscript={displayTranscript}
        onAudioChunk={handleAudioChunk}
        onTriggerAnswer={triggerAnswer}
        onExplainMore={() => handleExplainMore(latestAnswer?.id)}
        onClear={handleClearHistory}
        onTogglePause={handleTogglePause}
        onJoinSession={handleJoinSession}
        onEditQuestion={handleEditQuestion}
      />
    );
  }

  // ─────────────────────────────────────────────────────────────
  //  Desktop view
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon"><Zap size={16} /></div>
          <div>
            <div className="sidebar-logo-text">Interview Copilot</div>
            <div className="sidebar-logo-sub">AI-Powered Real-Time</div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">Navigation</div>
          <button
            className={`sidebar-nav-item ${activeNav === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveNav('dashboard')}
          >
            <LayoutDashboard /> Dashboard
          </button>
          <button
            className={`sidebar-nav-item ${activeNav === 'practice' ? 'active' : ''}`}
            onClick={() => setActiveNav('practice')}
          >
            <BookOpen /> Practice Questions
          </button>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">Tools</div>
          <button className="sidebar-nav-item" onClick={() => setIsContextDrawerOpen(true)}>
            <User /> My Background
          </button>
          <button className="sidebar-nav-item" onClick={() => setIsQrModalOpen(true)}>
            <Smartphone />
            {mobileConnected ? `Phone Synced (${mobileCount})` : 'Pair Phone'}
          </button>
        </div>

        <div className="sidebar-status">
          <div className="sidebar-label" style={{ padding: '0 0 6px 0' }}>System Status</div>
          <StatusRow label="WebSocket" active={wsConnected} activeLabel="Connected" inactiveLabel="Offline" />
          <StatusRow label="Audio" active={isListening} live={isListening} activeLabel="Live" inactiveLabel="Idle" />
          <StatusRow label="Phone" active={mobileConnected} activeLabel="Paired" inactiveLabel="Not Paired" />
          <StatusRow label="Groq AI" active={serverInfo.hasGroqKey} activeLabel="Ready" inactiveLabel="No Key" />
          <StatusRow label="Answering" active={isGenerating} live={isGenerating} activeLabel="Streaming" inactiveLabel="Idle" />
        </div>
      </aside>

      {/* ── Main Area ── */}
      <div className="main-area">
        {/* Top Bar */}
        <div className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="topbar-title">
              {activeNav === 'dashboard' ? 'Live Interview Dashboard' : 'Practice Question Bank'}
            </span>
            {isListening && (
              <span className="badge badge-red">
                <div className="status-dot live" style={{ marginRight: 2 }} />
                LISTENING
              </span>
            )}
            {isPaused && <span className="badge badge-amber">PAUSED</span>}
            {isGenerating && <span className="badge badge-blue">ANSWERING</span>}
          </div>

          <div className="topbar-actions">
            {latestAnswer?.ttft > 0 && (
              <span className="ttft-chip">⚡ {(latestAnswer.ttft / 1000).toFixed(2)}s TTFT</span>
            )}
            <button className="btn btn-secondary" onClick={() => setIsQrModalOpen(true)} style={{ fontSize: 12 }}>
              <QrCode size={13} />
              {mobileConnected ? 'Phone Paired ✓' : 'Pair Phone'}
            </button>
            {messages.length > 0 && (
              <button className="btn btn-ghost" onClick={handleClearHistory} title="Clear chat history" style={{ fontSize: 12 }}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        {wsError && (
          <div className="alert alert-error" style={{ margin: '8px 20px', borderRadius: 8 }}>
            <span>{wsError}</span>
          </div>
        )}

        {/* Content */}
        {activeNav === 'dashboard' ? (
          <div className="content-area" style={{ gridTemplateRows: 'auto 1fr', height: 'calc(100vh - 60px)' }}>
            {/* TOP ROW: Audio Capture (left) + Transcript (right) */}
            <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <AudioCapture
                isListening={isListening}
                setIsListening={setIsListening}
                onAudioChunk={handleAudioChunk}
                onTranscriptUpdate={handleTranscriptUpdate}
                deepgramActive={deepgramActive}
              />

              {/* Transcript / Question input card */}
              <div className="card">
                <div className="card-header">
                  <div className="card-title">
                    <Volume2 />
                    Interviewer Question
                    {interimTranscript && (
                      <span className="badge badge-blue" style={{ fontSize: 10, marginLeft: 4 }}>live...</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary" onClick={handleTogglePause} style={{ fontSize: 12 }}>
                      {isPaused ? <Play size={13} /> : <Pause size={13} />}
                      {isPaused ? 'Resume' : 'Pause'}
                    </button>
                  </div>
                </div>
                <div className="card-body">
                  <textarea
                    className="transcript-area"
                    rows={3}
                    value={displayTranscript}
                    onChange={e => setManualTranscript(e.target.value)}
                    placeholder="Interviewer speech appears here... You can also type or paste a question directly."
                  />
                </div>
                <div className="card-footer">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" onClick={() => triggerAnswer()} style={{ fontSize: 12 }}>
                      <Zap size={13} /> Answer Now
                    </button>
                    <button className="btn btn-amber" onClick={() => handleExplainMore(latestAnswer?.id)} style={{ fontSize: 12 }}>
                      Explain More
                    </button>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                    {messages.length} message{messages.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </div>

            {/* BOTTOM ROW: Chat History full width */}
            <div style={{ gridColumn: '1 / -1', overflow: 'hidden' }}>
              <div className="card chat-panel" style={{ height: '100%' }}>
                <div className="card-header">
                  <div className="card-title">
                    <MessageSquare />
                    Conversation History
                    <span className="badge badge-gray" style={{ fontSize: 10 }}>
                      {messages.length} messages
                    </span>
                  </div>
                  {messages.length > 0 && (
                    <button className="btn btn-ghost" onClick={handleClearHistory} style={{ fontSize: 11 }}>
                      <Trash2 size={12} /> Clear
                    </button>
                  )}
                </div>
                <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                  <ChatHistory
                    messages={messages}
                    onContinue={handleContinue}
                    onExplainMore={handleExplainMore}
                    onEditQuestion={handleEditQuestion}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="content-area">
            <div style={{ gridColumn: '1 / -1' }}>
              <PracticeSimulator
                onTriggerQuestion={(q) => {
                  triggerAnswer(q);
                  setActiveNav('dashboard');
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <ContextDrawer
        isOpen={isContextDrawerOpen}
        onClose={() => setIsContextDrawerOpen(false)}
        context={candidateContext}
        onSaveContext={handleSaveContext}
      />
      <QrModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        pairingUrl={pairingUrl}
        sessionId={sessionId}
        mobileConnected={mobileConnected}
        mobileCount={mobileCount}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Sidebar status row helper
// ─────────────────────────────────────────────────────────────
function StatusRow({ label, active, live, activeLabel, inactiveLabel }) {
  return (
    <div className="status-row">
      <span>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div className={`status-dot ${active ? (live ? 'live' : 'online') : 'offline'}`} />
        <span style={{ fontSize: 11 }}>{active ? activeLabel : inactiveLabel}</span>
      </div>
    </div>
  );
}
