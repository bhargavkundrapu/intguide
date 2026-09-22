const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const dotenv = require('dotenv');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Groq = require('groq-sdk');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ─────────────────────────────────────────────────────────────
//  ID generators
// ─────────────────────────────────────────────────────────────
const uid = (prefix = 'id') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const hashText = t => crypto.createHash('sha1').update(t.trim().toLowerCase()).digest('hex').slice(0, 12);

// ─────────────────────────────────────────────────────────────
//  Global candidate context (per-deployment default)
// ─────────────────────────────────────────────────────────────
const candidateContext = {
  resume: "Senior Full Stack Software Engineer with 5+ years in React, Node.js, TypeScript, PostgreSQL, Distributed Systems, WebSockets, PySpark, Databricks, and AI integrations.",
  targetRole: "Senior Data / Full Stack Engineer",
  jobDescription: "Build low-latency real-time applications, large-scale data pipelines with PySpark and Databricks, scale Node.js services, design clean UIs, work with LLM APIs.",
  projects: "1. Real-time Audio Analytics Platform: WebSockets, Node.js pipelines, React dashboard.\n2. Data Lakehouse Architecture: PySpark, Delta Lake, Databricks, Redshift, Athena for 10TB+ daily telemetry.",
  guardrails: "Use only verified candidate facts. For missing experience, give industry best-practice answer and note candidate familiarity. Never invent metrics, employers, or results.",
  language: "English"
};

// ─────────────────────────────────────────────────────────────
//  Technical Vocabulary & Deepgram Keyterm Prompting
// ─────────────────────────────────────────────────────────────
const technicalVocabulary = new Set();

function getTechnicalVocabularyList() {
  return Array.from(technicalVocabulary);
}

// Critical words classification for word-level confidence checking
const NEGATION_WORDS = new Set(['not', 'never', 'no', 'without', 'neither', 'nor']);
const COMPARISON_WORDS = new Set(['difference', 'versus', 'vs', 'ascending', 'descending', 'in-place', 'recursive', 'iterative']);

function analyzeWordUncertainty(wordsArray, vocabSet) {
  if (!Array.isArray(wordsArray) || wordsArray.length === 0) {
    return { hasUncertainty: false, uncertainWords: [] };
  }

  const uncertainWords = [];
  for (const w of wordsArray) {
    const cleanWord = (w.word || '').trim().toLowerCase();
    const conf = typeof w.confidence === 'number' ? w.confidence : 1.0;

    const isNegation = NEGATION_WORDS.has(cleanWord);
    const isComparison = COMPARISON_WORDS.has(cleanWord);
    const isNumber = /^\d+$/.test(cleanWord);
    const isTech = Array.from(vocabSet).some(term => term.toLowerCase().includes(cleanWord) && cleanWord.length > 3);

    const isCritical = isNegation || isComparison || isNumber || isTech;

    // Flag low-confidence critical words (< 0.68)
    if (isCritical && conf < 0.68) {
      uncertainWords.push({
        word: w.punctuated_word || w.word,
        rawWord: cleanWord,
        confidence: Math.round(conf * 100),
        isCritical: true,
        type: isNegation ? 'negation' : isTech ? 'technical' : isNumber ? 'number' : 'comparison'
      });
    }
  }

  return {
    hasUncertainty: uncertainWords.length > 0,
    uncertainWords
  };
}

// ─────────────────────────────────────────────────────────────
//  Session store: sessionId → ConversationSession
// ─────────────────────────────────────────────────────────────
/*
  ConversationSession {
    laptopWs: WebSocket | null
    mobileWss: Set<WebSocket>
    messages: ChatMessage[]          ← append-only
    activeReqId: string | null       ← current generation request
    activeAbort: AbortController | null
    transcriptAccumulator: TranscriptAccumulator
    seenTranscriptHashes: Set<string>
    pendingQuestionHash: string | null
  }

  ChatMessage {
    id: string
    role: 'question' | 'answer'
    text: string
    status: 'pending'|'streaming'|'complete'|'interrupted'|'error'
    parentId: string | null          ← for answers: linked question id
    reqId: string | null             ← generation request
    ttft: number
    totalTime: number
    createdAt: number
  }
*/
const sessions = new Map();

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      laptopWs: null,
      mobileWss: new Set(),
      messages: [],
      activeReqId: null,
      activeAbort: null,
      transcriptAccumulator: new TranscriptAccumulator(sessionId),
      seenTranscriptHashes: new Set(),
      pendingQuestionHash: null,
    });
  }
  return sessions.get(sessionId);
}

// ─────────────────────────────────────────────────────────────
//  TranscriptAccumulator
//  Collects Deepgram fragments → commits complete questions
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
const INCOMPLETE_PHRASES = [];

const NOISE_ONLY = /^(uh+|um+|hmm+|mm+|okay+|yes+|no+|right|sure|alright|okay then|mhm+)[\s.,!?]*$/i;

