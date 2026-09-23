import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

function CodeBlockItem({ lang, code }) {
  const [copied, setCopied] = useState(false);

  const fallbackCopy = (text) => {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    } catch (err) {}
  };

  const handleCopy = (e) => {
    e.stopPropagation();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).catch(() => fallbackCopy(code));
    } else {
      fallbackCopy(code);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-lang-label">{lang || 'CODE'}</span>
        <button
          className="code-copy-btn"
          onClick={handleCopy}
          type="button"
          title="Copy code"
        >
          {copied ? <Check size={12} className="text-green" /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="code-block">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function inlineMarkdown(text) {
  if (!text) return text;
  const parts = [];
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={m.index}><em>{m[2]}</em></strong>);
    else if (m[3]) parts.push(<strong key={m.index}>{m[3]}</strong>);
    else if (m[4]) parts.push(<em key={m.index}>{m[4]}</em>);
    else if (m[5]) parts.push(<code key={m.index} className="inline-code">{m[5]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

export default function MarkdownRenderer({ text, isStreaming }) {
  if (!text) return null;

  let raw = text;
  // Automatically close unclosed code blocks during streaming
  const fenceCount = (raw.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) {
    raw = raw + '\n```';
  }

  const lines = raw.split('\n');
  const elements = [];
  let i = 0;
  let keyCounter = 0;
  const k = () => keyCounter++;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <CodeBlockItem
          key={k()}
          lang={lang}
          code={codeLines.join('\n')}
        />
      );
      i++; // skip closing ```
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      elements.push(<h4 key={k()} className="md-h4">{inlineMarkdown(line.slice(4))}</h4>);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h3 key={k()} className="md-h3">{inlineMarkdown(line.slice(3))}</h3>);
      i++; continue;
    }
    if (line.startsWith('# ')) {
      elements.push(<h2 key={k()} className="md-h2">{inlineMarkdown(line.slice(2))}</h2>);
      i++; continue;
    }

    // Bullet lists
    if (line.match(/^[\-\*] /)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[\-\*] /)) {
        items.push(<li key={k()}>{inlineMarkdown(lines[i].replace(/^[\-\*] /, ''))}</li>);
        i++;
      }
      elements.push(<ul key={k()} className="md-ul">{items}</ul>);
      continue;
    }

    // Numbered lists
    if (line.match(/^\d+\. /)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(<li key={k()}>{inlineMarkdown(lines[i].replace(/^\d+\. /, ''))}</li>);
        i++;
      }
      elements.push(<ol key={k()} className="md-ol">{items}</ol>);
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      elements.push(<div key={k()} style={{ height: 6 }} />);
      i++; continue;
    }

    // Paragraph
    elements.push(
      <p key={k()} className="md-p">
        {inlineMarkdown(line)}
      </p>
    );
    i++;
  }

  return (
    <div className="markdown-content">
      {elements}
      {isStreaming && <span className="streaming-cursor" />}
    </div>
  );
}
