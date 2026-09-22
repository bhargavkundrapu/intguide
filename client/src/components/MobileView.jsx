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

  // Robust answer parser
  const parseAnswer = (text) => {
    if (!text) return { direct: '', bullets: [], example: '' };

    const directMatch = text.match(/(?:🎯\s*)?(?:\*\*)?(?:Direct Answer:?|Answer:?)(?:\*\*)?\s*([\s\S]*?)(?=\n\n(?:💡|🚀|\*\*Key Points|\*\*Real Example|#)|$)/i);
    const keyPointsMatch = text.match(/(?:💡\s*)?(?:\*\*)?(?:Key Points:?|Key Highlights:?)(?:\*\*)?\s*([\s\S]*?)(?=\n\n(?:🚀|\*\*Real Example|#)|$)/i);
    const exampleMatch = text.match(/(?:🚀\s*)?(?:\*\*)?(?:Real Example:?|Past Project Example:?)(?:\*\*)?\s*([\s\S]*?)$/i);

    let direct = directMatch ? directMatch[1].trim() : '';
    let bullets = [];
    if (keyPointsMatch) {
      bullets = keyPointsMatch[1]
        .split('\n')
        .map(b => b.replace(/^[-*•]\s*/, '').trim())
        .filter(Boolean);
    }
    let example = exampleMatch ? exampleMatch[1].trim() : '';

    if (!direct && !bullets.length && !example) {
      direct = text.trim();
    }

    return { direct, bullets, example };
  };

  const parsed = parseAnswer(aiAnswer);

  return (
    <div className="mobile-clean-container">
      {/* Top Mobile Bar */}
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-indigo-600 fill-indigo-600" />
            <span className="font-heading font-extrabold text-lg tracking-tight text-slate-900">COPILOT HUD</span>
          </div>

          <div className="flex items-center gap-2">
            {ttft > 0 && (
              <span className="font-mono text-xs text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200 font-semibold">
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

        {/* Manual Session Code Pairing Input */}
        {!wsConnected && (
          <div className="bg-white border border-slate-200 p-3 rounded-xl mb-3 flex items-center gap-2 shadow-sm">
            <Key className="w-4 h-4 text-indigo-600 shrink-0" />
            <input
              type="text"
              placeholder="Session Code (e.g. SESSION-1)"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              className="bg-transparent text-xs text-slate-900 focus:outline-none flex-1 font-mono font-medium"
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
          <div className="bg-white border border-indigo-200 rounded-xl p-3 mb-4 shadow-sm">
            <div className="text-[10px] uppercase font-bold text-indigo-600 mb-0.5 tracking-wider">Interviewer Question</div>
            <div className="text-sm font-semibold text-slate-900 line-clamp-2">"{question}"</div>
          </div>
        ) : (
          <div className="bg-slate-100/60 border border-slate-200/80 rounded-xl p-3 mb-4 text-center">
            <div className="text-xs text-slate-500 italic">Listening for live interviewer question...</div>
          </div>
        )}
      </div>

      {/* Main Streaming Answer Container */}
      <div className="flex-1 overflow-y-auto space-y-4 my-2">
        {aiStatus === 'generating' && !aiAnswer && (
          <div className="p-8 text-center clean-card animate-pulse shadow-sm">
            <Zap className="w-8 h-8 text-indigo-600 mx-auto mb-2 animate-bounce" />
            <div className="text-base font-bold text-slate-900">Generating Answer Stream...</div>
            <div className="text-xs text-slate-500 font-mono mt-1">Sub-second response arriving...</div>
          </div>
        )}

        {aiAnswer ? (
          <div className="space-y-4">
            {/* Direct Answer (Huge Font for 1-Second Scanning) */}
            {parsed.direct && (
              <div className="mobile-answer-direct clean-card p-5 rounded-2xl">
                {parsed.direct}
              </div>
            )}

            {/* Key Bullet Points */}
            {parsed.bullets.length > 0 && (
              <div className="clean-card p-4 space-y-2">
                <div className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-2">Key Points</div>
                {parsed.bullets.map((b, i) => (
                  <div key={i} className="mobile-answer-bullet flex items-start gap-2">
                    <span className="text-indigo-600 font-bold shrink-0">•</span>
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Real Example Box */}
            {parsed.example && (
              <div className="mobile-answer-example font-mono">
                <div className="text-[11px] font-bold text-indigo-700 mb-1 uppercase tracking-wider">Past Project Example</div>
                {parsed.example}
              </div>
            )}
          </div>
        ) : (
          aiStatus !== 'generating' && (
            <div className="h-56 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-200 rounded-2xl">
              <Zap className="w-8 h-8 text-slate-400 mb-2" />
              <div className="text-sm font-semibold text-slate-600">Ready for Live Answer</div>
              <div className="text-xs text-slate-400 mt-1">Tap "Answer Now" below or speak into laptop</div>
            </div>
          )
        )}
      </div>

      {/* Touch Action Buttons */}
      <div className="pt-3 border-t border-slate-200 grid grid-cols-4 gap-2">
        <button
          onClick={() => onTriggerAnswer(question)}
          className="btn-primary py-3 flex-col text-[11px] gap-1 rounded-xl shadow-md"
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
            isPaused ? 'bg-amber-100 text-amber-800 border-amber-300' : ''
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