class TranscriptAccumulator {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.committed = '';      // stable committed text
    this.interim = '';        // current interim (not yet final)
    this.words = [];          // collected word objects with confidence scores
    this.settleTimer = null;
    this.speechStartTime = null; // tracks when speech for current question began
    this.SETTLE_MS = 1400;    // settle after 1.4s of quiet
    this.WINDOW_MS = 7000;    // 7-second question accumulation window
  }

  isIncomplete(text) {
    const t = text.trim();
    if (!t) return true;
    return INCOMPLETE_PHRASES.some(re => re.test(t));
  }

  isNoiseOnly(text) {
    return NOISE_ONLY.test(text.trim());
  }

  addInterim(text) {
    if (!this.speechStartTime) this.speechStartTime = Date.now();
    this.interim = text;
    // Debounce settle timer while speaker is active
    this._scheduleSettle(this.SETTLE_MS);
  }

  addFinal(text, speechFinal, words = []) {
    if (this.isNoiseOnly(text)) return null;
    if (!this.speechStartTime) this.speechStartTime = Date.now();

    if (Array.isArray(words) && words.length > 0) {
      this.words.push(...words);
    }

    // Append to committed buffer
    this.committed = this.committed
      ? this.committed.trimEnd() + ' ' + text.trim()
      : text.trim();
    this.interim = '';

    const elapsed = Date.now() - this.speechStartTime;

    if (speechFinal) {
      // If trailing phrase is incomplete (e.g., ends in "for"), keep waiting up to 5s window
      if (this.isIncomplete(this.committed)) {
        const remaining = Math.max(1200, this.WINDOW_MS - elapsed);
        this._scheduleSettle(remaining);
        return null;
      }
      this._clearSettle();
      return this._commit();
    } else {
      // is_final received but not end of utterance yet -> debounce settle
      this._scheduleSettle(this.SETTLE_MS);
    }
    return null;
  }

  consumeWords() {
    const w = [...this.words];
    this.words = [];
    return w;
  }

  forceCommit(overrideText) {
    this._clearSettle();
    if (overrideText) this.committed = overrideText;
    return this._commit();
  }

  _commit() {
    const full = (this.committed ? this.committed + ' ' + this.interim : this.interim).trim();
    this.committed = '';
    this.interim = '';
    this.speechStartTime = null;
    if (!full || this.isNoiseOnly(full)) return null;
    return full;
  }

  _scheduleSettle(ms) {
    this._clearSettle();
    this.settleTimer = setTimeout(() => {
      const full = (this.committed ? this.committed + ' ' + this.interim : this.interim).trim();

      // If trailing word is a preposition/connector and within the 5s speech window, wait longer!
      if (this.isIncomplete(full)) {
        const elapsed = this.speechStartTime ? Date.now() - this.speechStartTime : 0;
        if (elapsed < this.WINDOW_MS) {
          this._scheduleSettle(1200);
          return;
        }
      }

      const words = this.consumeWords();
      this.committed = '';
      this.interim = '';
      this.speechStartTime = null;

      if (full && !this.isNoiseOnly(full)) {
        const session = sessions.get(this.sessionId);
        if (session) commitQuestion(this.sessionId, full, session, words, full);
      }
    }, ms || this.SETTLE_MS);
  }

  _clearSettle() {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  Context builder — relevant history only, not full transcript
// ─────────────────────────────────────────────────────────────
function buildContext(session, currentQuestion) {
  const messages = session.messages;
  const recent = messages.slice(-6); // last 3 Q+A pairs max

  // Detect follow-up by checking latest question for referential phrases
  const followUpPatterns = [
    /^(why|how|give (me )?an example|what about|can you (optimize|improve)|explain (the )?(second|first|third|that)|use \w+ instead|what happens|how is that different)/i,
    /^(and|but|also|additionally|what if|now|so|that|this|those|these)\b/i,
  ];
  const isFollowUp = followUpPatterns.some(p => p.test(currentQuestion.trim()));

  // Find parent question/answer for context
  let parentQuestion = null;
  let parentAnswer = null;
  if (isFollowUp && messages.length >= 2) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'answer' && messages[i].status === 'complete') {
        parentAnswer = messages[i];
        // Find the question for this answer
        const qMsg = messages.find(m => m.id === messages[i].parentId);
        if (qMsg) parentQuestion = qMsg;
        break;
      }
    }
  }

  return {
    currentQuestion,
    isFollowUp,
    parentQuestion: parentQuestion?.text || null,
    parentAnswer: parentAnswer?.text || null,
    recentHistory: recent.map(m => ({ role: m.role, text: m.text.slice(0, 600), status: m.status })),
    candidate: candidateContext,
  };
}

