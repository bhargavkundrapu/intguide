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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-[#121215] border border-zinc-800 rounded-2xl p-6 relative text-center shadow-2xl">
        <button onClick={onClose} className="absolute top-4 right-4 text-zinc-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>

        <div className="inline-flex p-3 bg-indigo-600/10 rounded-xl mb-3">
          <Smartphone className="w-7 h-7 text-indigo-400" />
        </div>

        <h3 className="font-heading text-lg font-bold text-white mb-1">Pair Phone Screen</h3>
        <p className="text-xs text-zinc-400 mb-4">
          Scan QR code with your phone or open the link below on your phone connected to the same Wi-Fi.
        </p>

        <div className="bg-white p-3 rounded-xl inline-block mb-4">
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

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 mb-3 flex items-center justify-between text-xs font-mono text-zinc-300">
          <span className="truncate pr-2">{pairingUrl}</span>
          <button onClick={handleCopy} className="btn-secondary py-1 px-2.5 text-[11px] shrink-0">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="text-[11px] text-zinc-500">
          Manual Session Code: <strong className="text-indigo-400 font-mono text-xs">{sessionId}</strong>
        </div>
      </div>
    </div>
  );
}
