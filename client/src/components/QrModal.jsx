import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, X, Copy, Check, Wifi } from 'lucide-react';

export default function QrModal({ isOpen, onClose, pairingUrl, sessionId, mobileConnected, mobileCount }) {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(pairingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 relative text-center shadow-2xl">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-900">
          <X className="w-5 h-5" />
        </button>

        <div className="inline-flex p-3 bg-indigo-50 border border-indigo-100 rounded-2xl mb-3">
          <Smartphone className="w-7 h-7 text-indigo-600" />
        </div>

        <h3 className="font-heading text-lg font-bold text-slate-900 mb-1">Pair Phone Screen</h3>
        <p className="text-xs text-slate-600 mb-4">
          Scan QR code with your phone camera or open the link below on your mobile browser.
        </p>

        <div className="bg-slate-50 p-3.5 border border-slate-200 rounded-2xl inline-block mb-4 shadow-inner">
          <QRCodeSVG value={pairingUrl} size={170} level="H" />
        </div>

        <div className="mb-4">
          {mobileConnected ? (
            <span className="pill-badge pill-badge-green text-xs">
              <Wifi className="w-3.5 h-3.5" /> Phone Paired & Synced ({mobileCount} device)
            </span>
          ) : (
            <span className="pill-badge pill-badge-amber text-xs">
              <Wifi className="w-3.5 h-3.5" /> Waiting for Phone to Scan...
            </span>
          )}
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 mb-3 flex items-center justify-between text-xs font-mono text-slate-800">
          <span className="truncate pr-2 font-medium">{pairingUrl}</span>
          <button onClick={handleCopy} className="btn-secondary py-1 px-2.5 text-[11px] shrink-0">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="text-[11px] text-slate-500">
          Manual Session Code: <strong className="text-indigo-600 font-mono text-xs">{sessionId}</strong>
        </div>
      </div>
    </div>
  );
}
