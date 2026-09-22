import React, { useState, useEffect, useRef } from 'react';
import { Mic, Monitor, Volume2, AlertCircle, CheckCircle, ExternalLink } from 'lucide-react';

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

  // Web Speech API fallback for local mic
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += transcript;
          else interim += transcript;
        }
        if (onTranscriptUpdate) {
          if (final) onTranscriptUpdate(final, true);
          else if (interim) onTranscriptUpdate(interim, false);
        }
      };

      speechRecognitionRef.current = recognition;
    }
  }, [onTranscriptUpdate]);

  // Canvas waveform loop
  useEffect(() => {
    let animId;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const draw = () => {
      if (analyserRef.current && isListening) {
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * canvas.height;
          ctx.fillStyle = '#4f46e5';
          ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
          x += barWidth + 1;
        }
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#cbd5e1';
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
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            suppressLocalAudioPlayback: false
          }
        });
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false
        });
      }

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        setHasAudioTrack(false);
        setErrorMessage('⚠️ No audio track found! When selecting a tab in Chrome, make sure to check "Share tab audio".');
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      const track = audioTracks[0];
      setHasAudioTrack(true);
      setTrackLabel(track.label || (sourceType === 'tab' ? 'Chrome Tab Audio' : 'Microphone Input'));
      streamRef.current = stream;

      const audioOnlyStream = new MediaStream(audioTracks);

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(audioOnlyStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        const recorder = new MediaRecorder(audioOnlyStream, { mimeType: 'audio/webm;codecs=opus' });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && onAudioChunk) {
            onAudioChunk(e.data);
          }
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
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch (e) {}
    }
    setIsListening(false);
    setHasAudioTrack(null);
  };

  return (
    <div className="clean-card p-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Volume2 className="w-5 h-5 text-indigo-600" />
            <h3 className="font-heading text-base font-bold text-slate-900">Live Audio Capture</h3>
            {isListening ? (
              <span className="pill-badge pill-badge-green">LISTENING LIVE</span>
            ) : (
              <span className="pill-badge pill-badge-amber">STANDBY</span>
            )}
          </div>
          <p className="text-xs text-slate-600">
            Captures interviewer speech directly from Chrome tab (Google Meet, Zoom, YouTube) or Microphone.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="bg-slate-100 p-1 rounded-lg border border-slate-200 flex items-center gap-1">
            <button
              onClick={() => { if (!isListening) setSourceType('tab'); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                sourceType === 'tab' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" /> Tab Audio
            </button>
            <button
              onClick={() => { if (!isListening) setSourceType('mic'); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                sourceType === 'mic' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Mic className="w-3.5 h-3.5" /> Mic Input
            </button>
          </div>

          {!isListening ? (
            <button onClick={startListening} className="btn-primary">
              <Volume2 className="w-4 h-4" /> Start Listening
            </button>
          ) : (
            <button onClick={stopListening} className="btn-danger">
              Stop Capture
            </button>
          )}
        </div>
      </div>

      <canvas ref={canvasRef} className="waveform-canvas mb-2" width={600} height={40} />

      <div className="flex items-center justify-between text-xs text-slate-500">
        <div>
          {hasAudioTrack === true && (
            <span className="text-emerald-700 flex items-center gap-1 font-semibold">
              <CheckCircle className="w-3.5 h-3.5" /> Active Track: {trackLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-slate-500">
          <ExternalLink className="w-3 h-3 text-indigo-600" />
          <span>Keep Copilot open side-by-side or read on your phone!</span>
        </div>
      </div>

      {errorMessage && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
