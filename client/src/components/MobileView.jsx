import React, { useState } from 'react';
import { Zap, Play, Pause, RotateCcw, PlusCircle, Wifi, WifiOff, Key, Check } from 'lucide-react';

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

  // Parse structured AI answer
  const parseAnswer = (text) => {
    if (!text) return { direct: '', bullets: [], example: '' };

    const directMatch = text.match(/🎯 \*\*Direct Answer:\*\*\s*([\s\S]*?)(?=\n\n💡|\n\n🚀|$)/i);
    const keyPointsMatch = text.match(/💡 \*\*Key Points:\*\*\s*([\s\S]*?)(?=\n\n🚀|$)/i);
    const exampleMatch = text.match(/🚀 \*\*Real Example:\*\*\s*([\s\S]*?)$/i);

    const direct = directMatch ? directMatch[1].trim() : '';
    let bullets = [];
    if (keyPointsMatch) {
      bullets = keyPointsMatch[1]
        .split('\n')
        .map(b => b.replace(/^[-*•]\s*/, '').trim())
        .filter(Boolean);
    }
    const example = exampleMatch ? exampleMatch[1].trim() : '';

    if (!direct && !bullets.length && !example) {
      return { direct: text, bullets: [], example: '' };
    }

    return { direct, bullets, example };
  };

  const parsed = parseAnswer(aiAnswer);

  return (
    <div className="mobile-clean-container">
      {/* Top Mobile Bar */}
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-indigo-400 fill-indigo-400" />
            <span className="font-heading font-extrabold text-lg tracking-tight">COPILOT HUD</span>
          </div>

          <div className="flex items-center gap-2">
            {ttft > 0 && (
              <span className="font-mono text-xs text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                ⚡ {(ttft / 1000).toFixed(2)}s
              </span>
            )}
            {wsConnected ? (
              <span className="pill-badge pill-badge-green text-xs">
                <Wifi className="w-3 h-3" /> SYNCED
              </span>
            ) : (
              <span className="pill-badge pill-badge-amber text-xs">
                <WifiOff className="w-3 h-3" /> CONNECTING
              </span>
            )}
          </div>
        </div>

        {/* Manual Session Pairing Input if disconnected */}
        {!wsConnected && (
          <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl mb-3 flex items-center gap-2">
            <Key className="w-4 h-4 text-indigo-400 shrink-0" />
            <input
              type="text"
              placeholder="Enter Session Code (e.g. SESSION-1)"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              className="bg-transparent text-xs text-white focus:outline-none flex-1 font-mono"
            />
            <button
              onClick={() => { if (manualCode && onJoinSession) onJoinSession(manualCode); }}
              className="btn-primary py-1 px-3 text-xs"
            >
              Join
            </button>
          </div>
        )}

        {/* Question Banner */}
        {question ? (
          <div className="bg-zinc-900 border border-indigo-500/30 rounded-xl p-3 mb-4">
            <div className="text-[10px] uppercase font-bold text-indigo-400 mb-0.5">Interviewer Question</div>
            <div className="text-sm font-semibold text-zinc-100 line-clamp-2">"{question}"</div>
          </div>
        ) : (
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3 mb-4 text-center">
            <div className="text-xs text-zinc-500 italic">Listening for live interviewer question...</div>
          </div>
        )}
      </div>

      {/* Main Streaming Answer Display */}
      <div className="flex-1 overflow-y-auto space-y-4 my-2">
        {aiStatus === 'generating' && !aiAnswer && (
          <div className="p-8 text-center clean-card animate-pulse">
            <Zap className="w-8 h-8 text-indigo-400 mx-auto mb-2 animate-bounce" />
            <div className="text-base font-bold text-white">Generating Answer...</div>
            <div className="text-xs text-zinc-400 font-mono">Stream starting in ms...</div>
          </div>
        )}

        {aiAnswer ? (
          <div className="space-y-4">
            {/* Direct Answer (Huge Font for 1-Second Scanning) */}
            {parsed.direct && (
              <div className="mobile-answer-direct clean-card p-5 border-indigo-500/40">
                {parsed.direct}
              </div>
            )}

            {/* Key Bullet Points */}
            {parsed.bullets.length > 0 && (
              <div className="clean-card p-4 space-y-2">
                <div className="text-xs font-bold uppercase text-zinc-400 mb-2">Key Points</div>
                {parsed.bullets.map((b, i) => (
                  <div key={i} className="mobile-answer-bullet flex items-start gap-2">
                    <span className="text-indigo-400 font-bold shrink-0">•</span>
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Real Example Box */}
            {parsed.example && (
              <div className="mobile-answer-example font-mono">
                <div className="text-[11px] font-bold text-indigo-400 mb-1">Past Project Example</div>
                {parsed.example}
              </div>
            )}
          </div>
        ) : (
          aiStatus !== 'generating' && (
            <div className="h-56 flex flex-col items-center justify-center text-center p-6 border border-dashed border-zinc-800 rounded-2xl">
              <Zap className="w-8 h-8 text-zinc-600 mb-2" />
              <div className="text-sm font-semibold text-zinc-400">Ready for Live Answer</div>
              <div className="text-xs text-zinc-500 mt-1">Tap "Answer Now" below or speak into laptop</div>
            </div>
          )
        )}
      </div>

      {/* Bottom Control Bar (Touch Targets) */}
      <div className="pt-3 border-t border-zinc-800 grid grid-cols-4 gap-2">
        <button
          onClick={() => onTriggerAnswer(question)}
          className="btn-primary py-3 flex-col text-[11px] gap-1 rounded-xl"
        >
          <Zap className="w-4 h-4 fill-current" />
          <span>Answer Now</span>
        </button>

        <button
          onClick={onExplainMore}
          className="btn-amber py-3 flex-col text-[11px] gap-1 rounded-xl"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Explain</span>
        </button>

        <button
          onClick={onTogglePause}
          className={`btn-secondary py-3 flex-col text-[11px] gap-1 rounded-xl ${
            isPaused ? 'bg-amber-500/20 text-amber-300' : ''
          }`}
        >
          {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          <span>{isPaused ? 'Resume' : 'Pause'}</span>
        </button>

        <button
          onClick={onClear}
          className="btn-danger py-3 flex-col text-[11px] gap-1 rounded-xl"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Clear</span>
        </button>
      </div>
    </div>
  );
}
