import React, { useState, useEffect } from 'react';
import { User, Briefcase, FileText, ShieldAlert, Save, Check, X, Sparkles } from 'lucide-react';

export default function ContextDrawer({ isOpen, onClose, context, onSaveContext }) {
  const [formData, setFormData] = useState({
    targetRole: '',
    resume: '',
    projects: '',
    jobDescription: '',
    guardrails: ''
  });

  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (context) {
      setFormData({
        targetRole: context.targetRole || '',
        resume: context.resume || '',
        projects: context.projects || '',
        jobDescription: context.jobDescription || '',
        guardrails: context.guardrails || ''
      });
    }
  }, [context]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onSaveContext(formData);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-xl bg-[#0b0e17] border-l border-white/10 h-full p-6 overflow-y-auto flex flex-col justify-between shadow-2xl">
        <div>
          <div className="flex items-center justify-between pb-4 mb-6 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              <h2 className="font-heading text-xl font-bold text-white">Candidate Background Context</h2>
            </div>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/5">
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-xs text-slate-400 mb-6">
            The AI Copilot uses this exact background context to tailor direct answers. It will never invent candidate experience and strictly flags missing technical details.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-indigo-400" /> Target Role / Seniority
              </label>
              <input
                type="text"
                value={formData.targetRole}
                onChange={(e) => setFormData({ ...formData, targetRole: e.target.value })}
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                placeholder="e.g. Senior Full Stack Engineer / Systems Architect"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-indigo-400" /> Résumé Summary & Core Skills
              </label>
              <textarea
                rows={4}
                value={formData.resume}
                onChange={(e) => setFormData({ ...formData, resume: e.target.value })}
                className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                placeholder="Paste key bullet points from your résumé..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-indigo-400" /> Key Projects & Architectures
              </label>
              <textarea
                rows={3}
                value={formData.projects}
                onChange={(e) => setFormData({ ...formData, projects: e.target.value })}
                className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                placeholder="Summarize 2-3 real past projects with tech stack and metrics..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-indigo-400" /> Target Job Description
              </label>
              <textarea
                rows={3}
                value={formData.jobDescription}
                onChange={(e) => setFormData({ ...formData, jobDescription: e.target.value })}
                className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                placeholder="Paste target job responsibilities..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-amber-400 mb-1 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Strict AI Guardrails
              </label>
              <textarea
                rows={2}
                value={formData.guardrails}
                onChange={(e) => setFormData({ ...formData, guardrails: e.target.value })}
                className="w-full bg-slate-900 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200 focus:outline-none focus:border-amber-500 font-mono"
                placeholder="Custom rules (e.g. Never lie about candidate's past metrics...)"
              />
            </div>

            <div className="pt-4 flex items-center justify-end gap-3">
              <button type="button" onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                {savedSuccess ? <Check className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4" />}
                {savedSuccess ? 'Saved!' : 'Save Background'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
