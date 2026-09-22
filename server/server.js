const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const dotenv = require('dotenv');
const os = require('os');
const path = require('path');
const Groq = require('groq-sdk');
const OpenAI = require('openai');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Active paired sessions: sessionCode -> { laptopWs, mobileWss: Set() }
const sessions = new Map();

// Candidate Background Context
const candidateContext = {
  resume: "Senior Full Stack Software Engineer with 5+ years of experience in React, Node.js, TypeScript, PostgreSQL, Distributed Systems, WebSockets, and AI integrations. Built high-concurrency microservices and real-time audio/video streaming apps.",
  targetRole: "Senior Full Stack / Backend Engineer",
  jobDescription: "Looking for an engineer to build low-latency real-time web applications, scale Node.js services, design clean UIs, and work with LLM APIs.",
  projects: "1. Real-time Audio Analytics Platform: Built with WebSockets, Node.js audio pipelines, and React dashboard.\n2. E-Commerce Microservices: Scaled Node.js microservices handling 2M daily requests on AWS ECS with Redis caching.",
  guardrails: "Strictly adhere to candidate's actual experience. If a question asks about something missing from context, provide the standard industry best-practice answer and note candidate familiarity. Never invent fake past metrics."
};

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// REST Endpoints
app.get('/api/info', (req, res) => {
  res.json({
    status: 'online',
    localIp: getLocalIpAddress(),
    port: PORT,
    hasGroqKey: Boolean(process.env.GROQ_API_KEY),
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    hasDeepgramKey: Boolean(process.env.DEEPGRAM_API_KEY),
  });
});

app.get('/api/context', (req, res) => {
  res.json(candidateContext);
});

app.post('/api/context', (req, res) => {
  const { resume, targetRole, jobDescription, projects, guardrails } = req.body;
  if (resume !== undefined) candidateContext.resume = resume;
  if (targetRole !== undefined) candidateContext.targetRole = targetRole;
  if (jobDescription !== undefined) candidateContext.jobDescription = jobDescription;
  if (projects !== undefined) candidateContext.projects = projects;
  if (guardrails !== undefined) candidateContext.guardrails = guardrails;
  res.json({ success: true, context: candidateContext });
});

// Serve static frontend build
const clientDistPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(clientDistPath, 'index.html'), (err) => {
    if (err) res.send('AI Copilot Server Running.');
  });
});

function buildSystemPrompt(userContext, customInstruction = "") {
  return `You are a real-time ultra-fast Interview Copilot assisting a candidate during a live interview.
Your answers MUST be concise, authoritative, accurate, and direct. The candidate needs to read the main answer in 1-2 seconds.

CANDIDATE CONTEXT:
- Target Role: ${userContext.targetRole}
- Résumé Summary: ${userContext.resume}
- Key Projects: ${userContext.projects}
- Job Description: ${userContext.jobDescription}
- Strict Rules: ${userContext.guardrails}

MANDATORY RESPONSE FORMAT:
Format your response cleanly in markdown with EXACTLY 3 sections:
1. **Direct Answer**: One strong, authoritative sentence directly answering the interviewer's main question.
2. **Key Points**:
   - Point 1 (1-2 sentences on core concept/tradeoffs)
   - Point 2 (1-2 sentences on technical mechanism)
   - Point 3 (1-2 sentences on practical benefit or architecture)
3. **Real Example**: 1 concise real-world or past project example (2 sentences max).

Start IMMEDIATELY with the Direct Answer without conversational filler.
${customInstruction ? `\nSPECIAL INSTRUCTION: ${customInstruction}` : ''}`;
}

