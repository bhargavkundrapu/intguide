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
  CheckCircle2
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

  // Dynamic WebSocket URL calculation (supports local dev, production single-port, and deployed cloud services like Render/Railway/ngrok)
  const getWsUrl = () => {
    const isHttps = window.location.protocol === 'https:';
    const wsProtocol = isHttps ? 'wss:' : 'ws:';
    
    // In local Vite dev mode on port 3000, connect to backend port 5000
    if (window.location.port === '3000') {
      return `${wsProtocol}//${window.location.hostname}:5000`;
    }
    
    // In production or deployed cloud (Render, Railway, ngrok, Vercel):
    // Use window.location.host (includes host + port if custom, or omits port if standard 80/443)
    return `${wsProtocol}//${window.location.host}`;
  };

  // Dynamic QR Code Pairing URL calculation
  const getPairingUrl = () => {
    const currentOrigin = window.location.origin;

    // If opened via localhost on Vite (port 3000):
    // Rewrite hostname to local network IP so phone on Wi-Fi can connect
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      if (serverInfo.localIp && serverInfo.localIp !== 'localhost') {
        const port = window.location.port || '5000';
        return `http://${serverInfo.localIp}:${port}/?mode=mobile&session=${sessionId}`;
      }
    }

    // For deployed public apps (Render, Railway, Vercel, ngrok):
    // Use actual browser origin so QR code contains public https URL scannable anywhere in the world!
    return `${currentOrigin}/?mode=mobile&session=${sessionId}`;
  };

  // WebSocket Connection Lifecycle
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
    <div className="min-h-screen bg-[#09090b] text-zinc-100 p-4 md:p-6 flex flex-col justify-between">
      {/* Header Bar */}
      <header className="clean-card p-4 mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600/10 border border-indigo-500/30 rounded-lg text-indigo-400">
            <Zap className="w-5 h-5 fill-current" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-heading text-lg font-bold text-white tracking-tight">
                AI INTERVIEW COPILOT
              </h1>
              <span className="pill-badge pill-badge-green">LIVE COPILOT</span>
            </div>
            <p className="text-xs text-zinc-400">
              Live Sub-Second Speech-to-Answer • Groq Llama 3 • Dual Screen Sync
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsContextDrawerOpen(true)}
            className="btn-secondary text-xs"
          >
            <UserCheck className="w-4 h-4 text-indigo-400" />
            Background Context
          </button>

          <button
            onClick={() => setIsQrModalOpen(true)}
            className={`btn-primary text-xs ${mobileConnected ? 'bg-emerald-600' : ''}`}
          >
            <QrCode className="w-4 h-4" />
            {mobileConnected ? 'Phone Synced' : 'Pair Phone'}
          </button>
        </div>
      </header>

      {/* Main Panel Grid */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        {/* Left Column: Audio Capture + Speech Stream */}
        <div className="lg:col-span-6 space-y-6 flex flex-col">
          <AudioCapture
            isListening={isListening}
            setIsListening={setIsListening}
            onAudioChunk={handleAudioChunk}
            onTranscriptUpdate={handleTranscriptUpdate}
          />

          <div className="clean-card p-5 flex-1 flex flex-col justify-between min-h-[220px]">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-heading text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-indigo-400" />
                  Interviewer Speech Stream
                </h3>
                {interimTranscript && (
                  <span className="text-[11px] font-mono text-indigo-400 animate-pulse">
                    [transcribing...]
                  </span>
                )}
              </div>

              <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl min-h-[120px] text-zinc-200 text-sm leading-relaxed">
                {transcript || interimTranscript ? (
                  <div>
                    <span>{transcript}</span>
                    <span className="text-indigo-400 italic"> {interimTranscript}</span>
                  </div>
                ) : (
                  <span className="text-zinc-500 italic text-xs">
                    Interviewer speech will stream here live... Click "Start Listening" or pick a question below.
                  </span>
                )}
              </div>
            </div>

            {/* Controls Bar */}
            <div className="mt-4 pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button onClick={() => triggerAnswer()} className="btn-primary text-xs">
                  <Zap className="w-4 h-4 fill-current" />
                  Answer Now
                </button>

                <button onClick={handleExplainMore} className="btn-amber text-xs">
                  <PlusCircle className="w-4 h-4" />
                  Explain More
                </button>

                <button onClick={handleTogglePause} className="btn-secondary text-xs">
                  {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
              </div>

              <button onClick={handleClear} className="btn-secondary text-xs text-zinc-400">
                <RotateCcw className="w-4 h-4" /> Clear
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Streamed AI Answer */}
        <div className="lg:col-span-6 flex flex-col">
          <div className="clean-card clean-card-active p-5 flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-400" />
                  <h3 className="font-heading text-base font-bold text-white">Streamed Copilot Answer</h3>
                </div>

                <div className="flex items-center gap-2">
                  {ttft > 0 && (
                    <span className="font-mono text-xs text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                      ⚡ TTFT: {(ttft / 1000).toFixed(2)}s
                    </span>
                  )}
                  {totalTime > 0 && (
                    <span className="text-xs font-mono text-zinc-400">
                      Total: {(totalTime / 1000).toFixed(2)}s
                    </span>
                  )}
                </div>
              </div>

              {/* Answer Container */}
              <div className="min-h-[280px]">
                {aiStatus === 'generating' && !aiAnswer && (
                  <div className="p-8 text-center clean-card my-8">
                    <Zap className="w-8 h-8 text-indigo-400 animate-bounce mx-auto mb-2" />
                    <div className="text-sm font-bold text-white">Generating Low-Latency Answer...</div>
                    <div className="text-xs text-zinc-400 font-mono mt-1">Groq streaming response...</div>
                  </div>
                )}

                {aiAnswer ? (
                  <div className="whitespace-pre-wrap text-zinc-100 font-sans text-sm leading-relaxed">
                    {aiAnswer}
                  </div>
                ) : (
                  aiStatus !== 'generating' && (
                    <div className="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-zinc-800 rounded-xl">
                      <Sparkles className="w-8 h-8 text-zinc-600 mb-2" />
                      <div className="text-sm font-semibold text-zinc-400">Ready for Live Answer</div>
                      <div className="text-xs text-zinc-500 mt-1 max-w-xs">
                        Answers stream here and sync instantly to your phone screen.
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Bottom Status */}
            <div className="mt-4 pt-3 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-indigo-400" />
                <span>{mobileConnected ? `Mobile Synced (${mobileCount} phone)` : 'Phone Disconnected'}</span>
              </div>
              <button onClick={() => setIsQrModalOpen(true)} className="text-indigo-400 font-semibold hover:underline">
                {mobileConnected ? 'Show QR Code' : 'Scan to Connect'}
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Practice Simulator */}
      <PracticeSimulator onTriggerQuestion={triggerAnswer} />

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