// ─────────────────────────────────────────────────────────────
//  System prompt — simpler & shorter code, neat logic below, edge cases
// ─────────────────────────────────────────────────────────────
function buildSystemPrompt(ctx) {
  const { candidate, parentQuestion, parentAnswer, isFollowUp } = ctx;

  let followUpSection = '';
  if (isFollowUp && parentQuestion) {
    followUpSection = `
PREVIOUS QUESTION: ${parentQuestion}
PREVIOUS ANSWER SUMMARY: ${parentAnswer ? parentAnswer.slice(0, 500) : '(still generating)'}
This is a follow-up. Continue the relevant discussion without repeating the entire previous answer.
If the reference is genuinely ambiguous, ask ONE concise clarification question.`;
  }

  return `You are a real-time interview response assistant designed to help candidates answer with confidence and clarity.

Answer the latest complete interviewer question using the provided conversation context.

CANDIDATE PROFILE:
- Target Role: ${candidate.targetRole}
- Résumé: ${candidate.resume}
- Projects: ${candidate.projects}
- Job Description: ${candidate.jobDescription}
- Rules: ${candidate.guardrails}
- Language preference: ${candidate.language || 'English'}
${followUpSection}

CRITICAL CODING RESPONSE RULES (STRICT):
When answering any coding task or algorithm question, ALWAYS format your answer in this exact clean structure:
1. **Core Approach (1-2 sentences)**: State the direct strategy (e.g., "Use a hash map to store seen values in a single pass.").
2. **Simple & Short Code**:
   - Provide the SHORTEST, SIMPLEST, and most elegant code possible.
   - Do NOT include unnecessary boilerplate, wrappers, or boilerplate imports unless required.
   - Write clean, modern, readable code.
   - Always wrap code in markdown code fences (\`\`\`language ... \`\`\`).
3. **### How It Works**:
   - 2-3 neat, simple bullet points explaining the logic clearly step-by-step below the code.
4. **### Edge Cases & Complexity**:
   - List key edge cases handled (e.g., empty/null input, single element, negative numbers, boundaries).
   - Time Complexity: O(...) | Space Complexity: O(...) with 1-line rationale.

GENERAL RESPONSE RULES:
1. Begin with a direct, useful sentence. Never start with "Certainly!", "Great question!", or "Here is the code."
2. Keep answers concise, natural, and comfortable to read aloud in an interview setting.
3. For definitions/concepts: state what it is, why it's used, and a quick practical example.
4. For behavioral/experience: use ONLY verified résumé/project facts. Do not invent fake metrics or employers.
5. For follow-up questions: address the specific follow-up directly without repeating earlier answers.`;
}

