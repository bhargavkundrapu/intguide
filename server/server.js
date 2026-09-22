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
//  100+ Technical Keywords (PySpark, Big Data, SQL, System Design, Cloud)
// ─────────────────────────────────────────────────────────────
const DEFAULT_100_TECHNICAL_KEYWORDS = [
  // 1. PySpark & Distributed Computing
  'PySpark', 'coalesce', 'repartition', 'broadcast join', 'shuffle join', 'partition projection',
  'dense_rank', 'row_number', 'DataFrame', 'RDD', 'Spark SQL', 'Catalyst Optimizer',
  'Tungsten Engine', 'Spark Submit', 'Driver Memory', 'Executor Memory', 'Executor Cores',
  'Dynamic Allocation', 'Spill to Disk', 'Skew Join', 'Salt Key', 'Broadcast Hash Join',
  'Sort Merge Join', 'Shuffle Hash Join', 'Accumulator', 'Broadcast Variable', 'DAG',
  'Lineage Graph', 'Wide Transformation', 'Narrow Transformation', 'Watermarking',
  'Structured Streaming', 'Checkpointing', 'Write-Ahead Log', 'Shuffle Partition',
  // 2. Storage, Formats & Lakes
  'Delta Lake', 'Parquet', 'ORC', 'Snappy', 'Gzip', 'Columnar Storage', 'Predicate Pushdown',
  'Projection Pruning', 'Schema Registry', 'Avro', 'Data Lakehouse', 'Medallion Architecture',
  'Bronze Layer', 'Silver Layer', 'Gold Layer', 'Data Vault', 'Data Mesh', 'dbt',
  // 3. Databases, Warehouses & Analytics Engines
  'Databricks', 'AWS Athena', 'AWS Redshift', 'Redshift Spectrum', 'S3 Select',
  'Snowflake', 'Virtual Warehouse', 'Micro-partitions', 'Clustering Key',
  'PostgreSQL', 'MySQL', 'Redis', 'Cassandra', 'DynamoDB', 'Presto', 'Trino', 'Hive Metastore',
  // 4. Data Modeling & SQL
  'Star Schema', 'Snowflake Schema', 'Slowly Changing Dimension', 'SCD Type 1', 'SCD Type 2',
  'Fact Table', 'Dimension Table', 'Surrogate Key', 'OLAP', 'OLTP', 'ACID', 'WAL',
  'Window Functions', 'LAG', 'LEAD', 'NTILE', 'CUME_DIST', 'CTE', 'Recursive CTE',
  'Explain Plan', 'Cost-Based Optimizer', 'Partition By', 'Cluster By', 'B-Tree Index', 'Hash Index',
  // 5. Streaming, CDC & Orchestration
  'Apache Kafka', 'Kafka Topic', 'Consumer Group', 'Partition Offset', 'Exactly Once',
  'At Least Once', 'At Most Once', 'Debezium', 'CDC', 'Change Data Capture',
  'Apache Airflow', 'Airflow DAG', 'Operator', 'Sensor', 'Backfill', 'XComs', 'Celery Executor',
  // 6. Backend, Cloud & System Design
  'Kubernetes', 'Docker', 'WebSockets', 'GraphQL', 'TypeScript', 'Node.js',
  'CAP Theorem', 'Eventual Consistency', 'Idempotency', 'Load Balancer', 'Reverse Proxy',
  'Rate Limiting', 'Microservices', 'Out of Memory', 'Garbage Collection',
  // 7. Core Algorithms & Patterns
  'palindrome', 'two pointer', 'sliding window', 'binary search', 'dynamic programming',
  'depth first search', 'breadth first search', 'memoization', 'in-place'
];

const candidateContext = {
  resume: "Senior Full Stack & Data Engineer with 5+ years building distributed data pipelines in PySpark, Databricks, Delta Lake, AWS (Athena, Redshift, S3), Kafka, and scalable Node.js/React applications.",
  targetRole: "Senior Data / Full Stack Engineer",
  jobDescription: "Build low-latency real-time applications, large-scale data pipelines with PySpark and Databricks, scale Node.js services, design clean UIs, work with LLM APIs.",
  projects: "1. Real-time Audio Analytics Platform: WebSockets, Node.js pipelines, React dashboard.\n2. Data Lakehouse Architecture: PySpark, Delta Lake, Databricks, Redshift, Athena for 10TB+ daily telemetry.",
  guardrails: "Use only verified candidate facts. For missing experience, give industry best-practice answer and note candidate familiarity. Never invent metrics, employers, or results.",
  language: "English",
  keywords: [...DEFAULT_100_TECHNICAL_KEYWORDS]
};

