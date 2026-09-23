import React, { useState, useEffect } from 'react';
import { User, X, Save, Check, Tag, Plus } from 'lucide-react';

export default function ContextDrawer({ isOpen, onClose, context, onSaveContext }) {
  const [form, setForm] = useState({
    resume: '',
    targetRole: '',
    jobDescription: '',
    projects: '',
    guardrails: '',
    preferredLanguage: 'Python'
  });
  const [vocabulary, setVocabulary] = useState([]);
  const [newTerm, setNewTerm] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (context) setForm({ ...context });
  }, [context]);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/vocabulary')
        .then(r => r.json())
        .then(data => {
          if (data.terms) setVocabulary(data.terms);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  const handleAddTerm = (e) => {
    e.preventDefault();
    if (!newTerm.trim()) return;
    const added = newTerm.split(',').map(t => t.trim()).filter(Boolean);
    fetch('/api/vocabulary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terms: added })
    })
      .then(r => r.json())
      .then(data => {
        if (data.terms) setVocabulary(data.terms);
        setNewTerm('');
      })
      .catch(() => {});
  };

  const handleSave = () => {
    onSaveContext(form);
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 900);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel">
        {/* Header */}
        <div className="drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 30, height: 30, background: 'var(--blue-50)', border: '1px solid var(--blue-100)',
              borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <User size={14} style={{ color: 'var(--blue-600)' }} />
            </div>
            <span className="drawer-title">My Background</span>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="drawer-body">
          <p style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.5 }}>
            Fill in your background so the AI copilot can tailor answers to your experience and target role.
          </p>

          <div className="form-group">
            <label className="form-label">Target Role</label>
            <input
              className="form-input"
              placeholder="e.g. Senior Full Stack Engineer"
              value={form.targetRole}
              onChange={e => setForm(p => ({ ...p, targetRole: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Preferred Coding Language</label>
            <select
              className="form-input"
              value={form.preferredLanguage || 'Python'}
              onChange={e => setForm(p => ({ ...p, preferredLanguage: e.target.value }))}
            >
              <option value="Python">Python (Default for Algorithms & General Coding)</option>
              <option value="SQL">SQL (Databases & Relational Queries)</option>
              <option value="PySpark">PySpark (Data Pipelines & Dataframes)</option>
              <option value="JavaScript / TypeScript">JavaScript / TypeScript (Full Stack & Web)</option>
              <option value="Java">Java</option>
              <option value="C++">C++</option>
            </select>
            <span style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 2 }}>
              Used consistently when the interviewer doesn't specify a language or asks follow-ups.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">Résumé Summary</label>
            <textarea
              className="form-textarea"
              rows={4}
              placeholder="Brief summary of your experience, skills, and years..."
              value={form.resume}
              onChange={e => setForm(p => ({ ...p, resume: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Job Description</label>
            <textarea
              className="form-textarea"
              rows={3}
              placeholder="Paste the job description or role requirements..."
              value={form.jobDescription}
              onChange={e => setForm(p => ({ ...p, jobDescription: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Key Projects</label>
            <textarea
              className="form-textarea"
              rows={4}
              placeholder="List your main projects, technologies used, and impact..."
              value={form.projects}
              onChange={e => setForm(p => ({ ...p, projects: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label className="form-label">AI Guardrails</label>
            <textarea
              className="form-textarea"
              rows={2}
              placeholder="e.g. Don't invent fake metrics. Stick to my actual experience."
              value={form.guardrails}
              onChange={e => setForm(p => ({ ...p, guardrails: e.target.value }))}
            />
          </div>

          <div className="form-group" style={{ borderTop: '1px solid var(--gray-200)', paddingTop: 14, marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                <Tag size={12} style={{ color: 'var(--blue-600)' }} />
                Speech Vocabulary (Deepgram Keyterms)
              </label>
              <span style={{ fontSize: 10, color: 'var(--gray-400)' }}>
                {vocabulary.length} active terms
              </span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--gray-500)', margin: '0 0 8px 0' }}>
              Specialized keywords boosted in Deepgram speech recognition to prevent mishearing.
            </p>

            <form onSubmit={handleAddTerm} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input
                className="form-input"
                style={{ fontSize: 12, padding: '6px 10px' }}
                placeholder="Add term(s), comma-separated (e.g. PySpark, dense_rank)..."
                value={newTerm}
                onChange={e => setNewTerm(e.target.value)}
              />
              <button type="submit" className="btn btn-secondary" style={{ fontSize: 11, padding: '6px 10px', whiteSpace: 'nowrap' }}>
                <Plus size={12} /> Add
              </button>
            </form>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 110, overflowY: 'auto', padding: '4px 0' }}>
              {vocabulary.map((term, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 11,
                    background: 'var(--blue-50)',
                    color: 'var(--blue-700)',
                    border: '1px solid var(--blue-100)',
                    borderRadius: 4,
                    padding: '2px 7px',
                    fontFamily: 'JetBrains Mono, monospace'
                  }}
                >
                  {term}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="drawer-footer">
          <button className="btn btn-secondary" onClick={onClose} style={{ flex: 1 }}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} style={{ flex: 1 }}>
            {saved ? <Check size={13} /> : <Save size={13} />}
            {saved ? 'Saved!' : 'Save Background'}
          </button>
        </div>
      </div>
    </>
  );
}
