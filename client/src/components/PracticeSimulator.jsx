import React, { useState, useRef, useEffect } from 'react';
import { Play, ChevronDown, ChevronUp, BookOpen, Sparkles } from 'lucide-react';

const PRACTICE_QUESTIONS = [
  { category: 'System Design', title: 'Scale Real-Time WebSocket App', question: 'How would you architect a real-time notification system to handle 1 million concurrent WebSocket connections?' },
  { category: 'React', title: 'Virtual DOM & Reconciliation', question: "Explain how React's Virtual DOM diffing algorithm works and how useMemo prevents unnecessary renders." },
  { category: 'Node.js', title: 'Event Loop & Libuv', question: 'Explain the Node.js event loop phases, microtasks vs macrotasks, and how to prevent thread starvation.' },
  { category: 'SQL & DB', title: 'Database Indexing Tradeoffs', question: 'How do B-Tree indexes work in SQL databases, and what are the query performance tradeoffs of over-indexing?' },
  { category: 'Behavioral', title: 'Candidate Background Intro', question: 'Tell me about yourself, your recent engineering projects, and your technical background.' },
  { category: 'System Design', title: 'Distributed Caching Strategy', question: 'What is Cache-Aside vs Write-Through caching pattern, and how do you handle Redis cache invalidation?' },
  { category: 'React', title: 'State Management Architecture', question: 'Compare React Context API vs Redux Toolkit vs Zustand for large-scale enterprise applications.' },
  { category: 'Node.js', title: 'Streams & Backpressure', question: 'What is backpressure in Node.js streams and how do pipe and transform streams handle memory overhead?' },
  { category: 'SQL & DB', title: 'PostgreSQL Connection Pooling', question: 'Why is PgBouncer necessary for high-concurrency Node.js microservices connecting to PostgreSQL?' },
  { category: 'Behavioral', title: 'Technical Conflict Resolution', question: 'Describe a situation where you had a technical disagreement with a teammate regarding system architecture.' },
  { category: 'System Design', title: 'Microservices vs Monolith', question: 'When would you choose a microservices architecture over a monolith, and what are the operational tradeoffs?' },
  { category: 'React', title: 'Performance Optimization', question: 'What techniques do you use to optimize a React app with thousands of list items or complex data grids?' },
  { category: 'Node.js', title: 'Authentication & JWT', question: 'How do you implement secure JWT authentication with refresh tokens and token rotation in a Node.js API?' },
  { category: 'SQL & DB', title: 'ACID vs BASE', question: 'Explain ACID vs BASE consistency models and when you would choose NoSQL over SQL for a production system.' },
  { category: 'Behavioral', title: 'Most Challenging Bug', question: 'Describe the most challenging production bug you have debugged and how you systematically resolved it.' },
];

const CATEGORIES = ['All', 'System Design', 'React', 'Node.js', 'SQL & DB', 'Behavioral'];

const CATEGORY_COLORS = {
  'System Design': 'badge-blue',
  'React': 'badge-green',
  'Node.js': 'badge-amber',
  'SQL & DB': 'badge-gray',
  'Behavioral': 'badge-red',
};

export default function PracticeSimulator({ onTriggerQuestion }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const containerRef = useRef(null);

  const filtered = selectedCategory === 'All'
    ? PRACTICE_QUESTIONS
    : PRACTICE_QUESTIONS.filter(q => q.category === selectedCategory);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef}>
      {/* Trigger */}
      <button
        className={`practice-dropdown-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(prev => !prev)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <BookOpen size={15} style={{ color: 'var(--blue-600)' }} />
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--gray-800)' }}>
            Practice Interview Question Bank
          </span>
          <span className="badge badge-blue" style={{ fontSize: 10 }}>
            {PRACTICE_QUESTIONS.length} Questions
          </span>
        </div>
        {isOpen ? <ChevronUp size={14} style={{ color: 'var(--gray-400)' }} /> : <ChevronDown size={14} style={{ color: 'var(--gray-400)' }} />}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="practice-dropdown-panel">
          {/* Category Filter */}
          <div className="practice-filter-bar">
            <span style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600, alignSelf: 'center', marginRight: 4 }}>
              Filter:
            </span>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                className={`filter-chip ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Question List */}
          <div className="practice-question-list">
            {filtered.map((q, idx) => (
              <div
                key={idx}
                className="practice-question-item"
                onClick={() => { onTriggerQuestion(q.question); setIsOpen(false); }}
              >
                <div className="practice-q-content">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                    <span className={`badge ${CATEGORY_COLORS[q.category] || 'badge-gray'}`} style={{ fontSize: 10 }}>
                      {q.category}
                    </span>
                    <span className="practice-q-title">{q.title}</span>
                  </div>
                  <div className="practice-q-text">"{q.question}"</div>
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '5px 8px', fontSize: 11, flexShrink: 0 }}
                  onClick={e => { e.stopPropagation(); onTriggerQuestion(q.question); setIsOpen(false); }}
                >
                  <Play size={11} />
                  Use
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
