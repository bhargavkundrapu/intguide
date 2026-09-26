import React, { useState, useEffect, useRef } from 'react';
import { Mic, Monitor, Volume2, AlertCircle, CheckCircle, StopCircle } from 'lucide-react';

export default function AudioCapture({ onAudioChunk, isListening, setIsListening, onTranscriptUpdate }) {
  const [sourceType, setSourceType] = useState('tab');
  const [hasAudioTrack, setHasAudioTrack] = useState(null);
  const [trackLabel, setTrackLabel] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const isListeningRef = useRef(isListening);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // Web Speech API fallback with continuous auto-restart
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = (event) => {
        let interim = '', final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += t;
          else interim += t;
        }
        if (onTranscriptUpdate) {
          if (final) onTranscriptUpdate(final, true);
          else if (interim) onTranscriptUpdate(interim, false);
        }
      };
      recognition.onend = () => {
        // Auto-restart if still listening so speech recognition never dies mid-interview
        if (isListeningRef.current) {
          try {
            recognition.start();
          } catch (e) {}
        }
      };
      recognition.onerror = (e) => {
        if (e.error === 'no-speech' && isListeningRef.current) {
          // Expected when there's silence; onend will restart it
        }
      };
      speechRecognitionRef.current = recognition;
    }
  }, [onTranscriptUpdate]);

  // Canvas waveform
  useEffect(() => {
    let animId;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const draw = () => {
      if (analyserRef.current && isListening) {
        const buf = analyserRef.current.frequencyBinCount;
        const data = new Uint8Array(buf);
        analyserRef.current.getByteFrequencyData(data);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const bw = (canvas.width / buf) * 2.5;
        let x = 0;
        for (let i = 0; i < buf; i++) {
          const bh = (data[i] / 255) * canvas.height;
          ctx.fillStyle = '#2563eb';
          ctx.fillRect(x, canvas.height - bh, bw, bh);
          x += bw + 1;
        }
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#d1d5db';
        ctx.fillRect(0, canvas.height / 2 - 1, canvas.width, 2);
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animId);
  }, [isListening]);

  const startListening = async () => {
    setErrorMessage('');
    try {
      let stream;
      if (sourceType === 'tab') {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          throw new Error('Tab audio capture is only supported on desktop browsers (Chrome, Edge). Please switch to Mic mode.');
        }
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { echoCancellation: true, noiseSuppression: true, suppressLocalAudioPlayback: false }
        });
      } else {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Microphone access is not supported on this browser or page must be served over HTTPS.');
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false
        });
      }

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        setHasAudioTrack(false);
        setErrorMessage('No audio track found. In Chrome, make sure to check "Share tab audio" when selecting a tab.');
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      const track = audioTracks[0];
      setHasAudioTrack(true);
      setTrackLabel(track.label || (sourceType === 'tab' ? 'Chrome Tab Audio' : 'Microphone'));
      streamRef.current = stream;

      const audioOnlyStream = new MediaStream(audioTracks);
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(audioOnlyStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      if (window.MediaRecorder) {
        const candidateTypes = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/ogg;codecs=opus',
          'audio/mp4',
          ''
        ];
        const selectedType = candidateTypes.find(t => !t || MediaRecorder.isTypeSupported(t));
        const recorder = selectedType
          ? new MediaRecorder(audioOnlyStream, { mimeType: selectedType })
          : new MediaRecorder(audioOnlyStream);

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && onAudioChunk) onAudioChunk(e.data);
        };
        recorder.start(250);
        mediaRecorderRef.current = recorder;
      }

      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.start(); } catch (e) {}
      }

      setIsListening(true);
      track.onended = () => stopListening();

    } catch (err) {
      setHasAudioTrack(false);
      setErrorMessage(err.message || 'Could not start audio capture');
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    try { speechRecognitionRef.current?.stop(); } catch (e) {}
    setIsListening(false);
    setHasAudioTrack(null);
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">
          <Volume2 />
          Audio Capture
          {isListening ? (
            <span className="badge badge-red">
              <div className="status-dot live" />
              LIVE
            </span>
          ) : (
            <span className="badge badge-gray">IDLE</span>
          )}
        </div>

        {/* Source Toggle */}
        <div className="source-toggle">
          <button
            className={`source-toggle-btn ${sourceType === 'tab' ? 'active' : ''}`}
            onClick={() => { if (!isListening) setSourceType('tab'); }}
            disabled={isListening}
          >
            <Monitor />
            Tab
          </button>
          <button
            className={`source-toggle-btn ${sourceType === 'mic' ? 'active' : ''}`}
            onClick={() => { if (!isListening) setSourceType('mic'); }}
            disabled={isListening}
          >
            <Mic />
            Mic
          </button>
        </div>
      </div>

      <div className="card-body">
        <p style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 12 }}>
          {sourceType === 'tab'
            ? 'Captures interviewer audio from a browser tab (Google Meet, Zoom, etc.). Enable "Share tab audio" in Chrome.'
            : 'Captures audio from your microphone for voice input.'}
        </p>

        <canvas ref={canvasRef} className="waveform-canvas" width={600} height={36} />

        {hasAudioTrack === true && (
          <div className="alert alert-success" style={{ marginTop: 10 }}>
            <CheckCircle />
            <span>Active: <strong>{trackLabel}</strong></span>
          </div>
        )}

        {errorMessage && (
          <div className="alert alert-error" style={{ marginTop: 10 }}>
            <AlertCircle />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      <div className="card-footer">
        <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>
          {sourceType === 'tab' ? 'Tab Audio' : 'Microphone'} · Web Speech API fallback enabled
        </span>
        {!isListening ? (
          <button className="btn btn-primary" onClick={startListening}>
            <Volume2 size={13} />
            Start Listening
          </button>
        ) : (
          <button className="btn btn-danger" onClick={stopListening}>
            <StopCircle size={13} />
            Stop Capture
          </button>
        )}
      </div>
    </div>
  );
}
