import React, { useState, useEffect, useRef } from 'react';
import { Mic, Monitor, Volume2, AlertCircle, CheckCircle, StopCircle, Headphones, RefreshCw } from 'lucide-react';

export default function AudioCapture({
  onAudioChunk,
  isListening,
  setIsListening,
  onTranscriptUpdate
}) {
  // ── Tab Audio (Interviewer) State ──
  const [isTabActive, setIsTabActive] = useState(false);
  const [tabTrackLabel, setTabTrackLabel] = useState('');
  const [tabError, setTabError] = useState('');

  // ── Mic Audio (Candidate) State ──
  const [isMicActive, setIsMicActive] = useState(false);
  const [micTrackLabel, setMicTrackLabel] = useState('');
  const [micError, setMicError] = useState('');
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState('');

  // ── Stream & Recorder Refs ──
  const tabStreamRef = useRef(null);
  const tabRecorderRef = useRef(null);
  const tabAudioCtxRef = useRef(null);
  const tabAnalyserRef = useRef(null);
  const tabCanvasRef = useRef(null);

  const micStreamRef = useRef(null);
  const micRecorderRef = useRef(null);
  const micAudioCtxRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const micCanvasRef = useRef(null);

  // Load available microphones
  const loadAudioDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter(d => d.kind === 'audioinput');
      setAudioDevices(mics);
      if (mics.length > 0 && !selectedMicId) {
        setSelectedMicId(mics[0].deviceId);
      }
    } catch (e) {}
  };

  useEffect(() => {
    loadAudioDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', loadAudioDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', loadAudioDevices);
    };
  }, []);

  // Sync overall isListening with stream states
  useEffect(() => {
    setIsListening(isTabActive || isMicActive);
  }, [isTabActive, isMicActive, setIsListening]);

  // ── Helper to start MediaRecorder on a stream ──
  const createRecorder = (stream, sourceTag) => {
    const candidateTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      ''
    ];
    const selectedType = candidateTypes.find(t => !t || MediaRecorder.isTypeSupported(t));
    const recorder = selectedType
      ? new MediaRecorder(stream, { mimeType: selectedType })
      : new MediaRecorder(stream);

    recorder.ondataavailable = async (e) => {
      if (e.data.size > 0 && onAudioChunk) {
        // Tag chunk: 0x01 = interviewer, 0x02 = candidate
        const prefixByte = sourceTag === 'interviewer' ? 1 : 2;
        const arrayBuf = await e.data.arrayBuffer();
        const framed = new Uint8Array(arrayBuf.byteLength + 1);
        framed[0] = prefixByte;
        framed.set(new Uint8Array(arrayBuf), 1);
        onAudioChunk(framed, sourceTag);
      }
    };
    recorder.start(250);
    return recorder;
  };

  // ── Waveform visualizer helper ──
  useEffect(() => {
    let animId;
    const draw = () => {
      // Tab canvas
      if (tabCanvasRef.current) {
        const ctx = tabCanvasRef.current.getContext('2d');
        const w = tabCanvasRef.current.width;
        const h = tabCanvasRef.current.height;
        if (tabAnalyserRef.current && isTabActive) {
          const buf = tabAnalyserRef.current.frequencyBinCount;
          const data = new Uint8Array(buf);
          tabAnalyserRef.current.getByteFrequencyData(data);
          ctx.clearRect(0, 0, w, h);
          const bw = (w / buf) * 2.5;
          let x = 0;
          for (let i = 0; i < buf; i++) {
            const bh = (data[i] / 255) * h;
            ctx.fillStyle = '#2563eb';
            ctx.fillRect(x, h - bh, bw, bh);
            x += bw + 1;
          }
        } else {
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(0, h / 2 - 1, w, 2);
        }
      }

      // Mic canvas
      if (micCanvasRef.current) {
        const ctx = micCanvasRef.current.getContext('2d');
        const w = micCanvasRef.current.width;
        const h = micCanvasRef.current.height;
        if (micAnalyserRef.current && isMicActive) {
          const buf = micAnalyserRef.current.frequencyBinCount;
          const data = new Uint8Array(buf);
          micAnalyserRef.current.getByteFrequencyData(data);
          ctx.clearRect(0, 0, w, h);
          const bw = (w / buf) * 2.5;
          let x = 0;
          for (let i = 0; i < buf; i++) {
            const bh = (data[i] / 255) * h;
            ctx.fillStyle = '#10b981';
            ctx.fillRect(x, h - bh, bw, bh);
            x += bw + 1;
          }
        } else {
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(0, h / 2 - 1, w, 2);
        }
      }

      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animId);
  }, [isTabActive, isMicActive]);

  // ── Tab Audio Start / Stop ──
  const startTabCapture = async () => {
    setTabError('');
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Tab audio capture requires Chrome/Edge on desktop.');
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: true, noiseSuppression: true, suppressLocalAudioPlayback: false }
      });

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach(t => t.stop());
        throw new Error('No audio selected. Ensure "Share tab audio" is checked.');
      }

      const track = audioTracks[0];
      setTabTrackLabel(track.label || 'Interviewer Meeting Audio');
      tabStreamRef.current = stream;

      const audioOnlyStream = new MediaStream(audioTracks);
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      tabAudioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(audioOnlyStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      tabAnalyserRef.current = analyser;

      tabRecorderRef.current = createRecorder(audioOnlyStream, 'interviewer');
      setIsTabActive(true);

      track.onended = () => stopTabCapture();
    } catch (err) {
      setTabError(err.message || 'Failed to capture tab audio');
      setIsTabActive(false);
    }
  };

  const stopTabCapture = () => {
    if (tabRecorderRef.current?.state !== 'inactive') tabRecorderRef.current?.stop();
    tabStreamRef.current?.getTracks().forEach(t => t.stop());
    tabStreamRef.current = null;
    tabAudioCtxRef.current?.close();
    tabAudioCtxRef.current = null;
    setIsTabActive(false);
  };

  // ── Mic Audio Start / Stop ──
  const startMicCapture = async () => {
    setMicError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access requires HTTPS or localhost.');
      }
      const constraints = {
        audio: {
          deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
          echoCancellation: true,
          noiseSuppression: true
        },
        video: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach(t => t.stop());
        throw new Error('No microphone audio track found.');
      }

      const track = audioTracks[0];
      setMicTrackLabel(track.label || 'Candidate Microphone');
      micStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      micAudioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      micAnalyserRef.current = analyser;

      micRecorderRef.current = createRecorder(stream, 'candidate');
      setIsMicActive(true);

      track.onended = () => stopMicCapture();
      loadAudioDevices();
    } catch (err) {
      setMicError(err.message || 'Failed to capture microphone');
      setIsMicActive(false);
    }
  };

  const stopMicCapture = () => {
    if (micRecorderRef.current?.state !== 'inactive') micRecorderRef.current?.stop();
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    micAudioCtxRef.current?.close();
    micAudioCtxRef.current = null;
    setIsMicActive(false);
  };

  // Start both convenience function
  const handleStartBoth = async () => {
    if (!isTabActive) await startTabCapture();
    if (!isMicActive) await startMicCapture();
  };

  const handleStopAll = () => {
    stopTabCapture();
    stopMicCapture();
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">
          <Volume2 />
          Dual Audio Capture
          {isTabActive || isMicActive ? (
            <span className="badge badge-red">
              <div className="status-dot live" />
              RECORDING
            </span>
          ) : (
            <span className="badge badge-gray">IDLE</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {!isTabActive || !isMicActive ? (
            <button className="btn btn-primary" onClick={handleStartBoth} style={{ fontSize: 11, padding: '4px 10px' }}>
              Start Both
            </button>
          ) : (
            <button className="btn btn-danger" onClick={handleStopAll} style={{ fontSize: 11, padding: '4px 10px' }}>
              Stop All
            </button>
          )}
        </div>
      </div>

      <div className="card-body">
        {/* Headphone Advisory */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: 8,
          padding: '6px 10px',
          marginBottom: 12,
          fontSize: 11,
          color: '#1e40af'
        }}>
          <Headphones size={13} style={{ flexShrink: 0 }} />
          <span><strong>Headphones recommended:</strong> Prevents meeting audio from leaking into candidate microphone.</span>
        </div>

        {/* Dual Stream Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Stream 1: Interviewer Tab Audio */}
          <div style={{
            background: 'var(--gray-50)',
            border: '1px solid var(--gray-200)',
            borderRadius: 8,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Monitor size={14} style={{ color: 'var(--blue-600)' }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-800)' }}>Interviewer (Tab)</span>
              </div>
              <span className={`badge ${isTabActive ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: 9 }}>
                {isTabActive ? 'Live' : 'Off'}
              </span>
            </div>

            <canvas ref={tabCanvasRef} width={240} height={26} style={{ width: '100%', height: 26, background: '#fff', borderRadius: 4 }} />

            {tabError && (
              <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2 }}>{tabError}</div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
              <span style={{ fontSize: 10, color: 'var(--gray-400)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 120 }}>
                {isTabActive ? tabTrackLabel : 'Google Meet / Zoom tab'}
              </span>
              {!isTabActive ? (
                <button className="btn btn-secondary" onClick={startTabCapture} style={{ fontSize: 10, padding: '3px 8px' }}>
                  Capture Tab
                </button>
              ) : (
                <button className="btn btn-danger" onClick={stopTabCapture} style={{ fontSize: 10, padding: '3px 8px' }}>
                  Stop Tab
                </button>
              )}
            </div>
          </div>

          {/* Stream 2: Candidate Microphone Audio */}
          <div style={{
            background: 'var(--gray-50)',
            border: '1px solid var(--gray-200)',
            borderRadius: 8,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mic size={14} style={{ color: '#10b981' }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-800)' }}>You (Microphone)</span>
              </div>
              <span className={`badge ${isMicActive ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: 9 }}>
                {isMicActive ? 'Live' : 'Off'}
              </span>
            </div>

            <canvas ref={micCanvasRef} width={240} height={26} style={{ width: '100%', height: 26, background: '#fff', borderRadius: 4 }} />

            {micError && (
              <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2 }}>{micError}</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
              {/* Mic Device Selector */}
              {audioDevices.length > 0 && (
                <select
                  value={selectedMicId}
                  onChange={e => {
                    setSelectedMicId(e.target.value);
                    if (isMicActive) {
                      stopMicCapture();
                      setTimeout(startMicCapture, 200);
                    }
                  }}
                  style={{
                    fontSize: 10,
                    padding: '2px 4px',
                    borderRadius: 4,
                    border: '1px solid var(--gray-300)',
                    background: '#fff',
                    maxWidth: '100%'
                  }}
                >
                  {audioDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${d.deviceId.slice(0, 5)}`}
                    </option>
                  ))}
                </select>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'var(--gray-400)' }}>
                  {isMicActive ? 'Voice active' : 'Select mic'}
                </span>
                {!isMicActive ? (
                  <button className="btn btn-secondary" onClick={startMicCapture} style={{ fontSize: 10, padding: '3px 8px' }}>
                    Capture Mic
                  </button>
                ) : (
                  <button className="btn btn-danger" onClick={stopMicCapture} style={{ fontSize: 10, padding: '3px 8px' }}>
                    Stop Mic
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card-footer">
        <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>
          {isTabActive && isMicActive ? 'Both channels active · Deepgram concurrent streaming' : isTabActive ? 'Interviewer audio only' : isMicActive ? 'Candidate mic only' : 'Both channels idle'}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {(!isTabActive && !isMicActive) && (
            <button className="btn btn-primary" onClick={handleStartBoth} style={{ fontSize: 11 }}>
              Start Interview Audio
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