const technicalVocabulary = new Set(DEFAULT_100_TECHNICAL_KEYWORDS);

function getTechnicalVocabularyList() {
  const list = new Set(technicalVocabulary);
  if (Array.isArray(candidateContext.keywords)) {
    candidateContext.keywords.forEach(k => {
      if (typeof k === 'string' && k.trim()) list.add(k.trim());
    });
  }
  return Array.from(list);
}

// Critical words classification for word-level confidence checking
const NEGATION_WORDS = new Set(['not', 'never', 'no', 'without', 'neither', 'nor', 'dont', 'doesnt', 'cant', 'isnt', 'wont']);
const COMPARISON_WORDS = new Set(['difference', 'versus', 'vs', 'ascending', 'descending', 'in-place', 'recursive', 'iterative', 'higher', 'lower']);

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

// Token Jaccard similarity for acoustic echo / microphone leakage detection
function calculateTextSimilarity(str1, str2) {
  const set1 = new Set((str1 || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  const set2 = new Set((str2 || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  if (set1.size === 0 || set2.size === 0) return 0;
  let intersection = 0;
  for (const s of set1) {
    if (set2.has(s)) intersection++;
  }
  const union = new Set([...set1, ...set2]).size;
  return union === 0 ? 0 : intersection / union;
}

// ─────────────────────────────────────────────────────────────
//  Session store: sessionId → ConversationSession
// ─────────────────────────────────────────────────────────────
const sessions = new Map();

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      laptopWs: null,
      mobileWss: new Set(),
      messages: [],
      activeReqId: null,
      activeAbort: null,
      // Dual accumulators for independent transcription
      interviewerAccumulator: new TranscriptAccumulator(sessionId),
      candidateAccumulator: new CandidateAccumulator(sessionId),
      // Dual Deepgram socket tracking per session
      interviewerDeepgramWs: null,
      candidateDeepgramWs: null,
      interviewerQueue: [],
      candidateQueue: [],
      interviewerSocketEpoch: Date.now(),
      candidateSocketEpoch: Date.now(),
      recentInterviewerUtterances: [], // For leakage detection
      seenTranscriptHashes: new Set(),
      pendingQuestionHash: null,
      cleanupTimer: null
    });
  }
  return sessions.get(sessionId);
}

