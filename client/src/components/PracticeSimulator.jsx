import React, { useState } from 'react';
import { Play, Sparkles, Code2, Database, Cpu, MessageSquare } from 'lucide-react';

const PRACTICE_QUESTIONS = [
  { category: 'System Design', title: 'Scale Real-Time WebSocket App', question: 'How would you architect a real-time notification system to handle 1 million concurrent WebSocket connections?' },
  { category: 'React', title: 'Virtual DOM & Reconciliation', question: 'Explain how React\'s Virtual DOM diffing algorithm works and how useMemo prevents unnecessary renders.' },
  { category: 'Node.js', title: 'Event Loop & Libuv', question: 'Explain the Node.js event loop phases, microtasks vs macrotasks, and how to prevent thread starvation.' },
  { category: 'SQL & DB', title: 'Database Indexing Tradeoffs', question: 'How do B-Tree indexes work in SQL databases, and what are the query performance tradeoffs of over-indexing?' },
  { category: 'Behavioral', title: 'Candidate Background Intro', question: 'Tell me about yourself, your recent engineering projects, and your technical background.' },
  { category: 'System Design', title: 'Distributed Caching Strategy', question: 'What is Cache-Aside vs Write-Through caching pattern, and how do you handle Redis cache invalidation?' },
  { category: 'React', title: 'State Management Architecture', question: 'Compare React Context API vs Redux Toolkit vs Zustand for large-scale enterprise applications.' },
  { category: 'Node.js', title: 'Streams & Backpressure', question: 'What is backpressure in Node.js streams and how do pipe and transform streams handle memory overhead?' },
  { category: 'SQL & DB', title: 'PostgreSQL Connection Pooling', question: 'Why is PgBouncer necessary for high-concurrency Node.js microservices connecting to PostgreSQL?' },
  { category: 'Behavioral', title: 'Technical Conflict Resolution', question: 'Describe a situation where you had a technical disagreement with a teammate regarding system architecture.' },
];

export default function PracticeSimulator({ onTriggerQuestion }) {
  const [selectedCategory, setSelectedCategory] = useState('All');

  const categories = ['All', 'System Design', 'React', 'Node.js', 'SQL & DB', 'Behavioral'];

  const filteredQuestions = selectedCategory === 'All'
    ? PRACTICE_QUESTIONS
    : PRACTICE_QUESTIONS.filter(q => q.category === selectedCategory);

  return (
    <div className="glass-panel p-5 mt-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-heading text-lg font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            Live Practice Interview Test Suite (30-50 Question Bank)
          </h3>
          <p className="text-xs text-slate-400">
            Click any question to simulate interviewer speech and test streaming speed, formatting, and paired mobile display instantly.
          </p>
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-1 bg-slate-900/80 p-1 rounded-xl border border-white/10">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                selectedCategory === cat ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
        {filteredQuestions.map((q, idx) => (
          <div
            key={idx}
            onClick={() => onTriggerQuestion(q.question)}
            className="p-3 bg-slate-900/60 hover:bg-slate-800/80 border border-white/5 hover:border-indigo-500/40 rounded-xl cursor-pointer transition-all flex items-start justify-between gap-3 group"
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="badge badge-indigo text-[10px]">{q.category}</span>
                <span className="text-xs font-semibold text-slate-200 group-hover:text-indigo-300 transition-colors">
                  {q.title}
                </span>
              </div>
              <p className="text-xs text-slate-400 line-clamp-2">"{q.question}"</p>
            </div>
            <button className="p-1.5 rounded-lg bg-indigo-600/20 group-hover:bg-indigo-600 text-indigo-300 group-hover:text-white transition-all shrink-0 mt-1">
              <Play className="w-3.5 h-3.5 fill-current" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
