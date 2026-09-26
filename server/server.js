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

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config();

// ─────────────────────────────────────────────────────────────
//  Groq Models Configuration & Dynamic Health Discovery
// ─────────────────────────────────────────────────────────────
const DEFAULT_GROQ_MODELS = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b'
];

let activeGroqModels = [...DEFAULT_GROQ_MODELS];

async function refreshGroqModels(apiKey) {
  if (!apiKey) return;
  try {
    const groqClient = new Groq({ apiKey });
    const list = await groqClient.models.list();
    const available = new Set(list.data.map(m => m.id));

    // Keep prioritized order of available models
    const matched = DEFAULT_GROQ_MODELS.filter(m => available.has(m));
    if (matched.length > 0) {
      activeGroqModels = matched;
      console.log(`[Groq] Validated active models: ${activeGroqModels.join(', ')}`);
    } else {
      // Fallback: pick any chat models available
      const chatModels = list.data
        .map(m => m.id)
        .filter(id => !id.includes('whisper') && !id.includes('guard'));
      if (chatModels.length > 0) {
        activeGroqModels = chatModels.slice(0, 3);
        console.log(`[Groq] Fallback detected models: ${activeGroqModels.join(', ')}`);
      }
    }
  } catch (err) {
    console.warn(`[Groq] Dynamic model discovery notice: ${err.message}. Using default list.`);
  }
}

// Initial discovery
refreshGroqModels(process.env.GROQ_API_KEY);

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
  language: "English",
  preferredLanguage: "Python"
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
      pendingQuestionHash: null,
      initialWebmHeader: null,
      activeCodingLanguage: null,
      deepgramActive: false,
      lastDeepgramTimestamp: 0,
      lastFinalTranscript: null,
    });
  }
  return sessions.get(sessionId);
}