// ─────────────────────────────────────────────────────────────
//  Session broadcast helpers
// ─────────────────────────────────────────────────────────────
function broadcastToSession(sessionId, data) {
  const payload = JSON.stringify(data);
  const session = sessions.get(sessionId);
  if (!session) return;
  if (session.laptopWs?.readyState === WebSocket.OPEN) session.laptopWs.send(payload);
  for (const ws of session.mobileWss) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function notifyPeerStatus(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  const mobileCount = session.mobileWss.size;
  broadcastToSession(sessionId, {
    type: 'peer_status',
    mobileConnected: mobileCount > 0,
    mobileCount
  });
}

// ─────────────────────────────────────────────────────────────
//  Commit a question → start answer generation
// ─────────────────────────────────────────────────────────────
function commitQuestion(sessionId, questionText, session, words = [], rawTranscript = null) {
  const trimmed = questionText.trim();
  if (!trimmed) return;

  const rawText = rawTranscript || trimmed;
  const analysis = analyzeWordUncertainty(words, technicalVocabulary);

  // ── 7-Second Stitching & Follow-up Completion Rule ──
  // If a question was committed within the last 7 seconds, and:
  // (a) the previous question was incomplete (e.g. ended with "for", "to", "in")
  // (b) OR the new text is a short completion fragment (<= 4 words, e.g. "palindrome", "in python")
  // stitch them together instead of creating two fragmented answers!
  const lastQ = [...session.messages].reverse().find(m => m.role === 'question');
  const timeSinceLastQ = lastQ ? Date.now() - lastQ.createdAt : Infinity;
  const wordCount = trimmed.split(/\s+/).length;

  const wasIncomplete = lastQ && INCOMPLETE_PHRASES.some(re => re.test(lastQ.text));
  const isShortFragment = wordCount <= 4 && !/^(what|why|how|explain|can you|write|implement)\b/i.test(trimmed);

  if (lastQ && timeSinceLastQ < 7000 && (wasIncomplete || isShortFragment)) {
    // Abort previous partial answer
    if (session.activeAbort) {
      session.activeAbort.abort();
      session.activeAbort = null;
    }

    // Clean up any in-progress or interrupted answer for that premature question
    session.messages = session.messages.filter(m => !(m.role === 'answer' && m.parentId === lastQ.id));

    // Merge: "write a code for" + "palindrome" -> "write a code for palindrome"
    lastQ.text = `${lastQ.text.trim()} ${trimmed}`;
    lastQ.rawText = `${lastQ.rawText ? lastQ.rawText.trim() : lastQ.text.trim()} ${rawText}`;
    lastQ.uncertainWords = analysis.uncertainWords;
    lastQ.createdAt = Date.now();
    session.pendingQuestionHash = hashText(lastQ.text);

    // Broadcast updated question so UI updates single bubble
    broadcastToSession(sessionId, {
      type: 'question_updated',
      msgId: lastQ.id,
      text: lastQ.text,
      rawText: lastQ.rawText,
      uncertainWords: lastQ.uncertainWords,
      sessionId
    });

    // Stream the new unified answer
    streamAiAnswer(sessionId, lastQ.text, lastQ.id, session);
    return;
  }

  // Deduplicate by question hash
  const qHash = hashText(trimmed);
  if (session.pendingQuestionHash === qHash) return; // same question already committed
  session.pendingQuestionHash = qHash;

  const qMsgId = uid('q');
  const qMsg = {
    id: qMsgId,
    role: 'question',
    text: trimmed,
    rawText: rawText,
    uncertainWords: analysis.uncertainWords,
    isEdited: false,
    status: 'complete',
    parentId: null,
    reqId: null,
    ttft: 0,
    totalTime: 0,
    createdAt: Date.now()
  };
  session.messages.push(qMsg);

  broadcastToSession(sessionId, {
    type: 'question_committed',
    msgId: qMsgId,
    text: trimmed,
    rawText: rawText,
    uncertainWords: analysis.uncertainWords,
    sessionId
  });

  // Abort any in-progress generation
  if (session.activeAbort) {
    session.activeAbort.abort();
    // Mark the in-progress answer as interrupted — use reverse().find() for Node 16 compat
    const inProgress = [...session.messages].reverse().find(m => m.role === 'answer' && m.status === 'streaming');
    if (inProgress) {
      inProgress.status = 'interrupted';
      broadcastToSession(sessionId, {
        type: 'chat_interrupted',
        msgId: inProgress.id,
        sessionId
      });
    }
  }

  streamAiAnswer(sessionId, trimmed, qMsgId, session);
}

// ─────────────────────────────────────────────────────────────
//  Main streaming answer function
// ─────────────────────────────────────────────────────────────
async function streamAiAnswer(sessionId, question, questionMsgId, session, continueFromText = '') {
  const reqId = uid('req');
  const aMsgId = uid('a');
  const startTime = Date.now();

  const abort = new AbortController();
  session.activeAbort = abort;
  session.activeReqId = reqId;

  // Create answer message
  const aMsg = {
    id: aMsgId,
    role: 'answer',
    text: continueFromText,
    status: 'streaming',
    parentId: questionMsgId,
    reqId,
    ttft: 0,
    totalTime: 0,
    createdAt: Date.now()
  };
  session.messages.push(aMsg);

  broadcastToSession(sessionId, {
    type: 'chat_message',
    msgId: aMsgId,
    parentId: questionMsgId,
    reqId,
    role: 'answer',
    text: continueFromText,
    status: 'streaming',
    sessionId
  });

  const ctx = buildContext(session, question);
  const systemPrompt = buildSystemPrompt(ctx);

  const userContent = continueFromText
    ? `Continue from where you stopped. Do NOT repeat what was already said.\n\nPrevious partial answer:\n${continueFromText}\n\nOriginal question: "${question}"`
    : (ctx.isFollowUp && ctx.parentQuestion
      ? `FOLLOW-UP QUESTION: "${question}"\n\nRecent conversation:\n${ctx.recentHistory.map(m => `[${m.role}] ${m.text}`).join('\n')}`
      : `INTERVIEW QUESTION: "${question}"`);

  const groqKey = process.env.GROQ_API_KEY;

  if (!groqKey) {
    await streamMockAnswer(sessionId, question, aMsgId, reqId, startTime, abort.signal, continueFromText);
    return;
  }

  const models = ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile'];
  const groq = new Groq({ apiKey: groqKey });

  for (const model of models) {
    if (abort.signal.aborted) break;

    try {
      const stream = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        model,
        temperature: 0.25,
        max_tokens: 800,
        stream: true
      }, { signal: abort.signal });

      let seqNo = 0;
      let accumulated = continueFromText;
      let ttftSent = false;

      for await (const chunk of stream) {
        if (abort.signal.aborted) break;

        // Reject if session moved to a new request
        if (session.activeReqId !== reqId) break;

        const text = chunk.choices[0]?.delta?.content || '';
        if (!text) continue;

        accumulated += text;
        aMsg.text = accumulated;

        if (!ttftSent) {
          ttftSent = true;
          aMsg.ttft = Date.now() - startTime;
          broadcastToSession(sessionId, {
            type: 'chat_start',
            msgId: aMsgId,
            reqId,
            ttft: aMsg.ttft,
            sessionId
          });
        }

        broadcastToSession(sessionId, {
          type: 'chat_chunk',
          msgId: aMsgId,
          reqId,
          seqNo: seqNo++,
          chunk: text,
          fullText: accumulated,
          sessionId
        });
      }

      if (!abort.signal.aborted && session.activeReqId === reqId) {
        const totalTime = Date.now() - startTime;
        aMsg.status = 'complete';
        aMsg.totalTime = totalTime;

        broadcastToSession(sessionId, {
          type: 'chat_done',
          msgId: aMsgId,
          reqId,
          fullText: accumulated,
          totalTime,
          sessionId
        });

        // Reset pending hash so same question can be re-asked later
        session.pendingQuestionHash = null;
        session.activeReqId = null;
        session.activeAbort = null;
      }
      return; // success — exit model loop

    } catch (err) {
      if (abort.signal.aborted) break;

      const status = err.status || err.statusCode;

      if (status === 429) {
        // Rate limit — extract retry-after if available
        const retryAfter = parseInt(err.headers?.['retry-after'] || '5', 10);
        broadcastToSession(sessionId, {
          type: 'chat_error',
          msgId: aMsgId,
          reqId,
          error: 'rate_limit',
          retryAfter,
          message: `Rate limited by Groq. Retrying in ${retryAfter}s...`,
          sessionId
        });
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue; // retry with same or next model
      }

      if (status === 401) {
        broadcastToSession(sessionId, {
          type: 'chat_error', msgId: aMsgId, reqId, error: 'auth',
          message: 'Groq API key invalid.', sessionId
        });
        break;
      }

      console.warn(`Model ${model} error: ${err.message}`);
      // Try next model
    }
  }

  // All models failed or aborted
  if (!abort.signal.aborted && session.activeReqId === reqId) {
    if (aMsg.text.length === 0) {
      // Nothing was generated — fall back to mock
      await streamMockAnswer(sessionId, question, aMsgId, reqId, startTime, abort.signal, continueFromText);
    } else {
      aMsg.status = 'interrupted';
      broadcastToSession(sessionId, {
        type: 'chat_interrupted', msgId: aMsgId, reqId, sessionId
      });
    }
    // BUG FIX: always reset pendingQuestionHash so retries work
    session.pendingQuestionHash = null;
    session.activeReqId = null;
    session.activeAbort = null;
  }
}