// ─────────────────────────────────────────────────────────────
//  TranscriptAccumulator
//  Collects Deepgram fragments → commits complete questions
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
const INCOMPLETE_PHRASES = [
  // Trailing prepositions & particles (demand a noun/target object)
  /\b(for|to|of|in|about|with|between|by|from|like|into|on|as|at|towards|upon|within)\s*$/i,
  // Trailing conjunctions & clause connectors
  /\b(and|or|but|because|if|when|while|where|so|than|whereas|whether|although|though|unless)\s*$/i,
  // Trailing articles & determiners
  /\b(a|an|the|this|that|these|those|my|your|our|their|his|her|its)\s*$/i,
  // Trailing auxiliary/linking verbs
  /\b(is|are|was|were|be|being|been|does|do|did|can|could|should|would|will|shall|might|must|have|has|had)\s*$/i,
  // Common unfinished interview directive openings
  /\b(write a code for|write code for|write a program for|how to implement|implement a|create a|explain how to|can you explain|difference between|what is the)\s*$/i,
  // Common multi-word connectors
  /\bfor example\s*$/i, /\bsuch as\s*$/i, /\bthere are\s+\w+\s+conditions?$/i, /\bassuming\s*$/i,
  /\bincluding\s*$/i, /\bfor\s+each\s*$/i
];

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
      // If trailing phrase is incomplete (e.g., ends in "for"), keep waiting up to 7s window
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

      // If trailing word is a preposition/connector and within the 7s speech window, wait longer!
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
//  CandidateAccumulator
//  Collects candidate microphone speech (spoken answers & clarifications)
//  Does NOT trigger automated AI generation!
// ─────────────────────────────────────────────────────────────
class CandidateAccumulator {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.committed = '';
    this.interim = '';
    this.words = [];
    this.settleTimer = null;
    this.speechStartTime = null;
    this.SETTLE_MS = 1400;
  }

  addInterim(text) {
    if (!this.speechStartTime) this.speechStartTime = Date.now();
    this.interim = text;
    this._scheduleSettle(this.SETTLE_MS);
  }

  addFinal(text, speechFinal, words = []) {
    if (!this.speechStartTime) this.speechStartTime = Date.now();
    if (Array.isArray(words) && words.length > 0) {
      this.words.push(...words);
    }
    this.committed = this.committed ? this.committed.trimEnd() + ' ' + text.trim() : text.trim();
    this.interim = '';

    if (speechFinal) {
      this._clearSettle();
      return this._commit();
    } else {
      this._scheduleSettle(this.SETTLE_MS);
    }
    return null;
  }

  forceCommitProvisional() {
    this._clearSettle();
    const result = this._commit();
    if (result) {
      const session = sessions.get(this.sessionId);
      if (session) commitCandidateSpeech(this.sessionId, result.text, session, result.words, result.startTime, result.endTime, true);
    }
  }

  _commit() {
    const full = (this.committed ? this.committed + ' ' + this.interim : this.interim).trim();
    const words = [...this.words];
    const startTime = this.speechStartTime || Date.now();
    const endTime = Date.now();

    this.committed = '';
    this.interim = '';
    this.words = [];
    this.speechStartTime = null;

    if (!full || NOISE_ONLY.test(full)) return null;
    return { text: full, words, startTime, endTime };
  }

  _scheduleSettle(ms) {
    this._clearSettle();
    this.settleTimer = setTimeout(() => {
      const result = this._commit();
      if (result) {
        const session = sessions.get(this.sessionId);
        if (session) commitCandidateSpeech(this.sessionId, result.text, session, result.words, result.startTime, result.endTime, false);
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

function commitCandidateSpeech(sessionId, text, session, words = [], startTime = Date.now(), endTime = Date.now(), isProvisional = false) {
  const trimmed = text.trim();
  if (!trimmed) return;

  // Echo / Leakage detection against recent interviewer utterances
  let isEchoLeakage = false;
  const now = Date.now();
  const recentInterviewer = (session.recentInterviewerUtterances || []).filter(u => now - u.timestamp < 4000);
  for (const item of recentInterviewer) {
    const sim = calculateTextSimilarity(trimmed, item.text);
    if (sim > 0.85) {
      isEchoLeakage = true;
      break;
    }
  }

  const cMsgId = uid('c');
  const analysis = analyzeWordUncertainty(words, technicalVocabulary);

  const cMsg = {
    id: cMsgId,
    role: 'candidate',
    text: trimmed,
    uncertainWords: analysis.uncertainWords,
    isEchoLeakage,
    isProvisional,
    startTime,
    endTime,
    createdAt: now
  };

  session.messages.push(cMsg);

  broadcastToSession(sessionId, {
    type: 'candidate_speech_final',
    msgId: cMsgId,
    text: trimmed,
    uncertainWords: analysis.uncertainWords,
    isEchoLeakage,
    isProvisional,
    startTime,
    endTime,
    createdAt: now,
    sessionId
  });
}

// ─────────────────────────────────────────────────────────────
//  Context builder — 3 roles (Interviewer, Candidate Spoken, AI Suggestion)
// ─────────────────────────────────────────────────────────────
function buildContext(session, currentQuestion) {
  const messages = session.messages;
  const recent = messages.slice(-10); // last 10 messages across all 3 roles

  const structuredHistory = recent.map(m => {
    let speakerLabel = 'Interviewer';
    if (m.role === 'candidate') speakerLabel = 'Candidate (Spoken Answer)';
    else if (m.role === 'answer') speakerLabel = 'AI Copilot (Suggestion - not spoken)';

    return {
      role: m.role,
      speaker: speakerLabel,
      text: m.text.slice(0, 800),
      isEcho: m.isEchoLeakage || false
    };
  });

  // Find candidate's latest spoken statement for follow-up resolution
  const candidateSpeeches = messages.filter(m => m.role === 'candidate');
  const latestCandidateSpeech = candidateSpeeches.length > 0 ? candidateSpeeches[candidateSpeeches.length - 1].text : null;

  return {
    currentQuestion,
    recentHistory: structuredHistory,
    latestCandidateSpeech,
    candidate: candidateContext
  };
}

// ─────────────────────────────────────────────────────────────
//  System prompt — Grounded in Candidate Spoken Answer
// ─────────────────────────────────────────────────────────────
function buildSystemPrompt(ctx) {
  const { candidate, recentHistory, latestCandidateSpeech } = ctx;

  let candidateSpokenContext = '';
  if (latestCandidateSpeech) {
    candidateSpokenContext = `
CANDIDATE'S LATEST ACTUAL SPOKEN WORDS (GROUND TRUTH):
"${latestCandidateSpeech}"
`;
  }

  return `You are an elite real-time AI Interview Copilot for a Senior Data & Full Stack Engineer.

CRITICAL INSTRUCTIONS ON ROLES & GROUND TRUTH:
1. The conversation history contains three distinct roles:
   - [Interviewer]: The interviewer asking questions or follow-ups.
   - [Candidate (Spoken Answer)]: What the candidate ACTUALLY SPOKE out loud. This is the GROUND TRUTH of what has been communicated to the interviewer.
   - [AI Copilot (Suggestion)]: Previous suggestions you provided. The candidate may or may not have used them. NEVER assume the candidate said them unless it appears in [Candidate (Spoken Answer)].
2. REFERENCE RESOLUTION:
   - When the interviewer asks short follow-ups like "Why?", "Can you explain that?", "What about edge cases?", "Why not repartition?", resolve the reference based on what the [Candidate (Spoken Answer)] actually stated.
3. CONCISE TECHNICAL CORRECTION:
   - If the candidate's spoken answer contains an apparent technical mistake (e.g. claiming coalesce increases partitions, confusing rank with dense_rank, or inverted complexity), provide the correction smoothly and concisely in the answer so the candidate can gracefully self-correct.
4. CODING & ANSWER FORMAT:
   - Direct, crisp, high-impact answer first.
   - If code is requested:
     * Provide the SHORTEST, SIMPLEST, most elegant code possible.
     * Wrap in markdown code fences (\`\`\`language ... \`\`\`).
     * Follow with 2-3 neat bullet points explaining the core logic, time/space complexity, and key edge cases handled.
   - Do NOT repeat what the candidate already said.${candidateSpokenContext}

CANDIDATE PROFILE & TECHNICAL BACKGROUND:
- Target Role: ${candidate.targetRole}
- Résumé: ${candidate.resume}
- Projects: ${candidate.projects}
- Rules: ${candidate.guardrails}`;
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
//  Help Me Continue Streamer — Guides candidate based on what they already spoke
// ─────────────────────────────────────────────────────────────
async function streamHelpContinue(sessionId, question, candidateSpokenText, questionMsgId, session) {
  const reqId = uid('req');
  const aMsgId = uid('a');
  const startTime = Date.now();

  const abort = new AbortController();
  session.activeAbort = abort;
  session.activeReqId = reqId;

  const aMsg = {
    id: aMsgId,
    role: 'answer',
    text: '',
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
    text: '',
    status: 'streaming',
    sessionId
  });

  const ctx = buildContext(session, question);
  const systemPrompt = buildSystemPrompt(ctx);
  const userContent = `The interviewer asked: "${question}"
The candidate has already spoken: "${candidateSpokenText || '(Candidate started answering)'}"

Suggest the NEXT 2-3 logical talking points or code steps to help the candidate continue and conclude the answer strongly.
Do NOT repeat anything the candidate already said. Jump straight into the continuation.`;

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    await streamMockAnswer(sessionId, `Continue: ${question}`, aMsgId, reqId, startTime, abort.signal, `To build upon what you said:\n- `);
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
        max_tokens: 600,
        stream: true
      }, { signal: abort.signal });

      let seqNo = 0;
      let accumulated = '';
      let ttftSent = false;

      for await (const chunk of stream) {
        if (abort.signal.aborted) break;
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

        session.activeReqId = null;
        session.activeAbort = null;
      }
      return;
    } catch (err) {
      if (abort.signal.aborted) break;
      console.warn(`Help continue model ${model} error: ${err.message}`);
    }
  }

  if (!abort.signal.aborted && session.activeReqId === reqId) {
    await streamMockAnswer(sessionId, `Continue: ${question}`, aMsgId, reqId, startTime, abort.signal, `To build upon what you said:\n- `);
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

  // Extract technical keywords from background & merge with existing 100+ keywords
  const textCorpus = `${candidateContext.resume || ''} ${candidateContext.jobDescription || ''} ${candidateContext.projects || ''} ${candidateContext.targetRole || ''}`;
  const potentialTerms = textCorpus.split(/[,.\n;()]+/).map(t => t.trim()).filter(t => {
    return t.length >= 2 && t.length <= 30 &&
      !/^(with|years?|in|and|for|the|of|to|from|on|at|by|our|my|their|his|her|this|that|building|large|scale|well|used|using|experience|work|strong|team|role|responsible|engineer|developer|build|manage|lead|high|daily|platforms?)\b/i.test(t);
  });

  potentialTerms.forEach(term => {
    const isCodeFormat = /^[a-z0-9]+_[a-z0-9_]+$/i.test(term) || /^[A-Z][a-zA-Z0-9]+$/.test(term) || /^[A-Z]{2,}$/.test(term);
    const matchesKnown = Array.from(technicalVocabulary).some(k => k.toLowerCase() === term.toLowerCase());
    if (isCodeFormat || matchesKnown) {
      technicalVocabulary.add(term);
    }
  });

  // Ensure all baseline 100+ keywords are preserved
  DEFAULT_100_TECHNICAL_KEYWORDS.forEach(k => technicalVocabulary.add(k));
  candidateContext.keywords = getTechnicalVocabularyList();

  res.json({
    success: true,
    context: candidateContext,
    keywordsCount: candidateContext.keywords.length
  });
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
  let keepAliveInterval = null;

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

  function ensureDeepgramSocket(sessionId, source = 'interviewer') {
    const dgKey = process.env.DEEPGRAM_API_KEY;
    if (!dgKey) return null;

    const session = sessions.get(sessionId) || getOrCreateSession(sessionId);
    const isCandidate = source === 'candidate';
    const currentSocket = isCandidate ? session.candidateDeepgramWs : session.interviewerDeepgramWs;
    const currentQueue = isCandidate ? session.candidateQueue : session.interviewerQueue;

    if (currentSocket?.readyState === WebSocket.OPEN) return currentSocket;
    if (currentSocket?.readyState === WebSocket.CONNECTING) return currentSocket;

    const dgUrl = buildDeepgramUrl();

    try {
      const dgWs = new WebSocket(dgUrl, { headers: { Authorization: `Token ${dgKey}` } });

      if (isCandidate) {
        session.candidateDeepgramWs = dgWs;
      } else {
        session.interviewerDeepgramWs = dgWs;
      }

      dgWs.on('open', () => {
        if (isCandidate) {
          session.candidateSocketEpoch = Date.now();
        } else {
          session.interviewerSocketEpoch = Date.now();
        }

        ws.send(JSON.stringify({
          type: 'deepgram_status',
          source,
          status: 'connected'
        }));

        // Flush any audio chunks queued while connecting
        while (currentQueue.length > 0) {
          try {
            const chunk = currentQueue.shift();
            dgWs.send(chunk);
          } catch (e) {}
        }

        dgWs.keepAliveTimer = setInterval(() => {
          if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 5000);
      });

      dgWs.on('message', (dgMsg) => {
        try {
          const payload = JSON.parse(dgMsg.toString());
          const s = sessions.get(sessionId);
          if (!s) return;

          const transcript = payload.channel?.alternatives[0]?.transcript || '';
          const words = payload.channel?.alternatives[0]?.words || [];
          const isFinal = payload.is_final;
          const speechFinal = payload.speech_final;
          const type = payload.type;
          const startRel = payload.start || 0;
          const epoch = isCandidate ? s.candidateSocketEpoch : s.interviewerSocketEpoch;
          const sessionTimestamp = epoch + Math.round(startRel * 1000);

          if (isCandidate) {
            // ── Candidate Microphone Speech Stream ──
            if (transcript.trim()) {
              broadcastToSession(sessionId, {
                type: 'candidate_transcript_update',
                transcript,
                isFinal: isFinal || false,
                speechFinal: speechFinal || false,
                sessionTimestamp
              });

              if (isFinal) {
                const committed = s.candidateAccumulator.addFinal(transcript, speechFinal, words);
                if (committed) {
                  commitCandidateSpeech(sessionId, committed.text, s, committed.words, committed.startTime, committed.endTime, false);
                }
              } else {
                s.candidateAccumulator.addInterim(transcript);
              }
            }

            if (type === 'UtteranceEnd') {
              const res = s.candidateAccumulator._commit();
              if (res) {
                commitCandidateSpeech(sessionId, res.text, s, res.words, res.startTime, res.endTime, false);
              }
            }

          } else {
            // ── Interviewer Meeting Audio Stream ──
            if (transcript.trim()) {
              const tHash = hashText(transcript);
              if (isFinal && s.seenTranscriptHashes.has(tHash)) return;
              if (isFinal) {
                s.seenTranscriptHashes.add(tHash);
                if (s.seenTranscriptHashes.size > 200) {
                  const arr = [...s.seenTranscriptHashes];
                  s.seenTranscriptHashes = new Set(arr.slice(-100));
                }
              }

              // Interruption handling:
              // If interviewer speaks while candidate was in the middle of speaking,
              // finalize candidate's partial words as provisional so they are not lost!
              if (s.candidateAccumulator && (s.candidateAccumulator.committed || s.candidateAccumulator.interim)) {
                s.candidateAccumulator.forceCommitProvisional();
              }

              broadcastToSession(sessionId, {
                type: 'transcript_update',
                transcript,
                isFinal: isFinal || false,
                speechFinal: speechFinal || false,
                sessionTimestamp
              });

              if (isFinal) {
                const committed = s.interviewerAccumulator.addFinal(transcript, speechFinal, words);
                if (committed) {
                  commitQuestion(sessionId, committed, s, s.interviewerAccumulator.consumeWords(), committed);
                }
              } else {
                s.interviewerAccumulator.addInterim(transcript);
              }
            }

            // VAD silence event — only commit if sentence is grammatically complete!
            if (type === 'UtteranceEnd') {
              const acc = s.interviewerAccumulator;
              const full = (acc.committed ? acc.committed + ' ' + acc.interim : acc.interim).trim();
              if (full && !acc.isIncomplete(full)) {
                const words = acc.consumeWords();
                const committed = acc.forceCommit();
                if (committed) commitQuestion(sessionId, committed, s, words, committed);
              }
            }
          }
        } catch (e) {
          console.error(`Deepgram ${source} parse error:`, e.message);
        }
      });

      dgWs.on('error', err => {
        console.error(`Deepgram ${source} WS Error:`, err.message);
        if (err.message && (err.message.includes('403') || err.message.includes('limit') || err.message.includes('quota'))) {
          broadcastToSession(sessionId, {
            type: 'stream_limitation',
            source,
            message: `Deepgram concurrent stream limitation reached. Retaining primary interviewer stream.`
          });
        }
      });

      dgWs.on('close', () => {
        if (dgWs.keepAliveTimer) clearInterval(dgWs.keepAliveTimer);
        if (isCandidate) {
          session.candidateDeepgramWs = null;
        } else {
          session.interviewerDeepgramWs = null;
        }
      });

      return dgWs;
    } catch (e) {
      console.error(`Deepgram ${source} init error:`, e.message);
      return null;
    }
  }

  ws.on('message', async (message, isBinary) => {
    // Binary = audio chunk from MediaRecorder
    // Byte 0 indicates source: 0x01 = interviewer (tab), 0x02 = candidate (mic), 0x03 = mobile mic
    if (isBinary) {
      let sourceName = 'interviewer';
      let audioPayload = message;

      if (message.length > 1 && (message[0] === 1 || message[0] === 2 || message[0] === 3)) {
        sourceName = (message[0] === 2 || message[0] === 3) ? 'candidate' : 'interviewer';
        audioPayload = message.subarray(1);
      }

      const session = sessions.get(currentSessionId) || getOrCreateSession(currentSessionId);
      const dgSocket = ensureDeepgramSocket(currentSessionId || 'SESSION-1', sourceName);
      const queueRef = sourceName === 'candidate' ? session.candidateQueue : session.interviewerQueue;

      if (dgSocket?.readyState === WebSocket.OPEN) {
        while (queueRef && queueRef.length > 0) {
          try { dgSocket.send(queueRef.shift()); } catch (e) {}
        }
        try { dgSocket.send(audioPayload); } catch (e) {}
      } else if (dgSocket?.readyState === WebSocket.CONNECTING) {
        if (queueRef && queueRef.length < 50) {
          queueRef.push(audioPayload);
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

          const currentAcc = session.interviewerAccumulator;
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
          ensureDeepgramSocket(currentSessionId || 'SESSION-1', 'interviewer');
          ensureDeepgramSocket(currentSessionId || 'SESSION-1', 'candidate');
          break;
        }

        case 'stop_deepgram': {
          const session = sessions.get(currentSessionId);
          if (session) {
            if (session.interviewerDeepgramWs) {
              session.interviewerDeepgramWs.close();
              session.interviewerDeepgramWs = null;
            }
            if (session.candidateDeepgramWs) {
              session.candidateDeepgramWs.close();
              session.candidateDeepgramWs = null;
            }
          }
          break;
        }

        case 'transcript_sync': {
          // Web Speech API path
          const session = sessions.get(currentSessionId);
          if (!session) break;

          const source = data.source === 'candidate' ? 'candidate' : 'interviewer';

          if (source === 'candidate') {
            broadcastToSession(currentSessionId, {
              type: 'candidate_transcript_update',
              transcript: data.transcript,
              isFinal: data.isFinal
            });
            const isSpeechFinal = Boolean(data.speechFinal !== undefined ? data.speechFinal : data.isFinal);
            if (data.isFinal) {
              const committed = session.candidateAccumulator.addFinal(data.transcript, isSpeechFinal);
              if (committed) commitCandidateSpeech(currentSessionId, committed.text, session, committed.words, committed.startTime, committed.endTime, false);
            } else {
              session.candidateAccumulator.addInterim(data.transcript);
            }
          } else {
            const isSpeechFinal = Boolean(data.speechFinal !== undefined ? data.speechFinal : data.isFinal);
            broadcastToSession(currentSessionId, {
              type: 'transcript_update',
              transcript: data.transcript,
              isFinal: data.isFinal
            });
            if (data.isFinal) {
              const committed = session.interviewerAccumulator.addFinal(data.transcript, isSpeechFinal);
              if (committed) commitQuestion(currentSessionId, committed, session);
            } else {
              session.interviewerAccumulator.addInterim(data.transcript);
            }
          }
          break;
        }

        case 'trigger_answer': {
          // Manual "Answer Now" button from laptop or mobile HUD
          const session = sessions.get(currentSessionId) || getOrCreateSession(currentSessionId);
          let q = data.question?.trim();
          if (!q) {
            const acc = session.interviewerAccumulator;
            q = (acc.committed ? acc.committed + ' ' + acc.interim : acc.interim).trim();
          }
          if (q) {
            session.pendingQuestionHash = null;
            session.interviewerAccumulator.committed = '';
            session.interviewerAccumulator.interim = '';
            session.interviewerAccumulator._clearSettle();
            commitQuestion(currentSessionId, q, session);
          }
          break;
        }

        case 'help_continue': {
          // Candidate requests help on what to say next based on original question and their spoken words
          const session = sessions.get(currentSessionId) || getOrCreateSession(currentSessionId);
          const lastQ = [...session.messages].reverse().find(m => m.role === 'question');
          if (!lastQ) break;

          const candidateSpeeches = session.messages.filter(m => m.role === 'candidate' && m.createdAt >= lastQ.createdAt);
          const candidateSpokenText = candidateSpeeches.map(m => m.text).join(' ');

          await streamHelpContinue(currentSessionId, lastQ.text, candidateSpokenText, lastQ.id, session);
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
            q = lastQ?.text || (session.interviewerAccumulator.committed ? session.interviewerAccumulator.committed + ' ' + session.interviewerAccumulator.interim : session.interviewerAccumulator.interim).trim();
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

    if (currentSessionId && sessions.has(currentSessionId)) {
      const session = sessions.get(currentSessionId);
      if (userRole === 'laptop' && session.laptopWs === ws) {
        // If laptop disconnects, close Deepgram streaming connections
        if (session.interviewerDeepgramWs) {
          session.interviewerDeepgramWs.close();
          session.interviewerDeepgramWs = null;
        }
        if (session.candidateDeepgramWs) {
          session.candidateDeepgramWs.close();
          session.candidateDeepgramWs = null;
        }
      }
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
