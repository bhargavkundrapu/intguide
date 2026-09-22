import React, { useState, useEffect } from 'react';
import { User, X, Save, Check } from 'lucide-react';

export default function ContextDrawer({ isOpen, onClose, context, onSaveContext }) {
  const [form, setForm] = useState({
    resume: '',
    targetRole: '',
    jobDescription: '',
    projects: '',
    guardrails: ''
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (context) setForm({ ...context });
  }, [context]);

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