// ─────────────────────────────────────────────────────────────
//  Mock fallback streamer (no API key / all models failed)
// ─────────────────────────────────────────────────────────────
async function streamMockAnswer(sessionId, question, aMsgId, reqId, startTime, signal, prefix = '') {
  const session = sessions.get(sessionId);
  const q = question.toLowerCase();

  let text = prefix;
  let answer = '';

  if (q.includes('sql') || q.includes('query') || q.includes('salary') || q.includes('database')) {
    answer = `To find the second-highest salary per department handling ties, use DENSE_RANK().\n\n\`\`\`sql\nSELECT department, employee_name, salary\nFROM (\n  SELECT department, employee_name, salary,\n         DENSE_RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS rnk\n  FROM employees\n  WHERE salary IS NOT NULL\n) ranked\nWHERE rnk = 2;\n\`\`\`\n\nDENSE_RANK gives rank 2 to all employees tied at the second-highest salary in each department. NULL salaries are excluded with the WHERE clause. Time complexity is O(n log n) due to the window function sort.`;
  } else if (q.includes('react') || q.includes('virtual dom') || q.includes('usememo')) {
    answer = `React's Virtual DOM is a lightweight JS representation of the real DOM. When state changes, React diffs the old and new virtual trees and applies only the minimum required real DOM updates.\n\n**Key points:**\n- Reconciliation uses fiber architecture to prioritize updates\n- useMemo caches computed values; useCallback caches function references to prevent child re-renders\n- Keys in lists help React identify which items changed\n\n**Example:** In our real-time dashboard, wrapping chart components in React.memo cut re-renders by ~60% under high data throughput.`;
  } else if (q.includes('node') || q.includes('event loop')) {
    answer = `Node.js runs on a single thread using a non-blocking event loop powered by libuv.\n\n**Loop phases:** Timers → Pending I/O → Idle → Poll → Check (setImmediate) → Close\n\nMicrotasks (Promises, process.nextTick) drain completely between each phase.\n\n**Example:** I built a WebSocket gateway sustaining 50k concurrent connections by keeping all I/O async and delegating CPU tasks to Worker Threads.`;
  } else if (q.includes('broadcast join') || q.includes('join')) {
    answer = `A broadcast join sends a small table to every node in a distributed cluster so no data shuffle is needed for the large table.\n\n**Use it when:** the smaller table fits in memory (typically < 10MB in Spark).\n\n**Avoid it when:** the broadcast table is large — it increases driver memory pressure and network cost on every node.\n\n**Example:** In PySpark: \`spark.sql(\"SELECT /*+ BROADCAST(dim) */ * FROM fact JOIN dim ON fact.id = dim.id\")\``;
  } else {
    answer = `${question.replace(/^(what is|how do|explain|tell me about)\s+/i, '').charAt(0).toUpperCase() + question.replace(/^(what is|how do|explain|tell me about)\s+/i, '').slice(1)} involves balancing correctness, performance, and maintainability.\n\n**Core concept:** Break the problem into well-scoped pieces, handle edge cases explicitly, and prefer proven patterns over custom solutions.\n\n**Example:** In my microservices work, applying this approach reduced incident response time by improving observability and reducing inter-service coupling.`;
  }

  const fullAnswer = text + answer;
  const words = fullAnswer.slice(text.length).split(/(?<=\s)/);
  let accumulated = text;
  let seqNo = 0;
  let ttftSent = text.length > 0;

  if (text.length > 0) {
    broadcastToSession(sessionId, { type: 'chat_start', msgId: aMsgId, reqId, ttft: 0, sessionId });
  }

  // Node 16 compatible findLast helper
  const findMsgById = (id) => [...(session?.messages || [])].reverse().find(m => m.id === id);

  for (const word of words) {
    if (signal?.aborted || session?.activeReqId !== reqId) break;
    accumulated += word;
    const liveMsg = findMsgById(aMsgId);
    if (liveMsg) liveMsg.text = accumulated;

    if (!ttftSent) {
      ttftSent = true;
      broadcastToSession(sessionId, { type: 'chat_start', msgId: aMsgId, reqId, ttft: Date.now() - startTime, sessionId });
    }
    broadcastToSession(sessionId, { type: 'chat_chunk', msgId: aMsgId, reqId, seqNo: seqNo++, chunk: word, fullText: accumulated, sessionId });
    await new Promise(r => setTimeout(r, 12));
  }

  if (!(signal?.aborted) && session?.activeReqId === reqId) {
    const totalTime = Date.now() - startTime;
    const doneMsg = findMsgById(aMsgId);
    if (doneMsg) { doneMsg.status = 'complete'; doneMsg.totalTime = totalTime; }
    broadcastToSession(sessionId, { type: 'chat_done', msgId: aMsgId, reqId, fullText: accumulated, totalTime, sessionId });
    if (session) { session.activeReqId = null; session.activeAbort = null; session.pendingQuestionHash = null; }
  }
}

