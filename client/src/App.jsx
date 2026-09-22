import React, { useState, useEffect, useRef } from 'react';
import {
  Zap, Volume2, QrCode, User, Pause, Play, RotateCcw,
  Sparkles, Smartphone, Wifi, WifiOff, Mic, Monitor,
  BookOpen, ChevronDown, Settings, LayoutDashboard, Activity
} from 'lucide-react';
import AudioCapture from './components/AudioCapture';
import ContextDrawer from './components/ContextDrawer';
import PracticeSimulator from './components/PracticeSimulator';
import QrModal from './components/QrModal';
import MobileView from './components/MobileView';

export default function App() {
  const urlParams = new URLSearchParams(window.location.search);
  const isMobileMode = urlParams.get('mode') === 'mobile' || window.location.pathname === '/mobile';

  const [sessionId] = useState(() =>
    urlParams.get('session') || 'SESSION-' + Math.floor(1000 + Math.random() * 9000)
  );

  const [serverInfo, setServerInfo] = useState({
    localIp: 'localhost',
    port: 5000,
    hasGroqKey: true,
    hasDeepgramKey: true,
  });

  const [wsConnected, setWsConnected] = useState(false);
  const [mobileConnected, setMobileConnected] = useState(false);
  const [mobileCount, setMobileCount] = useState(0);

  const [isListening, setIsListening] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');

  const [aiAnswer, setAiAnswer] = useState('');
  const [aiStatus, setAiStatus] = useState('idle');
  const [ttft, setTtft] = useState(0);
  const [totalTime, setTotalTime] = useState(0);

  const [candidateContext, setCandidateContext] = useState(null);
  const [isContextDrawerOpen, setIsContextDrawerOpen] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [activeNav, setActiveNav] = useState('dashboard');

  const wsRef = useRef(null);

  useEffect(() => {
    fetch('/api/info')
      .then(r => r.json())
      .then(d => setServerInfo(d))
      .catch(() => {});
    fetch('/api/context')
      .then(r => r.json())
      .then(d => setCandidateContext(d))
      .catch(() => {});
  }, []);

  const getWsUrl = () => {
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
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(JSON.stringify({ type: 'register', session: sessionId, role: 'laptop' }));
      ws.send(JSON.stringify({ type: 'start_deepgram_flux' }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'peer_status':
            setMobileConnected(data.mobileConnected);
            setMobileCount(data.mobileCount || 0);
            break;
          case 'transcript_update':
            if (data.isFinal) {
              setTranscript(p => p ? p + ' ' + data.transcript : data.transcript);
              setInterimTranscript('');
            } else {
              setInterimTranscript(data.transcript);
            }
            break;
          case 'ai_status':
            setAiStatus(data.status);
            if (data.question) setTranscript(data.question);
            break;
          case 'ai_stream_start':
            setTtft(data.ttft);
            setAiAnswer('');
            break;
          case 'ai_stream_chunk':
            setAiAnswer(data.fullText);
            break;
          case 'ai_stream_end':
            setAiAnswer(data.fullText);
            setTotalTime(data.totalTime);
            setAiStatus('done');
            break;
          case 'ai_clear':
            setAiAnswer('');
            setAiStatus('idle');
            setTtft(0);
            setTotalTime(0);
            break;
          case 'listening_status':
            setIsPaused(data.paused);
            break;
        }
      } catch (e) {}
    };

    ws.onclose = () => setWsConnected(false);
    return () => ws.close();
  }, [sessionId]);

  const handleAudioChunk = (blob) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && !isPaused) {
      wsRef.current.send(blob);
    }
  };

  const handleTranscriptUpdate = (text, isFinal) => {
    if (isPaused) return;
    if (isFinal) {
      setTranscript(p => p ? p + ' ' + text : text);
      setInterimTranscript('');
    } else {
      setInterimTranscript(text);
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'transcript_sync', transcript: text, isFinal }));
    }
  };

  const triggerAnswer = (questionText) => {
    const q = questionText || transcript || interimTranscript;
    if (!q.trim()) return;
    setAiStatus('generating');
    setAiAnswer('');
    setTtft(0);
    wsRef.current?.send(JSON.stringify({ type: 'trigger_answer', question: q }));
  };

  const handleExplainMore = () => {
    const q = transcript || interimTranscript || 'Explain the technical architecture';
    setAiStatus('generating');
    wsRef.current?.send(JSON.stringify({ type: 'explain_more', question: q }));
  };

  const handleClear = () => {
    setTranscript('');
    setInterimTranscript('');
    setAiAnswer('');
    setAiStatus('idle');
    setTtft(0);
    setTotalTime(0);
    wsRef.current?.send(JSON.stringify({ type: 'clear_answer' }));
  };

  const handleTogglePause = () => {
    const next = !isPaused;
    setIsPaused(next);
    wsRef.current?.send(JSON.stringify({ type: 'pause_listening', paused: next }));
  };

  const handleSaveContext = (ctx) => {
    setCandidateContext(ctx);
    fetch('/api/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx)
    }).catch(() => {});
  };

  const handleJoinSession = (code) => {
    window.location.href = `${window.location.origin}/?mode=mobile&session=${code}`;
  };

  if (isMobileMode) {
    return (
      <MobileView
        wsConnected={wsConnected}
        sessionId={sessionId}
        question={transcript || interimTranscript}
        aiAnswer={aiAnswer}
        aiStatus={aiStatus}
        ttft={ttft}
        totalTime={totalTime}
        isPaused={isPaused}
        onTriggerAnswer={triggerAnswer}
        onExplainMore={handleExplainMore}
        onClear={handleClear}
        onTogglePause={handleTogglePause}
        onJoinSession={handleJoinSession}
      />
    );
  }

  const pairingUrl = getPairingUrl();

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <Zap size={16} />
          </div>
          <div>
            <div className="sidebar-logo-text">Interview Copilot</div>
            <div className="sidebar-logo-sub">AI-Powered Real-Time</div>
          </div>
        </div>

        {/* Nav */}
        <div className="sidebar-section">
          <div className="sidebar-label">Navigation</div>
          <button
            className={`sidebar-nav-item ${activeNav === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveNav('dashboard')}
          >
            <LayoutDashboard />
            Dashboard
          </button>
          <button
            className={`sidebar-nav-item ${activeNav === 'practice' ? 'active' : ''}`}
            onClick={() => setActiveNav('practice')}
          >
            <BookOpen />
            Practice Questions
          </button>
        </div>

        {/* Actions */}
        <div className="sidebar-section">
          <div className="sidebar-label">Tools</div>
          <button className="sidebar-nav-item" onClick={() => setIsContextDrawerOpen(true)}>
            <User />
            My Background
          </button>
          <button className="sidebar-nav-item" onClick={() => setIsQrModalOpen(true)}>
            <Smartphone />
            {mobileConnected ? `Phone Synced (${mobileCount})` : 'Pair Phone'}
          </button>
        </div>

        {/* Status */}
        <div className="sidebar-status">
          <div className="sidebar-label" style={{ padding: '0 0 6px 0' }}>System Status</div>

          <div className="status-row">
            <span>WebSocket</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div className={`status-dot ${wsConnected ? 'online' : 'offline'}`} />
              <span style={{ fontSize: 11 }}>{wsConnected ? 'Connected' : 'Offline'}</span>
            </div>
          </div>

          <div className="status-row">
            <span>Audio Capture</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div className={`status-dot ${isListening ? 'live' : 'offline'}`} />
              <span style={{ fontSize: 11 }}>{isListening ? 'Live' : 'Idle'}</span>
            </div>
          </div>

          <div className="status-row">
            <span>Phone</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div className={`status-dot ${mobileConnected ? 'online' : 'offline'}`} />
              <span style={{ fontSize: 11 }}>{mobileConnected ? 'Paired' : 'Not Paired'}</span>
            </div>
          </div>

          <div className="status-row">
            <span>Groq AI</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div className={`status-dot ${serverInfo.hasGroqKey ? 'online' : 'offline'}`} />
              <span style={{ fontSize: 11 }}>{serverInfo.hasGroqKey ? 'Ready' : 'No Key'}</span>
            </div>
          </div>
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
          </div>

          <div className="topbar-actions">
            {ttft > 0 && (
              <span className="ttft-chip">
                ⚡ {(ttft / 1000).toFixed(2)}s TTFT
              </span>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => setIsQrModalOpen(true)}
              style={{ fontSize: 12 }}
            >
              <QrCode size={13} />
              {mobileConnected ? 'Phone Paired ✓' : 'Pair Phone'}
            </button>
          </div>
        </div>

        {/* Content Grid */}
        {activeNav === 'dashboard' ? (
          <div className="content-area">
            {/* LEFT: Audio Capture */}
            <div>
              <AudioCapture
                isListening={isListening}
                setIsListening={setIsListening}
                onAudioChunk={handleAudioChunk}
                onTranscriptUpdate={handleTranscriptUpdate}
              />
            </div>

            {/* RIGHT: AI Answer */}
            <div>
              <AnswerCard
                aiAnswer={aiAnswer}
                aiStatus={aiStatus}
                ttft={ttft}
                totalTime={totalTime}
                onExplainMore={handleExplainMore}
                onClear={handleClear}
              />
            </div>

            {/* FULL WIDTH: Transcript + Controls */}
            <div style={{ gridColumn: '1 / -1' }}>
              <TranscriptCard
                transcript={transcript}
                interimTranscript={interimTranscript}
                setTranscript={setTranscript}
                isPaused={isPaused}
                onTriggerAnswer={triggerAnswer}
                onExplainMore={handleExplainMore}
                onTogglePause={handleTogglePause}
                onClear={handleClear}
              />
            </div>
          </div>
        ) : (
          <div className="content-area">
            <div style={{ gridColumn: '1 / -1' }}>
              <PracticeSimulator onTriggerQuestion={(q) => { triggerAnswer(q); setActiveNav('dashboard'); }} />
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

/* ─────────────────────────────────────────────
   Sub-components embedded in App for simplicity
───────────────────────────────────────────── */

function AnswerCard({ aiAnswer, aiStatus, ttft, totalTime, onExplainMore, onClear }) {
  return (
    <div className="card answer-card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="card-header">
        <div className="card-title">
          <Sparkles />
          AI Copilot Answer
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {ttft > 0 && <span className="ttft-chip">⚡ {(ttft / 1000).toFixed(2)}s</span>}
          {totalTime > 0 && (
            <span className="badge badge-gray" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
              {(totalTime / 1000).toFixed(2)}s total
            </span>
          )}
          {aiStatus === 'done' && <span className="badge badge-green">Done</span>}
        </div>
      </div>

      <div className="card-body" style={{ flex: 1, overflow: 'auto' }}>
        {aiStatus === 'generating' && !aiAnswer && (
          <div className="answer-generating">
            <div className="spinner" />
            Generating answer via Groq streaming...
          </div>
        )}

        {aiAnswer ? (
          <div className="answer-text">{aiAnswer}</div>
        ) : aiStatus !== 'generating' && (
          <div className="answer-empty-state">
            <Sparkles className="answer-empty-icon" />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-600)' }}>
              Ready for Live Answer
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray-400)', maxWidth: 200 }}>
              Answers stream here and sync to your paired phone
            </div>
          </div>
        )}
      </div>

      {(aiAnswer || aiStatus === 'generating') && (
        <div className="card-footer">
          <button className="btn btn-secondary" onClick={onExplainMore} style={{ fontSize: 12 }}>
            <Zap size={12} />
            Explain More
          </button>
          <button className="btn btn-ghost" onClick={onClear} style={{ fontSize: 12 }}>
            <RotateCcw size={13} />
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function TranscriptCard({ transcript, interimTranscript, setTranscript, isPaused, onTriggerAnswer, onExplainMore, onTogglePause, onClear }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">
          <Volume2 />
          Interviewer Speech Stream
          {interimTranscript && (
            <span className="badge badge-blue" style={{ fontSize: 10, marginLeft: 4 }}>
              transcribing...
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-secondary" onClick={onTogglePause} style={{ fontSize: 12 }}>
            {isPaused ? <Play size={13} /> : <Pause size={13} />}
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button className="btn btn-ghost" onClick={onClear} style={{ fontSize: 12 }}>
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
      <div className="card-body">
        <textarea
          className="transcript-area"
          rows={3}
          value={transcript || interimTranscript}
          onChange={e => setTranscript(e.target.value)}
          placeholder="Interviewer speech appears here automatically. You can also type or edit the question directly..."
        />
      </div>
      <div className="card-footer">
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => onTriggerAnswer()} style={{ fontSize: 12 }}>
            <Zap size={13} />
            Answer Now
          </button>
          <button className="btn btn-amber" onClick={onExplainMore} style={{ fontSize: 12 }}>
            Explain More
          </button>
        </div>
        <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>
          {(transcript || interimTranscript)?.length || 0} chars
        </span>
      </div>
    </div>
  );
}
