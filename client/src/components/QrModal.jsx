import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, X, Copy, Check, Wifi, WifiOff } from 'lucide-react';

export default function QrModal({ isOpen, onClose, pairingUrl, sessionId, mobileConnected, mobileCount }) {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(pairingUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, background: 'var(--blue-50)', border: '1px solid var(--blue-100)',
              borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Smartphone size={16} style={{ color: 'var(--blue-600)' }} />
            </div>
            <span className="modal-title">Pair Your Phone</span>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          <div className="qr-box">
            <p style={{ fontSize: 13, color: 'var(--gray-500)', maxWidth: 320 }}>
              Scan the QR code with your phone camera to open the mobile view and see live answers on your phone screen.
            </p>

            {/* QR Code */}
            <div className="qr-frame">
              <QRCodeSVG value={pairingUrl} size={180} level="H" />
            </div>

            {/* Status */}
            {mobileConnected ? (
              <span className="badge badge-green" style={{ fontSize: 12, padding: '4px 12px' }}>
                <Wifi size={12} />
                Phone Paired &amp; Synced ({mobileCount} device)
              </span>
            ) : (
              <span className="badge badge-amber" style={{ fontSize: 12, padding: '4px 12px' }}>
                <WifiOff size={12} />
                Waiting for phone to scan...
              </span>
            )}

            {/* URL Row */}
            <div className="qr-url-row" style={{ width: '100%' }}>
              <span className="qr-url-text">{pairingUrl}</span>
              <button className="btn btn-secondary" onClick={handleCopy} style={{ fontSize: 11, padding: '5px 10px' }}>
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <p style={{ fontSize: 11, color: 'var(--gray-400)' }}>
              Session Code: <strong style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--blue-600)' }}>{sessionId}</strong>
            </p>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