// ─────────────────────────────────────────────────────────────
//  REST endpoints
// ─────────────────────────────────────────────────────────────
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

app.get('/api/info', (req, res) => {
  res.json({
    status: 'online',
    localIp: getLocalIpAddress(),
    port: PORT,
    hasGroqKey: Boolean(process.env.GROQ_API_KEY),
    hasDeepgramKey: Boolean(process.env.DEEPGRAM_API_KEY),
  });
});

app.get('/api/context', (req, res) => res.json(candidateContext));
app.post('/api/context', (req, res) => {
  const fields = ['resume', 'targetRole', 'jobDescription', 'projects', 'guardrails', 'language'];
  fields.forEach(f => { if (req.body[f] !== undefined) candidateContext[f] = req.body[f]; });
  res.json({ success: true, context: candidateContext });
});

app.get('/api/vocabulary', (req, res) => {
  res.json({
    terms: getTechnicalVocabularyList(),
    count: technicalVocabulary.size
  });
});

app.post('/api/vocabulary', (req, res) => {
  const { terms, term } = req.body;
  if (term && typeof term === 'string') {
    technicalVocabulary.add(term.trim());
  }
  if (Array.isArray(terms)) {
    terms.forEach(t => {
      if (typeof t === 'string' && t.trim()) technicalVocabulary.add(t.trim());
    });
  }
  res.json({ success: true, terms: getTechnicalVocabularyList() });
});

// History endpoint — restore chat on reconnect
app.get('/api/history/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.json({ messages: [] });
  res.json({ messages: session.messages.slice(-40) }); // last 40 messages
});