// ─────────────────────────────────────────────────────────────
//  TranscriptAccumulator
//  Collects Deepgram fragments → commits complete questions
// ─────────────────────────────────────────────────────────────
//  Chatter & Background Audio Filtering / Question Detection
// ─────────────────────────────────────────────────────────────
const CHATTER_REGEX = /\b(thank you|thanks a lot|thanks|bye|goodbye|i'm not well|i am not well|i don't know|i don't have|i'm calling|i am calling|her phone|my phone|seven seven seven|let's see|hold on|wait a second|wait a minute|pardon me|excuse me|can you hear me|am i audible|testing|in two rev|heading)\b/i;

const PURE_NOISE_OR_FILLER = /^(uh+|um+|hmm+|mm+|okay+|yes+|no+|right|sure|alright|okay then|mhm+|yeah+|nope+|yep+|cool|nice|fine|sorry|hello|hi|bye|thanks|thank you|good|understood|heading)[\s.,!?]*$/i;

const QUESTION_INTENT_REGEX = /(^|\b)(what|why|how|where|when|which|who|whose|whom|can you|could you|would you|will you|should we|shall we|do you|did you|have you|are you|is it|is there|are there|does it|does this|will this|tell me|talk about|write|implement|explain|describe|compare|differentiate|discuss|optimize|solve|calculate|design|create|build|walk me through|show me|give me|rewrite|find|fix|debug|refactor)\b/i;

const TECH_TOPIC_REGEX = /\b(sql|query|database|table|index|join|spark|pyspark|databricks|delta lake|dataframe|react|redux|node|javascript|typescript|python|algorithm|complexity|array|list|hashmap|tree|graph|binary search|duplicate|duplicates|palindrome|reverse|recursion|memo|decorator|promise|async|await|event loop|microtask|closure|docker|kubernetes|aws|azure|kafka|rest api|graphql|dense_rank|partition|caching|redis|memcached|mongodb|postgres|postgresql|mysql|nosql|dynamodb|acid|transaction|transactions|deadlock|concurrency|multithreading|thread|threads|mutex|semaphore|queue|stack|heap|priority queue|trie|dynamic programming|sliding window|two pointers|dfs|bfs|big o|memory leak|garbage collection|gc|microservice|microservices|load balancer|reverse proxy|nginx|cdn|dns|oauth|jwt|auth|cors|websocket|websockets)\b/i;

// Problem setup / context opener detection
const SETUP_PREMISE_REGEX = /^(suppose|assume|given|consider|imagine|let\'s say|say we have|in a scenario|in a case|in our system|we have a|there is a|there are|our team has|we need to|in this problem|in your project)\b/i;

// Action or direct interrogative indicators inside question
const DIRECT_QUESTION_ACTION_REGEX = /\b(how (do|would|can|should|will|to)|what (is|are|would|happens|should)|why (is|do|would)|can you|could you|would you|write a|implement a|create a|design a|optimize|calculate)\b/i;

function isPremiseOnly(text) {
  const t = (text || '').trim();
  if (!t) return false;
  const startsWithSetup = SETUP_PREMISE_REGEX.test(t);
  const hasQuestionMark = t.endsWith('?') || t.includes('?');
  const hasDirectAction = DIRECT_QUESTION_ACTION_REGEX.test(t);
  return startsWithSetup && !hasQuestionMark && !hasDirectAction;
}

// Incomplete trailing phrases or unfinished thoughts
const INCOMPLETE_TRAILING = /\b(?:for|to|in|into|with|without|using|and|or|by|from|of|about|that|like|as|a|an|the|this|these|those|is|are|was|were|be|been|have|has|had|do|does|did|can|could|will|would|should|may|might|which|who|where|when|why|how|if|whether|because|since|while|so|but|such as|for example|between|either|neither|both|than|including)\s*$/i;

const INCOMPLETE_PHRASES = /(?:write a|how to|how do|how would|how can|what is|what are|what does|why does|can you|could you|would you|is it|does it|will it|to find|to get|to check|to implement|to calculate|to optimize|in terms of|with respect to|based on|depending on)\s*$/i;

function isIncomplete(text) {
  const t = (text || '').trim();
  if (!t) return true;
  return INCOMPLETE_TRAILING.test(t) || INCOMPLETE_PHRASES.test(t);
}

function isCompleteDirectQuestion(text) {
  const t = (text || '').trim();
  if (!t) return false;
  if (isIncomplete(t)) return false;
  if (isPremiseOnly(t)) return false;
  if (t.endsWith('?') && t.split(/\s+/).length >= 4) return true;
  if (QUESTION_INTENT_REGEX.test(t) && t.split(/\s+/).length >= 5) return true;
  return false;
}

function isPureChatterOrNoise(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return true;
  if (PURE_NOISE_OR_FILLER.test(trimmed)) return true;

  const hasQuestionIntent = trimmed.endsWith('?') || QUESTION_INTENT_REGEX.test(trimmed);
  const hasTechTopic = TECH_TOPIC_REGEX.test(trimmed);
  const hasSetup = SETUP_PREMISE_REGEX.test(trimmed);

  // If the speech has NO question intent, NO technical topic, and is NOT a problem premise, filter it out
  if (!hasQuestionIntent && !hasTechTopic && !hasSetup) {
    return true;
  }

  // If short and contains conversational chatter phrases without question mark or tech topic
  if (CHATTER_REGEX.test(trimmed) && !hasTechTopic && !hasQuestionIntent && !trimmed.endsWith('?')) {
    return true;
  }

  return false;
}

function sanitizeQuestionText(text) {
  let cleaned = (text || '').trim();
  if (!cleaned) return '';

  // Clean leading conversational openings like "Okay,", "Alright,", "So,", "Can you hear me? Okay,"
  cleaned = cleaned.replace(/^(?:can you hear me\??|am i audible\??|testing 1 2 3\b|let\'s see\b|hello\b|hi\b|okay then\b|alright then\b|okay so\b|so\b|alright\b|okay\b)[\s,.-]+/i, '').trim();

  // Strip trailing polite / phone chatter from questions (preserve all preceding sentences)
  const trailingChatterMatch = cleaned.match(/^(.*[.?])\s+(?:thank you|thanks a lot|thanks|bye|goodbye|i'm calling|her phone|i don't know|in two rev|heading)[\s.,!?]*$/i);
  if (trailingChatterMatch && trailingChatterMatch[1].length >= 12) {
    cleaned = trailingChatterMatch[1].trim();
  }

  // Strip trailing noise punctuation or filler words like "Right.", "Let's", etc.
  cleaned = cleaned.replace(/\s+(?:let's|heading|right|ok|okay)[\s.,!?]*$/i, '').trim();

  return cleaned || text.trim();
}

class TranscriptAccumulator {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.committed = '';      // stable committed text
    this.interim = '';        // current interim (not yet final)
    this.words = [];          // collected word objects with confidence scores
    this.settleTimer = null;
    this.speechStartTime = null; // tracks when speech for current question began
    this.SETTLE_MS = 1400;    // settle default after 1.4s of quiet
    this.WINDOW_MS = 12000;   // 12-second question accumulation window max
  }

  _getDynamicSettleMs(text) {
    const session = sessions.get(this.sessionId);
    const isStreaming = session?.messages?.some(m => m.role === 'answer' && m.status === 'streaming');
    if (isStreaming) return 2400;

    const full = (this.committed ? this.committed + ' ' + (text || this.interim) : (text || this.interim)).trim();
    if (isPremiseOnly(full)) return 1800; // Allow interviewer time to formulate question after setup
    if (isCompleteDirectQuestion(full)) return 950; // Fast response for completed questions!
    return this.SETTLE_MS;
  }

  isIncomplete(text) {
    return isIncomplete(text);
  }

  isPremiseOnly(text) {
    return isPremiseOnly(text);
  }

  isNoiseOnly(text) {
    return isPureChatterOrNoise(text);
  }

  addInterim(text) {
    if (!this.speechStartTime) this.speechStartTime = Date.now();
    this.interim = text;
    this._scheduleSettle(this._getDynamicSettleMs(text));
  }

  addFinal(text, speechFinal, words = []) {
    const cleanChunk = (text || '').trim();
    if (!cleanChunk) return null;

    // Only skip isolated pure filler noises when buffer is empty
    if (!this.committed && PURE_NOISE_OR_FILLER.test(cleanChunk)) return null;

    if (!this.speechStartTime) this.speechStartTime = Date.now();

    if (Array.isArray(words) && words.length > 0) {
      this.words.push(...words);
    }

    // Append to committed buffer
    this.committed = this.committed
      ? this.committed.trimEnd() + ' ' + cleanChunk
      : cleanChunk;
    this.interim = '';

    const elapsed = Date.now() - this.speechStartTime;

    if (speechFinal) {
      // If trailing phrase is incomplete or premise setup, keep waiting
      if (this.isIncomplete(this.committed) || this.isPremiseOnly(this.committed)) {
        const remaining = Math.max(1200, Math.min(2200, this.WINDOW_MS - elapsed));
        this._scheduleSettle(remaining);
        return null;
      }

      // If question is complete, commit fast
      if (isCompleteDirectQuestion(this.committed)) {
        this._clearSettle();
        return this._commit();
      }

      this._scheduleSettle(this._getDynamicSettleMs());
      return null;
    } else {
      this._scheduleSettle(this._getDynamicSettleMs());
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

      if (this.isIncomplete(full) || this.isPremiseOnly(full)) {
        const elapsed = this.speechStartTime ? Date.now() - this.speechStartTime : 0;
        if (elapsed < this.WINDOW_MS) {
          this._scheduleSettle(1000);
          return;
        }
      }

      const words = this.consumeWords();
      this.committed = '';
      this.interim = '';
      this.speechStartTime = null;

      if (full && !this.isNoiseOnly(full)) {
        const session = sessions.get(this.sessionId);
        if (session) commitQuestion(this.sessionId, full, session, words, full, false);
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
//  Context builder — multi-turn conversation history & language continuity
// ─────────────────────────────────────────────────────────────
function buildContext(session, currentQuestion) {
  const messages = session.messages || [];

  // Collect previous completed exchanges (up to 4 most recent Q&A pairs)
  // excluding the current question which was just added
  const completedPairs = [];
  const completedQuestions = messages.filter(m => m.role === 'question' && m.status === 'complete');
  const previousQuestions = completedQuestions.filter(q => q.text.trim().toLowerCase() !== currentQuestion.trim().toLowerCase());
  const recentQuestions = previousQuestions.slice(-4);

  for (const q of recentQuestions) {
    const a = messages.find(m => m.role === 'answer' && m.parentId === q.id && m.status === 'complete' && m.text.trim());
    if (a) {
      completedPairs.push({
        question: q.text.trim(),
        answer: a.text.trim()
      });
    }
  }

  // Detect or update active coding language from recent answers if not explicitly set
  if (!session.activeCodingLanguage && completedPairs.length > 0) {
    for (let i = completedPairs.length - 1; i >= 0; i--) {
      const codeMatch = completedPairs[i].answer.match(/```(\w+)/);
      if (codeMatch && codeMatch[1]) {
        session.activeCodingLanguage = codeMatch[1].toLowerCase();
        break;
      }
    }
  }

  // Build multi-turn chat messages for LLM context
  const conversationHistory = [];
  for (const item of completedPairs) {
    conversationHistory.push({
      role: 'user',
      content: `INTERVIEW QUESTION: "${item.question}"`
    });
    // Bounded answer to keep prompt clean while preserving code and key logic
    const boundedAnswer = item.answer.length > 1200
      ? item.answer.slice(0, 1200) + '\n...(truncated for length)'
      : item.answer;
    conversationHistory.push({
      role: 'assistant',
      content: boundedAnswer
    });
  }

  const lastPair = completedPairs[completedPairs.length - 1] || null;

  return {
    currentQuestion,
    isFollowUp: completedPairs.length > 0,
    parentQuestion: lastPair?.question || null,
    parentAnswer: lastPair?.answer || null,
    conversationHistory,
    activeCodingLanguage: session.activeCodingLanguage || null,
    candidate: candidateContext,
  };
}

// ─────────────────────────────────────────────────────────────
//  System prompt — continuity, language consistency, simple answers & clean code
// ─────────────────────────────────────────────────────────────
function buildSystemPrompt(ctx) {
  const { candidate, parentQuestion, parentAnswer, activeCodingLanguage } = ctx;
  const defaultLang = candidate.preferredLanguage || 'Python';
  const effectiveLang = activeCodingLanguage || defaultLang;

  let followUpSection = '';
  if (parentQuestion) {
    followUpSection = `
RECENT CONVERSATION CONTEXT:
* Previous Question: "${parentQuestion}"
* Previous Answer Summary: ${parentAnswer ? parentAnswer.slice(0, 600) : '(none)'}
* This interview is an ongoing conversation. When the current question asks for optimization, edge cases, explanation, variations, or refers to "it", "that", "the function", or "the query", DIRECTLY build upon the previous solution above.`;
  }

  return `You are a real-time interview response assistant designed to help candidates answer technical questions with confidence, clarity, and precision.

CANDIDATE PROFILE:
- Target Role: ${candidate.targetRole}
- Résumé: ${candidate.resume}
- Projects: ${candidate.projects}
- Job Description: ${candidate.jobDescription}
- Preferred Coding Language: ${defaultLang}
- Language: ${candidate.language || 'English'}
- Rules: ${candidate.guardrails}
${followUpSection}

ANSWER GENERATION INSTRUCTIONS:
- Explain in simple everyday English. Assume the reader is a beginner. Start directly with the answer. Use short sentences and natural wording that is easy to say aloud.
- For a normal question, aim for 2–4 short sentences. Use a few brief bullets only when listing steps or comparing points.
- Answer every part of a multi-part question. Add length only when needed to cover the question accurately.
- Use necessary technical terms, but explain unfamiliar terms briefly. Avoid complicated wording, lengthy introductions, repetition, filler, and unrelated details. Never start with "Certainly!", "Great question!", or "Here is the answer."
- For follow-up questions, use the earlier conversation and answer the new point directly.
- Treat these as writing guidelines, not hard limits that cut off an incomplete answer.

CONVERSATION CONTINUITY & FOLLOW-UPS:
- You have the recent conversation history between the interviewer and candidate.
- Maintain continuous context across questions. When the interviewer says "can you optimize that?", "what if there are duplicates?", "rewrite it", "how will this scale?", "write tests for it", or refers to earlier code with "it" or "this", reference and build upon what was already discussed.
- Never ask the interviewer to repeat or re-state what they are referring to.
- If asked to modify or optimize a solution, build directly on the specific logic and variable names already established.

CODING LANGUAGE CONSISTENCY & RULES:
- Primary default language: ${defaultLang}
- Current active interview language: ${effectiveLang}
- Follow this strict hierarchy to select the programming language for any code block:
  1. EXPLICIT INTERVIEWER REQUEST: If the interviewer asks for a specific language or technology (e.g. "in SQL", "in Python", "using PySpark", "in TypeScript", "in Java", "in C++"), ALWAYS use that requested language.
  2. FOLLOW-UP CONTINUITY: When modifying, optimizing, explaining, or writing tests for previous code, ALWAYS stay in the SAME language (${effectiveLang}) unless the interviewer explicitly asked to switch or translate.
  3. DOMAIN DEFAULTS (when no language is mentioned):
     * Relational DB queries, aggregations, window functions, schema/table transformations: SQL (PostgreSQL standard).
     * Big data pipelines, distributed dataframes, Databricks ETL: PySpark.
     * Algorithms, data structures, backend functions, math, scripting: ${defaultLang}.
     * Web frontend, UI components, React: JavaScript or TypeScript.
  4. NO RANDOM LANGUAGE SWITCHING: Never switch between Java, C++, Python, JavaScript, etc., from one question to the next. Consistency across the interview is strictly required.

CODING GUIDELINES:
- Provide one straightforward, correct solution adhering to the language rules above.
- Always include the language identifier in the code fence (e.g. \`\`\`${effectiveLang.toLowerCase()} or \`\`\`sql).
- Use readable variable names, necessary imports, and a small number of clear steps. Avoid unnecessary classes, helper layers, repeated setup, excessive comments, and clever one-liners that are hard to explain.
- Keep lines reasonably short by using valid source-code line breaks. Do not alter identifiers, string contents, or logic just to shorten a line.
- For coding answers, normally provide:
  * One short sentence explaining the approach.
  * One complete code block for the requested task.
  * Two short sentences explaining the important steps.
- Do NOT automatically generate "Edge Cases," "Time Complexity," or "Space Complexity" sections. If the interviewer specifically asks about one of these topics, answer that question briefly in normal language without adding unnecessary sections.`;
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
function commitQuestion(sessionId, questionText, session, words = [], rawTranscript = null, isManual = false) {
  const sanitized = sanitizeQuestionText(questionText);
  const trimmed = sanitized.trim();
  if (!trimmed) return;

  // Filter out stray background noise, phone speech, and non-questions unless manually triggered by user
  if (!isManual && isPureChatterOrNoise(trimmed)) {
    console.log(`[Audio Shield] Discarded non-question background chatter: "${trimmed}"`);
    return;
  }

  const rawText = rawTranscript || trimmed;
  const analysis = analyzeWordUncertainty(words, technicalVocabulary);
  const wordCount = trimmed.split(/\s+/).length;

  // ── Stitching Rule (merges multi-part questions, constraints, and follow-up continuations within 7.5s) ──
  const lastQ = [...session.messages].reverse().find(m => m.role === 'question');
  const timeSinceLastQ = lastQ ? Date.now() - lastQ.createdAt : Infinity;

  const lastHasQuestionMark = lastQ && (lastQ.text.trim().endsWith('?') || lastQ.text.trim().includes('?'));
  const lastWasIncomplete = lastQ && !lastHasQuestionMark && (
    isIncomplete(lastQ.text.trim()) ||
    isPremiseOnly(lastQ.text.trim()) ||
    lastQ.text.trim().split(/\s+/).length < 7
  );

  // Qualifiers and constraints that continue ANY question (even after '?')
  const QUALIFIER_CONTINUATIONS = /^(without using|using|with time complexity|with space complexity|with o\(|in o\(|in-place|and also|what if|how about|what about)\b/i;
  const REFERS_TO_PREVIOUS = /\b(it|that|this function|this query|the function|the query|the approach|the previous|optimize that|rewrite that|scale that)\b/i;
  const LANGUAGE_SPECIFIER = /^(in python|in sql|in typescript|in javascript|in java|in c\+\+|in golang|in rust|in pyspark|in react)\b/i;

  let isContinuation = false;
  if (lastQ && timeSinceLastQ < 7500) {
    if (lastWasIncomplete) {
      // If previous question was an incomplete premise or clause, any question action or qualifier completes it!
      isContinuation = true;
    } else {
      // If previous question was already a complete question with '?', only merge if it's an explicit constraint/qualifier or refers to previous logic
      isContinuation = QUALIFIER_CONTINUATIONS.test(trimmed) || LANGUAGE_SPECIFIER.test(trimmed) || REFERS_TO_PREVIOUS.test(trimmed);
    }
  }

  if (lastQ && isContinuation) {
    // Abort previous partial answer
    if (session.activeAbort) {
      session.activeAbort.abort();
      session.activeAbort = null;
    }

    // Clean up previous answer completely so no broken interrupted message is displayed
    session.messages = session.messages.filter(m => !(m.role === 'answer' && m.parentId === lastQ.id));

    // Connect text cleanly
    const prevText = lastQ.text.trim();
    const isExplicitQualifier = QUALIFIER_CONTINUATIONS.test(trimmed) || LANGUAGE_SPECIFIER.test(trimmed);
    const needsSeparator = !prevText.endsWith('.') && !prevText.endsWith('?') && !prevText.endsWith(',') && !isExplicitQualifier && !lastWasIncomplete;
    lastQ.text = `${prevText}${needsSeparator ? ',' : ''} ${trimmed}`;
    lastQ.rawText = `${lastQ.rawText ? lastQ.rawText.trim() : prevText} ${rawText}`;
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

  // Auto-expire answers stuck in 'streaming' older than 30s to prevent stream lock
  const now = Date.now();
  for (const m of session.messages) {
    if (m.role === 'answer' && m.status === 'streaming' && (now - (m.createdAt || 0)) > 30000) {
      m.status = 'complete';
      console.log(`[Server] Auto-expired stale streaming answer ${m.id}`);
    }
  }

  // Shield active answer from premature interruptions:
  // If an answer is currently streaming, don't let casual remarks or small chatter kill it!
  const isCurrentlyStreaming = [...session.messages].some(m => m.role === 'answer' && m.status === 'streaming');
  if (isCurrentlyStreaming && !isManual) {
    const isExplicitQuestion = trimmed.endsWith('?') || QUESTION_INTENT_REGEX.test(trimmed);
    const hasTechTopic = TECH_TOPIC_REGEX.test(trimmed);

    // If it lacks clear question intent or is under 5 words without technical terms, ignore it to protect the streaming answer!
    if (!isExplicitQuestion && !hasTechTopic) {
      console.log(`[Streaming Shield] Ignored speech "${trimmed}" while answer is streaming to protect active generation.`);
      return;
    }
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

  // Finalize or abort any in-progress generation gracefully
  if (session.activeAbort) {
    session.activeAbort.abort();
    session.activeAbort = null;
    const inProgress = [...session.messages].reverse().find(m => m.role === 'answer' && m.status === 'streaming');
    if (inProgress) {
      // If the answer has already generated substantial text (> 80 chars), preserve it as complete!
      // This prevents the candidate from seeing an annoying yellow "Interrupted" badge on a readable answer.
      const hasSubstantialText = (inProgress.text || '').trim().length > 80;
      inProgress.status = hasSubstantialText ? 'complete' : 'interrupted';
      inProgress.totalTime = inProgress.totalTime || (Date.now() - (inProgress.createdAt || Date.now()));

      broadcastToSession(sessionId, {
        type: hasSubstantialText ? 'chat_done' : 'chat_interrupted',
        msgId: inProgress.id,
        fullText: inProgress.text,
        totalTime: inProgress.totalTime,
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
    : `INTERVIEW QUESTION: "${question}"`;

  // True multi-turn conversation messages: System Prompt + Recent Conversation Exchanges + Current Question
  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...(ctx.conversationHistory || []),
    { role: 'user', content: userContent }
  ];

  const groqKey = process.env.GROQ_API_KEY;

  if (!groqKey) {
    await streamMockAnswer(sessionId, question, aMsgId, reqId, startTime, abort.signal, continueFromText);
    return;
  }

  const groq = new Groq({ apiKey: groqKey });
  const candidateModels = activeGroqModels.length > 0 ? activeGroqModels : DEFAULT_GROQ_MODELS;

  let succeeded = false;
  let lastError = null;

  // Pass 1: Try each model with 400ms rate-limit backoff
  // Pass 2: If rate limited on all models, wait 800ms for quota replenishment and retry
  for (let pass = 0; pass < 2 && !succeeded; pass++) {
    for (const model of candidateModels) {
      if (abort.signal.aborted) break;

      try {
        const stream = await groq.chat.completions.create({
          messages: chatMessages,
          model,
          temperature: 0.25,
          max_tokens: 800,
          reasoning_format: 'hidden',
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

          // Remember code language used so subsequent follow-ups stay in this language
          const codeLangMatch = accumulated.match(/```(\w+)/);
          if (codeLangMatch && codeLangMatch[1]) {
            session.activeCodingLanguage = codeLangMatch[1].toLowerCase();
          }

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
        succeeded = true;
        return; // success — exit model loop

      } catch (err) {
        lastError = err;
        if (abort.signal.aborted) break;

        const status = err.status || err.statusCode;

        if (status === 404 || status === 400) {
          console.warn(`[Groq] Model ${model} unavailable (${status}). Pruning from active models.`);
          activeGroqModels = activeGroqModels.filter(m => m !== model);
          continue;
        }

        if (status === 429) {
          console.warn(`[Groq] Rate limit 429 on model ${model}, trying next model in 400ms...`);
          await new Promise(r => setTimeout(r, 400));
          continue;
        }

        if (status === 401) {
          console.warn(`[Groq] 401 Auth error. Falling back to local responder.`);
          break; // break to fallback
        }

        console.warn(`[Groq] Model ${model} error: ${err.message}. Trying next model...`);
      }
    }

    if (!succeeded && pass === 0 && !abort.signal.aborted) {
      const isRateLimit = lastError && (lastError.status === 429 || lastError.statusCode === 429);
      if (isRateLimit) {
        console.warn(`[Groq] Temporary rate limit on all models. Backing off 800ms before retry...`);
        await new Promise(r => setTimeout(r, 800));
      }
    }
  }

  // All models failed or aborted
  if (!abort.signal.aborted && session.activeReqId === reqId) {
    if (aMsg.text.length === 0) {
      // Nothing was generated — fall back to intelligent responder immediately
      await streamMockAnswer(sessionId, question, aMsgId, reqId, startTime, abort.signal, continueFromText);
    } else {
      // Some text was generated — finalize cleanly so the user gets a readable answer
      const totalTime = Date.now() - startTime;
      aMsg.status = 'complete';
      aMsg.totalTime = totalTime;
      broadcastToSession(sessionId, {
        type: 'chat_done',
        msgId: aMsgId,
        reqId,
        fullText: aMsg.text,
        totalTime,
        sessionId
      });
    }
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

  if (q.includes('duplicate') || (q.includes('python') && (q.includes('list') || q.includes('array')))) {
    if (q.includes('without') && (q.includes('count') || q.includes('counter') || q.includes('set') || q.includes('predefined'))) {
      answer = `To find duplicates and their counts without using predefined functions like Counter, count, or set, use a manual hash map (dictionary) in a single pass.\n\n\`\`\`python\ndef find_duplicates(items):\n    counts = {}\n    duplicates = {}\n    \n    # Count frequencies manually\n    for item in items:\n        if item in counts:\n            counts[item] += 1\n        else:\n            counts[item] = 1\n            \n    # Filter items that appear more than once\n    for item, freq in counts.items():\n        if freq > 1:\n            duplicates[item] = freq\n            \n    return duplicates\n\`\`\`\n\nThis operates in O(n) time and O(k) auxiliary space where k is unique values, strictly without Counter or set.`;
    } else {
      answer = `To find duplicates and their counts in a list, count frequencies with a dictionary and collect elements that appear more than once.\n\n\`\`\`python\ndef find_duplicates(items):\n    counts = {}\n    for item in items:\n        counts[item] = counts.get(item, 0) + 1\n    return {k: v for k, v in counts.items() if v > 1}\n\`\`\`\n\nThis scans the input once in O(n) time and returns each duplicate alongside its frequency.`;
    }
  } else if (q.includes('sql') || q.includes('salary') || q.includes('dense_rank') || q.includes('second highest')) {
    answer = `To find the second-highest salary per department while handling ties, use the DENSE_RANK() window function.\n\n\`\`\`sql\nSELECT department, employee_name, salary\nFROM (\n  SELECT department, employee_name, salary,\n         DENSE_RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS rnk\n  FROM employees\n  WHERE salary IS NOT NULL\n) ranked\nWHERE rnk = 2;\n\`\`\`\n\nThe inner query ranks employees by salary within each department without skipping rank numbers when ties occur. The outer query filters for rank 2 to return all second-highest earners cleanly.`;
  } else if (q.includes('spa') || q.includes('single page')) {
    answer = `A single-page application (SPA) loads the HTML, CSS, and JavaScript assets once, then updates the view dynamically without full page reloads.\n\nAll navigation happens client-side via JavaScript routing and the browser history API, while data is exchanged with backend APIs. This gives the app a responsive desktop feel and minimizes network bandwidth.`;
  } else if (q.includes('databricks') || q.includes('incremental') || q.includes('delta')) {
    answer = `Incremental data loading in Databricks uses Delta Lake change tracking and checkpointing to process only newly arrived records.\n\n\`\`\`python\n# Read new data using checkpoint offset\nnew_df = spark.read.format("delta").table("source_telemetry") \\\n    .filter("event_timestamp > (SELECT coalesce(max(last_sync), '1970-01-01') FROM sync_checkpoints)")\n\n# Merge incrementally into destination\nfrom delta.tables import DeltaTable\ntarget = DeltaTable.forName(spark, "target_lakehouse")\ntarget.alias("t").merge(\n    new_df.alias("s"),\n    "t.id = s.id"\n).whenMatchedUpdateAll().whenNotMatchedInsertAll().execute()\n\`\`\`\n\nThis eliminates full table scans, keeping pipelines fast and cost-effective.`;
  } else if (q.includes('react') || q.includes('virtual dom') || q.includes('usememo')) {
    answer = `React's Virtual DOM is a lightweight memory representation of the real DOM. When state changes, React compares the new tree with the old one and updates only the changed DOM elements.\n\n- useMemo caches calculated values across renders\n- useCallback preserves function references to avoid child re-renders\n- Keys help React track which items were added or moved`;
  } else if (q.includes('node') || q.includes('event loop')) {
    answer = `Node.js runs single-threaded JavaScript using a non-blocking event loop backed by libuv.\n\nIt handles timers, pending I/O, and poll events in distinct phases, draining microtasks after each phase. Long compute jobs should be offloaded to worker threads so the main event loop never blocks.`;
  } else if (q.includes('broadcast join') || q.includes('join')) {
    answer = `A broadcast join copies a small table to all worker nodes so the large table can be joined locally without network shuffling.\n\nUse it when the smaller table fits comfortably in executor memory, typically under 10MB to a few hundred megabytes in Spark. Avoid broadcasting large tables because it can overwhelm driver and executor memory.`;
  } else {
    const cleanQ = question.replace(/^(what is|how do|explain|tell me about)\s+/i, '').trim();
    answer = `For ${cleanQ || 'this technical problem'}, the standard production approach balances efficiency and code clarity.\n\nStart with a straightforward solution using standard library primitives, validate boundary conditions, and ensure clean separation of concerns.`;
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
    await new Promise(r => setTimeout(r, 2));
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
  const fields = ['resume', 'targetRole', 'jobDescription', 'projects', 'guardrails', 'language', 'preferredLanguage'];
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

        const session = sessions.get(sessionId);
        // If we have a cached WebM header from the first chunk, send it immediately
        // so Deepgram can decode the Opus audio stream across any reconnect!
        if (session?.initialWebmHeader) {
          try {
            deepgramWs.send(session.initialWebmHeader);
            console.log(`[Deepgram] Re-injected initial WebM header (${session.initialWebmHeader.length} bytes) on connect/reconnect.`);
          } catch (e) {
            console.error('[Deepgram] Failed to re-inject WebM header:', e.message);
          }
        }

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

          session.deepgramActive = true;
          session.lastDeepgramTimestamp = Date.now();

          const transcript = payload.channel?.alternatives[0]?.transcript || '';
          const words = payload.channel?.alternatives[0]?.words || [];
          const isFinal = payload.is_final;
          const speechFinal = payload.speech_final;
          const type = payload.type;

          // Broadcast raw transcript to UI
          if (transcript.trim()) {
            // Deduplicate immediately identical consecutive final chunks from Deepgram
            if (isFinal) {
              const tTrim = transcript.trim().toLowerCase();
              if (session.lastFinalTranscript === tTrim) return;
              session.lastFinalTranscript = tTrim;
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
                session.lastFinalTranscript = null;
                commitQuestion(sessionId, committed, session, session.transcriptAccumulator.consumeWords(), committed, false);
              }
            } else {
              session.transcriptAccumulator.addInterim(transcript);
            }
          }

          // VAD silence event — only commit if sentence is grammatically complete AND not just a setup premise!
          if (type === 'UtteranceEnd') {
            const acc = session.transcriptAccumulator;
            const full = (acc.committed ? acc.committed + ' ' + acc.interim : acc.interim).trim();
            if (full && !acc.isIncomplete(full) && !acc.isPremiseOnly(full)) {
              // If an answer is currently streaming, don't commit silence events for casual chatter
              const isCurrentlyStreaming = [...session.messages].some(m => m.role === 'answer' && m.status === 'streaming');
              if (isCurrentlyStreaming) {
                const isExplicitQ = full.endsWith('?') || QUESTION_INTENT_REGEX.test(full);
                if (!isExplicitQ && full.split(/\s+/).length < 6) {
                  return; // Don't interrupt streaming answer on quiet pauses/chatter
                }
              }
              session.lastFinalTranscript = null;
              const words = acc.consumeWords();
              const committed = acc.forceCommit();
              if (committed) commitQuestion(sessionId, committed, session, words, committed, false);
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
      const activeSessionId = currentSessionId || 'SESSION-1';
      const session = getOrCreateSession(activeSessionId);
      if (!session.initialWebmHeader && message.length > 0) {
        session.initialWebmHeader = Buffer.from(message);
        console.log(`[Audio] Cached initial WebM header chunk (${message.length} bytes) for session ${activeSessionId}`);
      }
      const dgSocket = ensureDeepgramSocket(activeSessionId);
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
          // Web Speech API path (browser speech recognition fallback)
          const session = sessions.get(currentSessionId);
          if (!session) break;

          // If Deepgram is actively streaming for this session, ignore duplicate Web Speech API transcripts!
          if (session.deepgramActive && (Date.now() - (session.lastDeepgramTimestamp || 0) < 6000)) {
            break;
          }

          broadcastToSession(currentSessionId, {
            type: 'transcript_update',
            transcript: data.transcript,
            isFinal: data.isFinal
          });

          if (data.isFinal) {
            const committed = session.transcriptAccumulator.addFinal(data.transcript, false);
            if (committed) commitQuestion(currentSessionId, committed, session, [], committed, false);
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
            commitQuestion(currentSessionId, q, session, [], null, true);
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
            commitQuestion(currentSessionId, `Explain in more detail with clear steps and examples: ${q}`, session, [], null, true);
          }
          break;
        }

        case 'clear_answer': {
          broadcastToSession(currentSessionId, { type: 'ai_clear' });
          break;
        }

        case 'clear_history': {
          const session = sessions.get(currentSessionId);
          if (session) {
            session.messages = [];
            session.pendingQuestionHash = null;
            session.activeCodingLanguage = null;
            session.seenTranscriptHashes.clear();
            session.transcriptAccumulator.committed = '';
            session.transcriptAccumulator.interim = '';
            session.transcriptAccumulator._clearSettle();
          }
          broadcastToSession(currentSessionId, { type: 'history_cleared' });
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