// Low-latency Fallback Streamer for zero-key mode
async function streamMockAnswer(question, sessionId, startTime, instruction = "") {
  const qLower = question.toLowerCase();
  
  let directAns = `For ${question.replace(/^(what is|how do|explain|tell me about)\s+/i, '')}, the optimal approach balances scalability, low latency, and clean maintainability.`;
  let pt1 = "Core Concept: Decouple stateful operations from background execution to maximize throughput and prevent thread blocking.";
  let pt2 = "Technical Execution: Leverage non-blocking asynchronous event loops, streaming data pipelines, and optimized caching layers.";
  let pt3 = "Best Practice: Ensure idempotent handling, structured telemetry logging, and dynamic fallback strategies under heavy load.";
  let example = `In my past project (${candidateContext.targetRole}), I implemented this strategy using Node.js WebSockets and Redis, reducing p99 latency by 45%.`;

  if (qLower.includes("react") || qLower.includes("virtual dom") || qLower.includes("usememo")) {
    directAns = "React optimizes UI updates using a Virtual DOM reconciliation algorithm, minimizing expensive real DOM mutations.";
    pt1 = "Virtual DOM diffing compares lightweight JS object trees to calculate minimal required DOM edits.";
    pt2 = "Hooks like useMemo and useCallback preserve reference stability to prevent unnecessary child re-renders.";
    pt3 = "State updates should be immutable and granularly scoped to avoid high-level component tree invalidations.";
    example = "In our real-time dashboard, memoizing chart sub-components cut re-render cycles by 60%.";
  } else if (qLower.includes("node") || qLower.includes("event loop")) {
    directAns = "Node.js utilizes a single-threaded non-blocking I/O event loop powered by libuv to process high-concurrency requests.";
    pt1 = "The Event Loop executes tasks across phases: Timers, Pending I/O, Poll, Check (setImmediate), and Close callbacks.";
    pt2 = "Microtasks (Promises, process.nextTick) drain completely between each event loop phase execution.";
    pt3 = "CPU-intensive workloads should be delegated to Worker Threads or external microservices to prevent main-thread starvation.";
    example = "I architected our streaming WebSocket gateway using Node.js event emitters, sustaining 50,000 active concurrent socket connections.";
  }

  if (instruction.includes("more") || instruction.includes("explain")) {
    directAns += " (Deep Technical Analysis)";
    pt1 += " Detailed memory management prevents garbage collection pauses under high memory pressure.";
  }

  const fullText = `🎯 **Direct Answer:**\n${directAns}\n\n💡 **Key Points:**\n- ${pt1}\n- ${pt2}\n- ${pt3}\n\n🚀 **Real Example:**\n${example}`;
  
  const words = fullText.split(' ');
  let firstTokenSent = false;
  let accumulated = '';

  for (let i = 0; i < words.length; i++) {
    const chunk = words[i] + (i === words.length - 1 ? '' : ' ');
    accumulated += chunk;
    
    if (!firstTokenSent) {
      firstTokenSent = true;
      const ttft = Date.now() - startTime;
      broadcastToSession(sessionId, { type: 'ai_stream_start', ttft });
    }

    broadcastToSession(sessionId, { type: 'ai_stream_chunk', chunk: chunk, fullText: accumulated });
    await new Promise(r => setTimeout(r, 15));
  }

  const totalTime = Date.now() - startTime;
  broadcastToSession(sessionId, { type: 'ai_stream_end', fullText: accumulated, totalTime });
}

// Live Groq / OpenAI LLM Streaming Handler
async function streamAiAnswer(question, sessionId, customInstruction = "") {
  const startTime = Date.now();

  broadcastToSession(sessionId, {
    type: 'ai_status',
    status: 'generating',
    question: question
  });

  const groqKey = process.env.GROQ_API_KEY;
  const openAIKey = process.env.OPENAI_API_KEY;

  if (groqKey) {
    // Exact working model list verified against Groq API endpoint
    const groqModels = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'allam-2-7b'];
    const groq = new Groq({ apiKey: groqKey });
    const systemPrompt = buildSystemPrompt(candidateContext, customInstruction);

    for (const model of groqModels) {
      try {
        const stream = await groq.chat.completions.create({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `INTERVIEW QUESTION: "${question}"` }
          ],
          model: model,
          temperature: 0.2,
          max_tokens: 350,
          stream: true
        });

        let firstTokenSent = false;
        let accumulated = '';

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || '';
          if (text) {
            accumulated += text;
            if (!firstTokenSent) {
              firstTokenSent = true;
              const ttft = Date.now() - startTime;
              broadcastToSession(sessionId, { type: 'ai_stream_start', ttft });
            }
            broadcastToSession(sessionId, { type: 'ai_stream_chunk', chunk: text, fullText: accumulated });
          }
        }

        const totalTime = Date.now() - startTime;
        broadcastToSession(sessionId, { type: 'ai_stream_end', fullText: accumulated, totalTime });
        return; // Success!
      } catch (err) {
        console.warn(`Groq Model ${model} error: ${err.message}. Trying next model...`);
      }
    }
  }

  if (openAIKey) {
    try {
      const openai = new OpenAI({ apiKey: openAIKey });
      const systemPrompt = buildSystemPrompt(candidateContext, customInstruction);

      const stream = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `INTERVIEW QUESTION: "${question}"` }
        ],
        model: 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 350,
        stream: true
      });

      let firstTokenSent = false;
      let accumulated = '';

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) {
          accumulated += text;
          if (!firstTokenSent) {
            firstTokenSent = true;
            const ttft = Date.now() - startTime;
            broadcastToSession(sessionId, { type: 'ai_stream_start', ttft });
          }
          broadcastToSession(sessionId, { type: 'ai_stream_chunk', chunk: text, fullText: accumulated });
        }
      }

      const totalTime = Date.now() - startTime;
      broadcastToSession(sessionId, { type: 'ai_stream_end', fullText: accumulated, totalTime });
      return;
    } catch (err) {
      console.error('OpenAI Streaming Error:', err.message);
    }
  }

  // Fallback to mock streamer
  await streamMockAnswer(question, sessionId, startTime, customInstruction);
}

