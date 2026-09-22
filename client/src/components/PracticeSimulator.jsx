import React, { useState, useRef, useEffect } from 'react';
import { Play, Sparkles, ChevronDown, ChevronUp, BookOpen } from 'lucide-react';

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
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const dropdownRef = useRef(null);

  const categories = ['All', 'System Design', 'React', 'Node.js', 'SQL & DB', 'Behavioral'];

  const filteredQuestions = selectedCategory === 'All'
    ? PRACTICE_QUESTIONS
    : PRACTICE_QUESTIONS.filter(q => q.category === selectedCategory);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative mt-4" ref={dropdownRef}>
      {/* Collapsible Dropdown Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full btn-secondary py-3 px-4 flex items-center justify-between shadow-sm hover:border-indigo-400 transition-all rounded-xl"
      >
        <div className="flex items-center gap-2.5">
          <BookOpen className="w-4 h-4 text-indigo-600" />
          <span className="font-heading font-semibold text-sm text-slate-900">
            Practice Interview Question Bank (30+ Questions)
          </span>
          <span className="pill-badge pill-badge-indigo text-[11px]">CLICK TO EXPAND</span>
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>

      {/* Expanded Question Menu */}
      {isOpen && (
        <div className="absolute bottom-full mb-2 left-0 right-0 z-40 bg-white border border-slate-200 rounded-2xl p-4 shadow-xl animate-fade-in max-h-80 overflow-y-auto">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
            <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Select a question to trigger live STT & LLM streaming
            </div>

            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all ${
                    selectedCategory === cat ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Question List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {filteredQuestions.map((q, idx) => (
              <div
                key={idx}
                onClick={() => {
                  onTriggerQuestion(q.question);
                  setIsOpen(false);
                }}
                className="p-3 bg-slate-50 hover:bg-indigo-50/70 border border-slate-200/80 hover:border-indigo-400 rounded-xl cursor-pointer transition-all flex items-start justify-between gap-3 group"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="pill-badge pill-badge-indigo text-[10px]">{q.category}</span>
                    <span className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">
                      {q.title}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">"{q.question}"</p>
                </div>
                <button className="p-1.5 rounded-lg bg-indigo-100 text-indigo-700 group-hover:bg-indigo-600 group-hover:text-white transition-all shrink-0 mt-1">
                  <Play className="w-3.5 h-3.5 fill-current" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
