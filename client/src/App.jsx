import React, { useState, useEffect, useRef } from 'react';
import {
  Zap,
  Volume2,
  QrCode,
  UserCheck,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Smartphone,
  PlusCircle,
  Wifi,
  WifiOff,
  Clock,
  Sliders,
  CheckCircle2,
  Edit3
} from 'lucide-react';
import AudioCapture from './components/AudioCapture';
import ContextDrawer from './components/ContextDrawer';
import PracticeSimulator from './components/PracticeSimulator';
import QrModal from './components/QrModal';
import MobileView from './components/MobileView';

export default function App() {
  const urlParams = new URLSearchParams(window.location.search);
  const isMobileMode = urlParams.get('mode') === 'mobile' || window.location.pathname === '/mobile';

  const [sessionId, setSessionId] = useState(() => {
    return urlParams.get('session') || 'SESSION-' + Math.floor(1000 + Math.random() * 9000);
  });

  const [serverInfo, setServerInfo] = useState({
    localIp: 'localhost',
    port: 5000,
    hasGroqKey: true,
    hasOpenAIKey: false,
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

  const wsRef = useRef(null);

  useEffect(() => {
    fetch('/api/info')
      .then((res) => res.json())
      .then((data) => setServerInfo(data))
      .catch(() => {});

    fetch('/api/context')
      .then((res) => res.json())
      .then((data) => setCandidateContext(data))
      .catch(() => {});
  }, []);

  const getWsUrl = () => {
    const isHttps = window.location.protocol === 'https:';
    const wsProtocol = isHttps ? 'wss:' : 'ws:';
    
    if (window.location.port === '3000') {
      return `${wsProtocol}//${window.location.hostname}:5000`;
    }
    
    return `${wsProtocol}//${window.location.host}`;
  };

  const getPairingUrl = () => {
    const currentOrigin = window.location.origin;

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      if (serverInfo.localIp && serverInfo.localIp !== 'localhost') {
        const port = window.location.port || '5000';
        return `http://${serverInfo.localIp}:${port}/?mode=mobile&session=${sessionId}`;
      }
    }

    return `${currentOrigin}/?mode=mobile&session=${sessionId}`;
  };

  useEffect(() => {
    const wsUrl = getWsUrl();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(
        JSON.stringify({
          type: 'register',
          session: sessionId,
          role: isMobileMode ? 'mobile' : 'laptop',
        })
      );

      if (!isMobileMode) {
        ws.send(JSON.stringify({ type: 'start_deepgram_flux' }));
      }
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
              setTranscript((prev) => (prev ? prev + ' ' + data.transcript : data.transcript));
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
      } catch (err) {
        console.error('WS client error:', err);
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [sessionId, isMobileMode]);

  const handleAudioChunk = (blob) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && !isPaused) {
      wsRef.current.send(blob);
    }
  };

  const handleTranscriptUpdate = (text, isFinal) => {
    if (isPaused) return;

    if (isFinal) {
      setTranscript((prev) => (prev ? prev + ' ' + text : text));
      setInterimTranscript('');
    } else {
      setInterimTranscript(text);
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'transcript_sync',
          transcript: text,
          isFinal: isFinal,
        })
      );
    }
  };

  const triggerAnswer = (questionText) => {
    const q = questionText || transcript || interimTranscript;
    if (!q.trim()) return;

    setAiStatus('generating');
    setAiAnswer('');
    setTtft(0);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'trigger_answer',
          question: q,
        })
      );
    }
  };

  const handleExplainMore = () => {
    const q = transcript || interimTranscript || 'Explain technical architecture';
    setAiStatus('generating');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'explain_more',
          question: q,
        })
      );
    }
  };

  const handleClear = () => {
    setTranscript('');
    setInterimTranscript('');
    setAiAnswer('');
    setAiStatus('idle');
    setTtft(0);
    setTotalTime(0);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'clear_answer' }));
    }
  };

  const handleTogglePause = () => {
    const nextState = !isPaused;
    setIsPaused(nextState);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'pause_listening',
          paused: nextState,
        })
      );
    }
  };

  const handleSaveContext = (newContext) => {
    setCandidateContext(newContext);
    fetch('/api/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newContext),
    }).catch(() => {});
  };

  const handleJoinSession = (newSessionCode) => {
    setSessionId(newSessionCode);
  };

  const pairingUrl = getPairingUrl();

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

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 p-4 md:p-6 flex flex-col justify-between">
      {/* Top Header Bar */}
      <header className="clean-card p-4 mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-600 shadow-sm">
            <Zap className="w-5 h-5 fill-indigo-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-heading text-lg font-bold text-slate-900 tracking-tight">
                AI INTERVIEW COPILOT
              </h1>
              <span className="pill-badge pill-badge-green">LIVE STREAMING</span>
            </div>
            <p className="text-xs text-slate-500">
              Sub-Second Real-Time AI Copilot • Groq LLM • Dual Screen Sync
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsContextDrawerOpen(true)}
            className="btn-secondary text-xs"
          >
            <UserCheck className="w-4 h-4 text-indigo-600" />
            Background Context
          </button>

          <button
            onClick={() => setIsQrModalOpen(true)}
            className={`btn-primary text-xs ${mobileConnected ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
          >
            <QrCode className="w-4 h-4" />
            {mobileConnected ? 'Phone Synced' : 'Pair Phone'}
          </button>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        {/* Left Column: Audio Capture + Speech Stream + Practice Question Dropdown */}
        <div className="lg:col-span-6 space-y-6 flex flex-col justify-between">
          <AudioCapture
            isListening={isListening}
            setIsListening={setIsListening}
            onAudioChunk={handleAudioChunk}
            onTranscriptUpdate={handleTranscriptUpdate}
          />

          <div className="clean-card p-5 flex-1 flex flex-col justify-between min-h-[220px]">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-heading text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-indigo-600" />
                  Interviewer Speech Stream
                </h3>
                {interimTranscript && (
                  <span className="text-[11px] font-mono text-indigo-600 font-bold animate-pulse">
                    [transcribing continuous speech...]
                  </span>
                )}
              </div>

              {/* Editable Question Stream Area */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl min-h-[120px] text-slate-900 text-sm leading-relaxed focus-within:border-indigo-500 transition-colors">
                <textarea
                  rows={3}
                  value={transcript || interimTranscript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder='Interviewer speech will stream here live... You can also type or edit the question directly!'
                  className="w-full bg-transparent resize-none border-none focus:outline-none text-slate-900 font-sans text-sm placeholder:text-slate-400"
                />
              </div>
            </div>

            {/* Controls Bar */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button onClick={() => triggerAnswer()} className="btn-primary text-xs shadow-sm">
                  <Zap className="w-4 h-4 fill-current" />
                  Answer Now
                </button>

                <button onClick={handleExplainMore} className="btn-amber text-xs">
                  <PlusCircle className="w-4 h-4" />
                  Explain More
                </button>

                <button onClick={handleTogglePause} className="btn-secondary text-xs">
                  {isPaused ? <Play className="w-4 h-4 text-amber-600" /> : <Pause className="w-4 h-4 text-amber-600" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
              </div>

              <button onClick={handleClear} className="btn-secondary text-xs text-slate-500 hover:text-slate-900">
                <RotateCcw className="w-4 h-4" /> Clear
              </button>
            </div>
          </div>

          {/* Practice Questions Collapsible Dropdown */}
          <PracticeSimulator onTriggerQuestion={triggerAnswer} />
        </div>

        {/* Right Column: Streamed AI Copilot Answer */}
        <div className="lg:col-span-6 flex flex-col">
          <div className="clean-card clean-card-active p-5 flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-heading text-base font-bold text-slate-900">Streamed Copilot Answer</h3>
                </div>

                <div className="flex items-center gap-2">
                  {ttft > 0 && (
                    <span className="font-mono text-xs text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200 font-semibold">
                      ⚡ TTFT: {(ttft / 1000).toFixed(2)}s
                    </span>
                  )}
                  {totalTime > 0 && (
                    <span className="text-xs font-mono text-slate-500">
                      Total: {(totalTime / 1000).toFixed(2)}s
                    </span>
                  )}
                </div>
              </div>

              {/* Streaming Answer Area */}
              <div className="min-h-[300px]">
                {aiStatus === 'generating' && !aiAnswer && (
                  <div className="p-8 text-center clean-card my-8 bg-indigo-50/50 border-indigo-100">
                    <Zap className="w-8 h-8 text-indigo-600 animate-bounce mx-auto mb-2" />
                    <div className="text-sm font-bold text-slate-900">Generating Low-Latency Answer...</div>
                    <div className="text-xs text-slate-500 font-mono mt-1">Groq streaming response...</div>
                  </div>
                )}

                {aiAnswer ? (
                  <div className="whitespace-pre-wrap text-slate-900 font-sans text-sm leading-relaxed">
                    {aiAnswer}
                  </div>
                ) : (
                  aiStatus !== 'generating' && (
                    <div className="h-72 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-200 rounded-xl">
                      <Sparkles className="w-8 h-8 text-slate-400 mb-2" />
                      <div className="text-sm font-semibold text-slate-600">Ready for Live Answer</div>
                      <div className="text-xs text-slate-400 mt-1 max-w-xs">
                        Answers stream here and sync instantly to your paired phone screen.
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Bottom Status Bar */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-indigo-600" />
                <span>{mobileConnected ? `Mobile Synced (${mobileCount} phone)` : 'Phone Disconnected'}</span>
              </div>
              <button onClick={() => setIsQrModalOpen(true)} className="text-indigo-600 font-bold hover:underline">
                {mobileConnected ? 'Show QR Code' : 'Scan to Connect'}
              </button>
            </div>
          </div>
        </div>
      </main>

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