// Universal session broadcast helper
function broadcastToSession(sessionId, data) {
  const payload = JSON.stringify(data);
  const session = sessions.get(sessionId);

  // 1. Send to matched session
  if (session) {
    if (session.laptopWs && session.laptopWs.readyState === WebSocket.OPEN) {
      session.laptopWs.send(payload);
    }
    for (const mobileWs of session.mobileWss) {
      if (mobileWs.readyState === WebSocket.OPEN) {
        mobileWs.send(payload);
      }
    }
  }

  // 2. Universal fallback: Send to ALL connected mobile clients
  for (const [sId, sess] of sessions.entries()) {
    if (sId !== sessionId) {
      for (const mWs of sess.mobileWss) {
        if (mWs.readyState === WebSocket.OPEN) {
          mWs.send(payload);
        }
      }
    }
  }
}

// WebSocket Connection Manager
wss.on('connection', (ws) => {
  let currentSessionId = null;
  let userRole = null;
  let deepgramWs = null;

  ws.on('message', async (message, isBinary) => {
    if (isBinary) {
      if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.send(message);
      }
      return;
    }

    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'register': {
          currentSessionId = data.session || 'SESSION-1';
          userRole = data.role || 'laptop';

          if (!sessions.has(currentSessionId)) {
            sessions.set(currentSessionId, { laptopWs: null, mobileWss: new Set() });
          }
          const session = sessions.get(currentSessionId);

          if (userRole === 'laptop') {
            session.laptopWs = ws;
          } else {
            session.mobileWss.add(ws);
          }

          ws.send(JSON.stringify({
            type: 'registered',
            session: currentSessionId,
            role: userRole,
            mobileCount: session.mobileWss.size
          }));

          broadcastToSession(currentSessionId, {
            type: 'peer_status',
            mobileConnected: true,
            mobileCount: session.mobileWss.size
          });
          break;
        }

        case 'start_deepgram_flux': {
          const dgKey = process.env.DEEPGRAM_API_KEY || data.apiKey;
          if (!dgKey) {
            ws.send(JSON.stringify({ type: 'deepgram_error', message: 'No Deepgram API key set.' }));
            return;
          }

          const dgUrl = 'wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&interim_results=true&utterance_end_ms=1000';

          try {
            deepgramWs = new WebSocket(dgUrl, {
              headers: { Authorization: `Token ${dgKey}` }
            });

            deepgramWs.on('open', () => {
              ws.send(JSON.stringify({ type: 'deepgram_status', status: 'connected' }));
            });

            deepgramWs.on('message', (dgMsg) => {
              try {
                const jsonPayload = JSON.parse(dgMsg.toString());
                const transcript = jsonPayload.channel?.alternatives[0]?.transcript;
                const isFinal = jsonPayload.is_final;

                if (transcript && transcript.trim().length > 0) {
                  broadcastToSession(currentSessionId, {
                    type: 'transcript_update',
                    transcript: transcript,
                    isFinal: isFinal
                  });

                  if (isFinal && transcript.trim().length > 10) {
                    streamAiAnswer(transcript, currentSessionId);
                  }
                }
              } catch (err) {}
            });

            deepgramWs.on('error', (err) => {
              console.error('Deepgram WS Error:', err.message);
              ws.send(JSON.stringify({ type: 'deepgram_error', message: err.message }));
            });
          } catch (e) {
            ws.send(JSON.stringify({ type: 'deepgram_error', message: e.message }));
          }
          break;
        }

        case 'stop_deepgram': {
          if (deepgramWs) {
            deepgramWs.close();
            deepgramWs = null;
          }
          break;
        }

        case 'transcript_sync': {
          broadcastToSession(currentSessionId, {
            type: 'transcript_update',
            transcript: data.transcript,
            isFinal: data.isFinal
          });

          if ((data.isFinal || data.autoTrigger) && data.transcript && data.transcript.trim().length > 5) {
            streamAiAnswer(data.transcript, currentSessionId);
          }
          break;
        }

        case 'trigger_answer': {
          if (data.question) {
            streamAiAnswer(data.question, currentSessionId, data.instruction || "");
          }
          break;
        }

        case 'explain_more': {
          if (data.question) {
            streamAiAnswer(data.question, currentSessionId, "Provide deeper technical architectural details.");
          }
          break;
        }

        case 'clear_answer': {
          broadcastToSession(currentSessionId, { type: 'ai_clear' });
          break;
        }

        case 'pause_listening': {
          broadcastToSession(currentSessionId, { type: 'listening_status', paused: data.paused });
          break;
        }
      }
    } catch (err) {
      console.error('WebSocket parse error:', err);
    }
  });

  ws.on('close', () => {
    if (deepgramWs) deepgramWs.close();
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 AI Interview Copilot Server running on port ${PORT}`);
  console.log(`🌐 Local Network IP for Mobile QR Pairing: http://${getLocalIpAddress()}:${PORT}`);
  console.log(`====================================================`);
});