// Serve frontend
const clientDistPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  const indexFile = path.join(clientDistPath, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>AI Interview Copilot</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px;">
          <div>
            <h1 style="color: #38bdf8;">🚀 AI Interview Copilot Server Running</h1>
            <p style="color: #94a3b8; max-width: 500px; margin: 16px auto;">The frontend is being built or was not compiled yet. Run <code>npm run build</code> in the client folder or check your deployment build command.</p>
          </div>
        </body>
      </html>
    `);
  }
});

// ─────────────────────────────────────────────────────────────
//  WebSocket connection manager & Keep-Alive Heartbeat
// ─────────────────────────────────────────────────────────────
// Prevent Render / reverse proxy from dropping idle WebSocket connections (every 20s)
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((wsClient) => {
    if (wsClient.isAlive === false) {
      try { wsClient.terminate(); } catch (e) {}
      return;
    }
    wsClient.isAlive = false;
    try {
      wsClient.ping();
      wsClient.send(JSON.stringify({ type: 'heartbeat_ping', timestamp: Date.now() }));
    } catch (e) {}
  });
}, 20000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let currentSessionId = null;
  let userRole = null;
  let deepgramWs = null;
  let keepAliveInterval = null;
  const audioChunkQueue = [];

  function buildDeepgramUrl() {
    const params = new URLSearchParams();
    params.set('model', 'nova-2');
    params.set('smart_format', 'true');
    params.set('interim_results', 'true');
    params.set('utterance_end_ms', '1200');
    params.set('vad_events', 'true');
    params.set('filler_words', 'false');

    // Add technical vocabulary via repeated keywords parameters with :2 boost
    const terms = getTechnicalVocabularyList();
    for (const term of terms) {
      params.append('keywords', `${term}:2`);
    }

    return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  }

  function ensureDeepgramSocket(sessionId) {
    const dgKey = process.env.DEEPGRAM_API_KEY;
    if (!dgKey) return null;
    if (deepgramWs?.readyState === WebSocket.OPEN) return deepgramWs;
    if (deepgramWs?.readyState === WebSocket.CONNECTING) return deepgramWs;

    const dgUrl = buildDeepgramUrl();

    try {
      deepgramWs = new WebSocket(dgUrl, { headers: { Authorization: `Token ${dgKey}` } });

      deepgramWs.on('open', () => {
        ws.send(JSON.stringify({ type: 'deepgram_status', status: 'connected' }));

        // Flush any audio chunks queued while connecting
        while (audioChunkQueue.length > 0) {
          try {
            const chunk = audioChunkQueue.shift();
            deepgramWs.send(chunk);
          } catch (e) {}
        }

        keepAliveInterval = keepAliveInterval || setInterval(() => {
          if (deepgramWs?.readyState === WebSocket.OPEN) {
            deepgramWs.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 5000);
      });

      deepgramWs.on('message', (dgMsg) => {
        try {
          const payload = JSON.parse(dgMsg.toString());
          const session = sessions.get(sessionId);
          if (!session) return;

          const transcript = payload.channel?.alternatives[0]?.transcript || '';
          const words = payload.channel?.alternatives[0]?.words || [];
          const isFinal = payload.is_final;
          const speechFinal = payload.speech_final;
          const type = payload.type;

          // Broadcast raw transcript to UI
          if (transcript.trim()) {
            const tHash = hashText(transcript);
            if (isFinal && session.seenTranscriptHashes.has(tHash)) return;
            if (isFinal) {
              session.seenTranscriptHashes.add(tHash);
              if (session.seenTranscriptHashes.size > 200) {
                const arr = [...session.seenTranscriptHashes];
                session.seenTranscriptHashes = new Set(arr.slice(-100));
              }
            }

            broadcastToSession(sessionId, {
              type: 'transcript_update',
              transcript,
              isFinal: isFinal || false,
              speechFinal: speechFinal || false
            });

            if (isFinal) {
              const committed = session.transcriptAccumulator.addFinal(transcript, speechFinal, words);
              if (committed) {
                commitQuestion(sessionId, committed, session, session.transcriptAccumulator.consumeWords(), committed);
              }
            } else {
              session.transcriptAccumulator.addInterim(transcript);
            }
          }

          // VAD silence event — only commit if sentence is grammatically complete!
          if (type === 'UtteranceEnd') {
            const acc = session.transcriptAccumulator;
            const full = (acc.committed ? acc.committed + ' ' + acc.interim : acc.interim).trim();
            if (full && !acc.isIncomplete(full)) {
              const words = acc.consumeWords();
              const committed = acc.forceCommit();
              if (committed) commitQuestion(sessionId, committed, session, words, committed);
            }
          }
        } catch (e) {
          console.error('Deepgram parse error:', e.message);
        }
      });

      deepgramWs.on('error', err => console.error('Deepgram WS Error:', err.message));
      deepgramWs.on('close', () => {
        if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
        deepgramWs = null;
      });

      return deepgramWs;
    } catch (e) {
      console.error('Deepgram init error:', e.message);
      return null;
    }
  }

  ws.on('message', async (message, isBinary) => {
    // Binary = audio chunk from MediaRecorder (laptop tab/mic or mobile mic)
    if (isBinary) {
      const dgSocket = ensureDeepgramSocket(currentSessionId || 'SESSION-1');
      if (dgSocket?.readyState === WebSocket.OPEN) {
        while (audioChunkQueue.length > 0) {
          try { dgSocket.send(audioChunkQueue.shift()); } catch (e) {}
        }
        try { dgSocket.send(message); } catch (e) {}
      } else if (dgSocket?.readyState === WebSocket.CONNECTING) {
        if (audioChunkQueue.length < 50) {
          audioChunkQueue.push(message);
        }
      }
      return;
    }

    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {

        case 'heartbeat_pong': {
          ws.isAlive = true;
          break;
        }

        case 'register': {
          currentSessionId = data.session || 'SESSION-1';
          userRole = data.role || 'laptop';
          const session = getOrCreateSession(currentSessionId);

          // Clear any pending cleanup timer for this session
          if (session.cleanupTimer) {
            clearTimeout(session.cleanupTimer);
            session.cleanupTimer = null;
          }

          if (userRole === 'laptop') {
            session.laptopWs = ws;
          } else {
            session.mobileWss.add(ws);
          }

          const currentAcc = session.transcriptAccumulator;
          const currentTranscript = (currentAcc.committed ? currentAcc.committed + ' ' + currentAcc.interim : currentAcc.interim).trim();

          // Send existing chat history & current transcript on join/reconnect
          ws.send(JSON.stringify({
            type: 'registered',
            session: currentSessionId,
            role: userRole,
            mobileCount: session.mobileWss.size,
            history: session.messages.slice(-40),
            currentTranscript
          }));

          notifyPeerStatus(currentSessionId);
          break;
        }

        case 'start_deepgram_flux': {
          ensureDeepgramSocket(currentSessionId || 'SESSION-1');
          break;
        }

        case 'stop_deepgram': {
          if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
          deepgramWs?.close();
          deepgramWs = null;
          break;
        }

        case 'transcript_sync': {
          // Web Speech API path (browser speech recognition)
          const session = sessions.get(currentSessionId);
          if (!session) break;

          broadcastToSession(currentSessionId, {
            type: 'transcript_update',
            transcript: data.transcript,
            isFinal: data.isFinal
          });

          if (data.isFinal) {
            const committed = session.transcriptAccumulator.addFinal(data.transcript, false);
            if (committed) commitQuestion(currentSessionId, committed, session);
          } else {
            session.transcriptAccumulator.addInterim(data.transcript);
          }
          break;
        }

        case 'trigger_answer': {
          // Manual "Answer Now" button from laptop or mobile HUD
          const session = sessions.get(currentSessionId) || getOrCreateSession(currentSessionId);
          let q = data.question?.trim();
          if (!q) {
            const acc = session.transcriptAccumulator;
            q = (acc.committed ? acc.committed + ' ' + acc.interim : acc.interim).trim();
          }
          if (q) {
            session.pendingQuestionHash = null;
            session.transcriptAccumulator.committed = '';
            session.transcriptAccumulator.interim = '';
            session.transcriptAccumulator._clearSettle();
            commitQuestion(currentSessionId, q, session);
          }
          break;
        }

        case 'continue_answer': {
          // Resume an interrupted answer
          const session = sessions.get(currentSessionId);
          if (!session || !data.msgId) break;
          const aMsg = session.messages.find(m => m.id === data.msgId);
          if (!aMsg || aMsg.role !== 'answer') break;
          const qMsg = session.messages.find(m => m.id === aMsg.parentId);
          if (!qMsg) break;

          session.pendingQuestionHash = null;
          await streamAiAnswer(currentSessionId, qMsg.text, qMsg.id, session, aMsg.text);
          break;
        }

        case 'explain_more': {
          const session = sessions.get(currentSessionId) || getOrCreateSession(currentSessionId);
          let q = data.question?.trim();
          if (!q) {
            const lastQ = [...session.messages].reverse().find(m => m.role === 'question');
            q = lastQ?.text || (session.transcriptAccumulator.committed ? session.transcriptAccumulator.committed + ' ' + session.transcriptAccumulator.interim : session.transcriptAccumulator.interim).trim();
          }
          if (q) {
            session.pendingQuestionHash = null;
            commitQuestion(currentSessionId, `Explain in more detail with clear steps and examples: ${q}`, session);
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

        case 'edit_question': {
          // Edit a misunderstood question and regenerate answer cleanly
          const session = sessions.get(currentSessionId);
          if (!session || !data.msgId || !data.newText?.trim()) break;

          const qMsg = session.messages.find(m => m.id === data.msgId);
          if (!qMsg || qMsg.role !== 'question') break;

          const updatedText = data.newText.trim();

          // Abort current answer generation if active
          if (session.activeAbort) {
            session.activeAbort.abort();
            session.activeAbort = null;
          }
          session.activeReqId = null;

          // Remove any in-progress or interrupted answer associated with this question
          session.messages = session.messages.filter(m => !(m.role === 'answer' && m.parentId === qMsg.id));

          // Update question text and mark as edited
          qMsg.text = updatedText;
          qMsg.isEdited = true;
          qMsg.uncertainWords = [];
          session.pendingQuestionHash = hashText(updatedText);

          // Broadcast question update to laptop and mobile HUD
          broadcastToSession(currentSessionId, {
            type: 'question_updated',
            msgId: qMsg.id,
            text: updatedText,
            isEdited: true,
            sessionId: currentSessionId
          });

          // Generate fresh answer under new request ID
          streamAiAnswer(currentSessionId, updatedText, qMsg.id, session);
          break;
        }

        case 'clear_history': {
          const session = sessions.get(currentSessionId);
          if (session) {
            session.messages = [];
            session.pendingQuestionHash = null;
            broadcastToSession(currentSessionId, { type: 'history_cleared' });
          }
          break;
        }
      }
    } catch (err) {
      console.error('WebSocket parse error:', err);
    }
  });

  ws.on('close', () => {
    if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
    deepgramWs?.close();

    if (currentSessionId && sessions.has(currentSessionId)) {
      const session = sessions.get(currentSessionId);
      if (userRole === 'mobile') {
        session.mobileWss.delete(ws);
      } else if (userRole === 'laptop' && session.laptopWs === ws) {
        session.laptopWs = null;
      }

      // Schedule cleanup after 10 minutes rather than instant deletion so mobile screen sleep doesn't lose state
      if (!session.laptopWs && session.mobileWss.size === 0) {
        if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
        session.cleanupTimer = setTimeout(() => {
          if (!session.laptopWs && session.mobileWss.size === 0) {
            sessions.delete(currentSessionId);
          }
        }, 10 * 60 * 1000);
      } else {
        notifyPeerStatus(currentSessionId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 AI Interview Copilot Server running on port ${PORT}`);
  console.log(`🌐 Local IP: http://${getLocalIpAddress()}:${PORT}`);
  console.log(`====================================================`);
});
