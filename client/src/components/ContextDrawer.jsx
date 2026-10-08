import React, { useState, useEffect, useRef } from 'react';
import {
  User, X, Save, Check, Tag, Plus, FileText, Upload,
  Trash2, ChevronDown, ChevronUp, Search, Sparkles, BookOpen,
  AlertCircle, RefreshCw
} from 'lucide-react';

const GUARDRAIL_PRESETS = [
  { label: '+ 3 Concise Bullets', text: 'Structure answers in maximum 3 crisp bullet points starting with the core technical concept.' },
  { label: '+ Clean Code First', text: 'Provide a clean, production-grade code block first, followed by 2 sentences explaining key logic.' },
  { label: '+ Senior Staff Tone', text: 'Answer like a Senior Staff Engineer: discuss architectural trade-offs, edge cases, and scalability.' },
  { label: '+ Big-O Complexity', text: 'Always conclude with explicit Time Complexity O(...) and Space Complexity O(...).' },
  { label: '+ Production Metrics', text: 'Emphasize real-world production metrics, latency budgets, and memory efficiency.' }
];

export default function ContextDrawer({ isOpen, onClose, context, onSaveContext }) {
  const [form, setForm] = useState({
    resume: '',
    targetRole: '',
    jobDescription: '',
    projects: '',
    guardrails: '',
    preferredLanguage: 'Python'
  });
  const [pdfKnowledge, setPdfKnowledge] = useState(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [pdfSuccess, setPdfSuccess] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSearch, setPreviewSearch] = useState('');
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedText, setPastedText] = useState('');

  const [vocabulary, setVocabulary] = useState([]);
  const [newTerm, setNewTerm] = useState('');
  const [saved, setSaved] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    if (context) {
      setForm({
        resume: context.resume || '',
        targetRole: context.targetRole || '',
        jobDescription: context.jobDescription || '',
        projects: context.projects || '',
        guardrails: context.guardrails || '',
        preferredLanguage: context.preferredLanguage || 'Python'
      });
      if (context.pdfKnowledge) {
        setPdfKnowledge(context.pdfKnowledge);
      }
    }
  }, [context]);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/vocabulary')
        .then(r => r.json())
        .then(data => {
          if (data.terms) setVocabulary(data.terms);
        })
        .catch(() => {});

      fetch('/api/context')
        .then(r => r.json())
        .then(data => {
          if (data.pdfKnowledge) setPdfKnowledge(data.pdfKnowledge);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  const handlePdfUpload = (file) => {
    if (!file) return;
    setPdfUploading(true);
    setPdfError('');
    setPdfSuccess('');

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result;
        const res = await fetch('/api/context/upload-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            fileBase64: base64
          })
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || 'Failed to process PDF file.');
        }

        const newPdfInfo = {
          fileName: data.fileName,
          qaCount: data.qaCount,
          qaPairs: data.qaPairs || [],
          uploadedAt: Date.now(),
          hasText: true
        };
        setPdfKnowledge(newPdfInfo);
        setPdfSuccess(`Loaded "${data.fileName}" (${data.qaCount} Q&A pairs extracted)!`);

        // Refresh technical vocabulary if terms were boosted
        fetch('/api/vocabulary')
          .then(r => r.json())
          .then(d => { if (d.terms) setVocabulary(d.terms); })
          .catch(() => {});
      } catch (err) {
        setPdfError(err.message || 'Error uploading PDF file.');
      } finally {
        setPdfUploading(false);
      }
    };
    reader.onerror = () => {
      setPdfError('Failed to read the selected file.');
      setPdfUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handlePastedUpload = async () => {
    if (!pastedText.trim()) return;
    setPdfUploading(true);
    setPdfError('');
    setPdfSuccess('');
    try {
      const res = await fetch('/api/context/upload-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'Pasted_QnA_Notes.txt',
          rawText: pastedText
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to parse text.');

      setPdfKnowledge({
        fileName: data.fileName,
        qaCount: data.qaCount,
        qaPairs: data.qaPairs || [],
        uploadedAt: Date.now(),
        hasText: true
      });
      setPdfSuccess(`Successfully extracted ${data.qaCount} Q&A pairs from text!`);
      setPasteMode(false);
      setPastedText('');

      fetch('/api/vocabulary')
        .then(r => r.json())
        .then(d => { if (d.terms) setVocabulary(d.terms); })
        .catch(() => {});
    } catch (err) {
      setPdfError(err.message || 'Error processing pasted text.');
    } finally {
      setPdfUploading(false);
    }
  };

  const handleClearPdf = async () => {
    try {
      await fetch('/api/context/clear-pdf', { method: 'POST' });
      setPdfKnowledge(null);
      setPdfSuccess('');
      setPdfError('');
      setPreviewOpen(false);
    } catch (err) {}
  };

  const appendGuardrailPreset = (presetText) => {
    setForm(p => ({
      ...p,
      guardrails: p.guardrails ? `${p.guardrails.trim()} ${presetText}` : presetText
    }));
  };

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
    onSaveContext({
      ...form,
      pdfKnowledge
    });
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 900);
  };

  if (!isOpen) return null;

  const filteredQa = (pdfKnowledge?.qaPairs || []).filter(item => {
    if (!previewSearch.trim()) return true;
    const s = previewSearch.toLowerCase();
    return item.question.toLowerCase().includes(s) || item.answer.toLowerCase().includes(s);
  });

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel" style={{ width: 440 }}>
        {/* Header */}
        <div className="drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, background: 'var(--blue-50)', border: '1px solid var(--blue-100)',
              borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <User size={15} style={{ color: 'var(--blue-600)' }} />
            </div>
            <div>
              <div className="drawer-title">My Background & Skill Q&A</div>
              <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Role profile, PDF knowledge & AI guardrails</div>
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="drawer-body">
          {/* Target Role & Language */}
          <div className="form-group">
            <label className="form-label">Target Role</label>
            <input
              className="form-input"
              placeholder="e.g. Senior Full Stack Engineer / Senior Data Engineer"
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
          </div>

          {/* ══════════════════════════════════════════════
              SKILL Q&A KNOWLEDGE BASE (PDF UPLOAD)
          ══════════════════════════════════════════════ */}
          <div className="form-group" style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: 14
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, color: 'var(--gray-900)' }}>
                <BookOpen size={14} style={{ color: '#0284c7' }} />
                Skill Q&A Knowledge Base (PDF)
              </label>
              {pdfKnowledge?.fileName && (
                <span className="badge badge-emerald" style={{ fontSize: 10 }}>
                  Active ✓
                </span>
              )}
            </div>

            <p style={{ fontSize: 11, color: 'var(--gray-600)', margin: '0 0 10px 0', lineHeight: 1.45 }}>
              Include a PDF with interview questions & answers for this job.
              <strong> If the interviewer asks a question in this PDF, the AI answers strictly from the PDF.</strong> If out of the PDF, the AI generates a new answer—completely guided by your AI Guardrails prompt.
            </p>

            {/* Hidden File Input */}
            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf,.txt,.md"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handlePdfUpload(f);
                e.target.value = '';
              }}
            />

            {/* Active PDF Card */}
            {pdfKnowledge?.fileName ? (
              <div className="pdf-card-active">
                <div className="pdf-card-header">
                  <div className="pdf-card-meta">
                    <div className="pdf-card-icon">
                      <FileText size={18} />
                    </div>
                    <div>
                      <div className="pdf-card-filename" title={pdfKnowledge.fileName}>
                        {pdfKnowledge.fileName}
                      </div>
                      <div className="pdf-card-sub">
                        {pdfKnowledge.qaCount > 0 ? `${pdfKnowledge.qaCount} Q&A pairs indexed` : 'PDF text indexed'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => setPreviewOpen(!previewOpen)}
                    >
                      {previewOpen ? <ChevronUp size={12} /> : <EyeIcon size={12} />}
                      {previewOpen ? 'Hide' : 'View'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: '3px 6px', color: '#dc2626' }}
                      title="Remove PDF knowledge base"
                      onClick={handleClearPdf}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Preview Accordion */}
                {previewOpen && (
                  <div className="pdf-preview-box">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'sticky', top: 0, background: 'var(--white)', paddingBottom: 4 }}>
                      <Search size={12} style={{ color: 'var(--gray-400)' }} />
                      <input
                        className="form-input"
                        placeholder="Search questions in PDF..."
                        style={{ fontSize: 11, padding: '4px 8px', flex: 1 }}
                        value={previewSearch}
                        onChange={e => setPreviewSearch(e.target.value)}
                      />
                      <span style={{ fontSize: 10, color: 'var(--gray-400)' }}>
                        {filteredQa.length} items
                      </span>
                    </div>

                    {filteredQa.length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', textAlign: 'center', padding: '10px 0' }}>
                        No questions matched "{previewSearch}"
                      </div>
                    ) : (
                      filteredQa.map((item, idx) => (
                        <div key={item.id || idx} className="pdf-qa-item">
                          <div className="pdf-qa-q">
                            <span style={{ color: '#0284c7', fontWeight: 700 }}>Q{idx + 1}:</span>
                            <span>{item.question}</span>
                          </div>
                          <div className="pdf-qa-a">
                            {item.answer.length > 180 ? item.answer.slice(0, 180) + '...' : item.answer}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                  <span style={{ fontSize: 10, color: '#166534' }}>
                    ✓ AI will answer using this PDF when questions match
                  </span>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 10, padding: '2px 8px', background: '#ffffff' }}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={pdfUploading}
                  >
                    Replace PDF
                  </button>
                </div>
              </div>
            ) : (
              /* Dropzone / Upload Box */
              <>
                <div
                  className={`pdf-upload-dropzone ${isDragging ? 'dragover' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setIsDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) handlePdfUpload(file);
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, background: '#eff6ff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563eb'
                  }}>
                    {pdfUploading ? <RefreshCw className="spinner" size={16} /> : <Upload size={16} />}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-800)' }}>
                      {pdfUploading ? 'Extracting Q&A from PDF...' : 'Upload Interview Q&A PDF'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--gray-500)', marginTop: 2 }}>
                      Click or drag & drop PDF (.pdf, .txt)
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
                  <button
                    type="button"
                    style={{
                      background: 'none', border: 'none', color: 'var(--blue-600)',
                      fontSize: 11, cursor: 'pointer', textDecoration: 'underline'
                    }}
                    onClick={() => setPasteMode(!pasteMode)}
                  >
                    {pasteMode ? 'Cancel paste text' : 'Or paste Q&A text directly'}
                  </button>
                </div>

                {pasteMode && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <textarea
                      className="form-textarea"
                      rows={4}
                      placeholder={`Paste Q&A text here, e.g.:\nQ1: What is a broadcast join in PySpark?\nA1: A broadcast join sends the small table to all nodes to eliminate shuffles.\n\nQ2: How to handle skew with salting?\nA2: Add a random prefix 0-N to the join key...`}
                      value={pastedText}
                      onChange={e => setPastedText(e.target.value)}
                      style={{ fontSize: 12 }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: 11, alignSelf: 'flex-end', padding: '4px 10px' }}
                      onClick={handlePastedUpload}
                      disabled={pdfUploading || !pastedText.trim()}
                    >
                      {pdfUploading ? 'Extracting...' : 'Extract Q&A Pairs'}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Error / Success Notifications */}
            {pdfError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626', fontSize: 11, marginTop: 6 }}>
                <AlertCircle size={12} /> {pdfError}
              </div>
            )}
            {pdfSuccess && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#16a34a', fontSize: 11, marginTop: 6 }}>
                <Check size={12} /> {pdfSuccess}
              </div>
            )}
          </div>

          {/* ══════════════════════════════════════════════
              AI GUARDRAILS (PROMPT GOVERNOR)
          ══════════════════════════════════════════════ */}
          <div className="form-group" style={{
            background: '#faf5ff',
            border: '1px solid #e9d5ff',
            borderRadius: 10,
            padding: 14
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, color: '#6b21a8' }}>
                <Sparkles size={14} style={{ color: '#9333ea' }} />
                AI Guardrails (Response Governor)
              </label>
              <span className="badge badge-purple" style={{ fontSize: 10 }}>
                High Priority
              </span>
            </div>

            <p style={{ fontSize: 11, color: '#6b21a8', margin: '0 0 8px 0', lineHeight: 1.45 }}>
              Controls <strong>HOW</strong> answers are generated (tone, length, structure, and constraints).
              Applied to both PDF-sourced answers and new AI-generated answers.
            </p>

            {/* Quick Preset Suggestion Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {GUARDRAIL_PRESETS.map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="guardrail-chip"
                  onClick={() => appendGuardrailPreset(chip.text)}
                  title={`Click to add: "${chip.text}"`}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <textarea
              className="form-textarea"
              rows={3}
              placeholder="e.g. Structure answers in 3 crisp bullets. Give clean Python code first. Never invent metrics or employers. Focus on production scale."
              value={form.guardrails}
              onChange={e => setForm(p => ({ ...p, guardrails: e.target.value }))}
              style={{ background: '#ffffff', borderColor: '#d8b4fe' }}
            />
          </div>

          {/* Résumé & Job Description */}
          <div className="form-group">
            <label className="form-label">Résumé Summary</label>
            <textarea
              className="form-textarea"
              rows={3}
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
              rows={3}
              placeholder="List your main projects, technologies used, and impact..."
              value={form.projects}
              onChange={e => setForm(p => ({ ...p, projects: e.target.value }))}
            />
          </div>

          {/* Speech Vocabulary */}
          <div className="form-group" style={{ borderTop: '1px solid var(--gray-200)', paddingTop: 14 }}>
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
              Specialized keywords boosted in Deepgram speech recognition (auto-boosted from your PDF!).
            </p>

            <form onSubmit={handleAddTerm} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input
                className="form-input"
                style={{ fontSize: 12, padding: '6px 10px' }}
                placeholder="Add term(s), comma-separated (e.g. PySpark, salting)..."
                value={newTerm}
                onChange={e => setNewTerm(e.target.value)}
              />
              <button type="submit" className="btn btn-secondary" style={{ fontSize: 11, padding: '6px 10px', whiteSpace: 'nowrap' }}>
                <Plus size={12} /> Add
              </button>
            </form>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 90, overflowY: 'auto', padding: '4px 0' }}>
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

function EyeIcon({ size = 12 }) {
  return <Search size={size} />;
}
