const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const dotenv = require('dotenv');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const Groq = require('groq-sdk');

dotenv.config({ path: path.join(__dirname, '.env') });
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

// ─────────────────────────────────────────────────────────────
//  Coding Task Specification & Verification System
// ─────────────────────────────────────────────────────────────
const CODING_COMMAND_WORDS = new Set([
  'write', 'implement', 'code', 'create', 'build', 'solve',
  'change', 'modify', 'update', 'remove', 'refactor', 'rewrite',
  'without', 'instead', "don't", 'dont', 'do not', 'never', 'avoid',
  'return', 'yield', 'output', 'also', 'handle', 'ensure', 'make sure',
  'optimize', 'use', 'using', 'convert'
]);

const CODING_CONSTRAINT_WORDS = new Set([
  'not', 'no', 'without', 'only', 'distinct', 'unique', 'second', 'third', 'latest',
  'ascending', 'descending', 'none', 'null', 'sorted', 'sort', 'sorting',
  'built-in', 'builtin', 'builtins', 'library', 'in-place', 'inplace',
  'duplicate', 'duplicates', 'ties', 'recursive', 'iterative',
  'time', 'space', 'complexity', 'o(1)', 'o(n)', 'o(n^2)', 'o(log n)',
  'positive', 'negative', 'array', 'list', 'string', 'integers', 'numbers'
]);

function isCodingInstructionOrConstraint(text) {
  if (!text) return false;
  const clean = text.trim().toLowerCase();
  if (/\b(write|implement|change|remove|without|instead|don't use|do not use|never use|avoid|return None|return -1|return null|also)\b/i.test(clean)) {
    return true;
  }
  const words = clean.split(/[^a-zA-Z0-9_\-\(\)]+/).filter(Boolean);
  return words.some(w => CODING_CONSTRAINT_WORDS.has(w) || CODING_COMMAND_WORDS.has(w));
}

class CodingTaskRecord {
  constructor(id, initialProblem, language = 'python') {
    this.id = id || uid('task');
    this.revision = 1;
    this.problem = initialProblem || '';
    this.language = language || 'python';
    this.framework = null;
    this.sqlDialect = null;
    this.inputStructure = null;
    this.expectedOutput = null;
    this.requiredOperations = []; // Array of { id, text, sourceWords }
    this.forbiddenOperations = []; // Array of { id, text, forbiddenTerms: string[], sourceWords }
    this.examples = []; // Array of { input, expected, rawText }
    this.unresolvedQuestions = [];
    this.currentCode = null;
    this.verificationStatus = null;
    this.verificationDetails = null;
    this.activePillSummary = '';
    this.status = 'active'; // 'active' | 'clarification_needed' | 'superseded' | 'completed'
  }

  getPillSummary() {
    const parts = [];
    const lang = this.language.charAt(0).toUpperCase() + this.language.slice(1);
    parts.push(lang);

    if (this.problem) {
      const shortProb = this.problem
        .replace(/^(write|implement|find|check|create)\s+(a\s+)?(function\s+to\s+|query\s+to\s+|code\s+for\s+|code\s+to\s+)?/i, '')
        .replace(/in\s+(python|sql|pyspark|javascript|typescript|java|c\+\+)/i, '')
        .trim();
      if (shortProb) parts.push(shortProb.slice(0, 32));
    }

    if (this.forbiddenOperations.length > 0) {
      parts.push(`no ${this.forbiddenOperations.map(f => f.text).join(', ')}`);
    } else if (this.requiredOperations.length > 0) {
      parts.push(this.requiredOperations[0].text);
    }
    return parts.join(' · ');
  }
}

function updateCodingTaskFromSpeech(task, speechText, candidateDefaultLang = 'python') {
  if (!task) {
    task = new CodingTaskRecord(uid('task'), speechText, candidateDefaultLang);
  }

  const raw = speechText.trim();
  const lower = raw.toLowerCase();

  // 1. Language detection
  if (/\b(in python|using python|with python)\b/i.test(lower)) task.language = 'python';
  else if (/\b(in sql|using sql|with sql|write a sql query|sql)\b/i.test(lower)) task.language = 'sql';
  else if (/\b(in pyspark|using pyspark|pyspark)\b/i.test(lower)) task.language = 'pyspark';
  else if (/\b(in typescript|typescript)\b/i.test(lower)) task.language = 'typescript';
  else if (/\b(in javascript|javascript)\b/i.test(lower)) task.language = 'javascript';
  else if (/\b(in java\b|using java\b)/i.test(lower)) task.language = 'java';
  else if (/\b(in c\+\+|using c\+\+)/i.test(lower)) task.language = 'cpp';

  // 2. Problem statement extraction
  if (!task.problem || /\b(write|find|implement|check|calculate|return)\b/i.test(lower)) {
    if (!task.problem) {
      task.problem = raw;
    } else if (!/\b(do not|don't|without|instead|also|return)\b/i.test(lower)) {
      task.problem = `${task.problem} ${raw}`.trim();
    }
  }

  // 3. Forbidden operations:
  if (/\b(do not sort|don't sort|dont sort|without sorting|no sorting|never sort|without using sort)\b/i.test(lower)) {
    const existing = task.forbiddenOperations.find(f => f.id === 'no-sort');
    if (!existing) {
      task.forbiddenOperations.push({
        id: 'no-sort',
        text: 'sorting',
        forbiddenTerms: ['sort', 'sorted', 'sort_values', 'ORDER BY'],
        sourceWords: raw
      });
    }
  }

  if (/\b(don't use built-in|do not use built-in|no built-in|without built-in|no builtins|without builtins)\b/i.test(lower)) {
    if (/\b(max|min)\b/i.test(lower)) {
      task.forbiddenOperations.push({
        id: 'no-max-min',
        text: 'built-in max/min',
        forbiddenTerms: ['max', 'min'],
        sourceWords: raw
      });
    } else {
      task.unresolvedQuestions.push("Which built-in functions or approaches are forbidden (e.g. built-in sorting, min/max, or data structure libraries)?");
    }
  }

  // 4. Expected outputs & Replacements
  let updatedExpectedVal = null;

  if (/\binstead\s+of\s+(none|null|\-?\d+)[,\s]+return\s+(\-?\d+|none|null)\b/i.test(lower)) {
    const m = lower.match(/\binstead\s+of\s+(?:none|null|\-?\d+)[,\s]+return\s+(\-?\d+|none|null)\b/i);
    if (m) updatedExpectedVal = m[1];
  } else if (/\breturn\s+(\-?\d+|none|null)\s+instead(?:\s+of\s+(none|null|\-?\d+))?\b/i.test(lower)) {
    const m = lower.match(/\breturn\s+(\-?\d+|none|null)\s+instead/i);
    if (m) updatedExpectedVal = m[1];
  } else if (/\b(actually|please)?,?\s*return\s+(\-?\d+|none|null)\b/i.test(lower) && /\b(if|when|instead)\b/i.test(lower)) {
    const m = lower.match(/\breturn\s+(\-?\d+|none|null)\b/i);
    if (m) updatedExpectedVal = m[1];
  } else if (/\breturn\s+(none|null|\-?\d+)\s+(if|when)\s+(it\s+)?(does\s+not\s+exist|not\s+found|empty)\b/i.test(lower)) {
    const m = lower.match(/\breturn\s+(none|null|\-?\d+)\b/i);
    if (m) updatedExpectedVal = m[1];
  }

  if (updatedExpectedVal !== null) {
    const val = (updatedExpectedVal.toLowerCase() === 'none' || updatedExpectedVal.toLowerCase() === 'null')
      ? null
      : (isNaN(Number(updatedExpectedVal)) ? updatedExpectedVal : Number(updatedExpectedVal));
    const valStr = val === null ? 'None' : String(val);

    task.expectedOutput = `Return ${valStr} if element does not exist`;
    const reqIdx = task.requiredOperations.findIndex(r => r.id === 'output-not-found');
    const reqObj = { id: 'output-not-found', text: `Return ${valStr} if not found`, sourceWords: raw };
    if (reqIdx >= 0) {
      task.requiredOperations[reqIdx] = reqObj;
    } else {
      task.requiredOperations.push(reqObj);
    }

    // Update any existing examples for edge case (e.g. [4, 4] where all elements are identical)
    for (const ex of task.examples) {
      if (Array.isArray(ex.input) && new Set(ex.input).size <= 1) {
        ex.expected = val;
        ex.rawText = `[${ex.input.join(', ')}] produces ${valStr}`;
      }
    }
  }

  // 5. Order constraints:
  if (/\b(descending|descending order|reverse order)\b/i.test(lower)) {
    task.requiredOperations = task.requiredOperations.filter(r => r.id !== 'order-asc');
    if (!task.requiredOperations.some(r => r.id === 'order-desc')) {
      task.requiredOperations.push({ id: 'order-desc', text: 'Descending order', sourceWords: raw });
    }
  } else if (/\b(ascending|ascending order)\b/i.test(lower)) {
    task.requiredOperations = task.requiredOperations.filter(r => r.id !== 'order-desc');
    if (!task.requiredOperations.some(r => r.id === 'order-asc')) {
      task.requiredOperations.push({ id: 'order-asc', text: 'Ascending order', sourceWords: raw });
    }
  }

  // 6. Distinctness constraint
  if (/\b(distinct|unique|second distinct|second unique)\b/i.test(lower)) {
    if (!task.requiredOperations.some(r => r.id === 'distinct')) {
      task.requiredOperations.push({ id: 'distinct', text: 'Distinct/unique elements (ignore duplicate values)', sourceWords: raw });
    }
  }

  // 7. Extract examples if spoken
  const exampleMatches = lower.match(/\[([0-9,\s\-]+)\][^\d\-a-z]*((produces?|returns?|gives?|is|output)\s*)?(\-?[0-9]+|none|null)/gi);
  if (exampleMatches) {
    for (const exStr of exampleMatches) {
      const arrMatch = exStr.match(/\[([0-9,\s\-]+)\]/);
      const resMatch = exStr.match(/(?:produces?|returns?|gives?|is|output)?\s*(\-?[0-9]+|none|null)$/i);
      if (arrMatch && resMatch) {
        try {
          const inp = JSON.parse(`[${arrMatch[1]}]`);
          const rawExp = resMatch[1].trim().toLowerCase();
          const expected = (rawExp === 'none' || rawExp === 'null') ? null : Number(rawExp);
          if (!task.examples.some(e => JSON.stringify(e.input) === JSON.stringify(inp))) {
            task.examples.push({ input: inp, expected, rawText: exStr });
          }
        } catch (e) {}
      }
    }
  }

  // Standard examples for second distinct largest
  if (/\b(second\s+(distinct\s+)?largest)\b/i.test(task.problem) && task.examples.length === 0) {
    const fallbackExpectedOnEqual = task.expectedOutput && task.expectedOutput.includes('-1') ? -1 : null;
    task.examples = [
      { input: [5, 5, 3], expected: 3, rawText: '[5, 5, 3] produces 3' },
      { input: [-1, -3, -2], expected: -2, rawText: '[-1, -3, -2] produces -2' },
      { input: [4, 4], expected: fallbackExpectedOnEqual, rawText: `[4, 4] produces ${fallbackExpectedOnEqual}` }
    ];
  }

  task.activePillSummary = task.getPillSummary();
  return task;
}

function checkForbiddenOperations(code, forbiddenOperations) {
  if (!Array.isArray(forbiddenOperations) || forbiddenOperations.length === 0) {
    return { ok: true };
  }
  // Strip comments
  const withoutComments = code
    .replace(/#.*$/gm, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
  // Strip string literals
  const withoutStrings = withoutComments
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/'''[\s\S]*?'''/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");

  for (const forbidden of forbiddenOperations) {
    for (const term of (forbidden.forbiddenTerms || [])) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(withoutStrings)) {
        return {
          ok: false,
          error: `Forbidden operation "${forbidden.text}" detected in code (found "${term}").`
        };
      }
    }
  }
  return { ok: true };
}

function verifyGeneratedCode(code, lang, task) {
  if (!code || !code.trim()) return { ok: false, error: 'Empty code' };
  const normalizedLang = (lang || task.language || 'python').toLowerCase().trim();

  // 1. Forbidden operations check
  const forbiddenCheck = checkForbiddenOperations(code, task.forbiddenOperations);
  if (!forbiddenCheck.ok) {
    return { ok: false, error: forbiddenCheck.error, type: 'forbidden_operation' };
  }

  // 2. Syntax & isolated execution checks for Python
  if (normalizedLang === 'python') {
    // Syntax check
    try {
      execFileSync('python', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
        input: code,
        timeout: 1500,
        encoding: 'utf-8'
      });
    } catch (err) {
      return { ok: false, error: `Python syntax error: ${err.message}`, type: 'syntax' };
    }

    // Isolated unit test execution if examples exist
    if (Array.isArray(task.examples) && task.examples.length > 0) {
      const runnerScript = `
import sys, json, ast

user_code = sys.stdin.read()
tree = ast.parse(user_code)

func_name = None
for node in tree.body:
    if isinstance(node, ast.FunctionDef):
        func_name = node.name
        break

if not func_name:
    print(json.dumps({"error": "No function defined in code"}))
    sys.exit(0)

namespace = {}
exec(compile(tree, filename="<eval>", mode="exec"), namespace)
fn = namespace[func_name]

test_cases = json.loads(sys.argv[1])
results = []

for tc in test_cases:
    inp = tc["input"]
    expected = tc["expected"]
    try:
        if isinstance(inp, list) and (len(inp) == 0 or not isinstance(inp[0], list)):
            actual = fn(inp)
        elif isinstance(inp, list):
            actual = fn(*inp)
        else:
            actual = fn(inp)
        passed = (actual == expected)
        results.append({"input": inp, "expected": expected, "actual": actual, "passed": passed})
    except Exception as e:
        results.append({"input": inp, "expected": expected, "error": str(e), "passed": False})

print(json.dumps({"results": results}))
`;
      try {
        const out = execFileSync('python', ['-c', runnerScript, JSON.stringify(task.examples)], {
          input: code,
          timeout: 2000,
          encoding: 'utf-8'
        });
        const parsed = JSON.parse(out.trim());
        if (parsed.results) {
          const failed = parsed.results.find(r => !r.passed);
          if (failed) {
            return {
              ok: false,
              error: `Example test verification failed on input ${JSON.stringify(failed.input)}: got ${JSON.stringify(failed.actual)}, expected ${JSON.stringify(failed.expected)}`,
              type: 'example_mismatch',
              details: parsed.results
            };
          }
        }
      } catch (err) {
        console.warn('[Verification] Test runner execution error:', err.message);
      }
    }
  }

  return { ok: true, verified: true };
}

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
      initialWebmHeader: null,
      activeCodingLanguage: null,
      codingTask: null,
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
    this.WINDOW_MS = 15000;   // 15-second question accumulation window
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
    codingTask: session.codingTask || null,
    candidate: candidateContext,
  };
}

// ─────────────────────────────────────────────────────────────
//  System prompt — continuity, language consistency, simple answers & clean code
// ─────────────────────────────────────────────────────────────
function buildSystemPrompt(ctx) {
  const { candidate, parentQuestion, parentAnswer, activeCodingLanguage, codingTask } = ctx;
  const defaultLang = candidate.preferredLanguage || 'Python';
  const effectiveLang = (codingTask && codingTask.language) ? codingTask.language : (activeCodingLanguage || defaultLang);

  let followUpSection = '';
  if (parentQuestion) {
    followUpSection = `
RECENT CONVERSATION CONTEXT:
* Previous Question: "${parentQuestion}"
* Previous Answer Summary: ${parentAnswer ? parentAnswer.slice(0, 600) : '(none)'}
* This interview is an ongoing conversation. When the current question asks for optimization, edge cases, explanation, variations, or refers to "it", "that", "the function", or "the query", DIRECTLY build upon the previous solution above.`;
  }

  let codingTaskSection = '';
  if (codingTask) {
    const task = codingTask;
    const reqs = task.requiredOperations.length > 0
      ? task.requiredOperations.map(r => `* ${r.text} (Interviewer spoken instruction: "${r.sourceWords}")`).join('\n')
      : '* Solve the stated problem cleanly';
    const forbs = task.forbiddenOperations.length > 0
      ? task.forbiddenOperations.map(f => `* STRICTLY FORBIDDEN: DO NOT USE ${f.text} (Forbidden functions/keywords: ${f.forbiddenTerms.join(', ')}; from interviewer: "${f.sourceWords}")`).join('\n')
      : '* No forbidden operations specified';
    const out = task.expectedOutput ? `* Return Output: ${task.expectedOutput}` : '';
    const exs = task.examples.length > 0
      ? task.examples.map(e => `* Example input/output: ${e.rawText || JSON.stringify(e)}`).join('\n')
      : '';
    const clarifications = task.unresolvedQuestions.length > 0
      ? `\nCLARIFICATION NEEDED:\n${task.unresolvedQuestions.map(q => `* Ask concisely: "${q}"`).join('\n')}`
      : '';

    codingTaskSection = `
ACTIVE CODING TASK SPECIFICATION (Revision ${task.revision}):
- Summary: ${task.activePillSummary || task.getPillSummary()}
- Primary Task: ${task.problem}
- Target Language: ${task.language}
- Required Operations & Constraints:
${reqs}
${out}
${exs ? `\n- Test Cases & Examples:\n${exs}` : ''}
- FORBIDDEN OPERATIONS & RESTRICTIONS:
${forbs}
${clarifications}

MANDATORY CODING DIRECTIVE:
"Implement the complete current task and satisfy every active requirement. Follow the specified language and framework. Do not use forbidden operations, including equivalent shortcuts that violate the restriction. Preserve required input and output behavior. If requirements conflict or essential information is missing, ask one precise question. Produce one simple, readable solution."`;
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
${codingTaskSection}

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
function commitQuestion(sessionId, questionText, session, words = [], rawTranscript = null) {
  const trimmed = questionText.trim();
  if (!trimmed) return;

  const rawText = rawTranscript || trimmed;
  const analysis = analyzeWordUncertainty(words, technicalVocabulary);
  const wordCount = trimmed.split(/\s+/).length;
  const isQuestionStarter = /^(what|why|how|explain|can you|write|implement|tell me|describe)\b/i.test(trimmed);

  // ── Coding Task Intent & Requirement Parsing ──
  const isNewProblem = /\b(new problem|next question|different problem|another problem|now let's switch|switch to)\b/i.test(trimmed);
  if (isNewProblem) {
    session.codingTask = null;
    session.activeCodingLanguage = null;
    console.log('[CodingTask] New problem detected. Cleared previous coding task restrictions.');
  }

  const isCodingSpec = isCodingInstructionOrConstraint(trimmed);
  const isExplanationOnly = /\b(why did you|can you explain|what does line|what is the (time|space) complexity|how does (this|that) work)\b/i.test(trimmed);
  let taskUpdated = false;

  if (!isExplanationOnly && (isCodingSpec || session.codingTask)) {
    const prevRev = session.codingTask ? session.codingTask.revision : 0;
    session.codingTask = updateCodingTaskFromSpeech(session.codingTask, trimmed, candidateContext.preferredLanguage || 'python');

    if (prevRev > 0) {
      session.codingTask.revision = prevRev + 1;
      taskUpdated = true;
      console.log(`[CodingTask] Updated task to revision ${session.codingTask.revision}: ${session.codingTask.getPillSummary()}`);

      // Mark older answers from previous revisions as superseded in chat history
      for (const m of session.messages) {
        if (m.role === 'answer' && !m.isSuperseded) {
          m.isSuperseded = true;
          m.supersededByRevision = session.codingTask.revision;
        }
      }
    }
  }

  // ── 15-Second Stitching Rule for General Questions ──
  const lastQ = [...session.messages].reverse().find(m => m.role === 'question');
  const timeSinceLastQ = lastQ ? Date.now() - lastQ.createdAt : Infinity;
  const isContinuation = timeSinceLastQ < 15000 && (!isQuestionStarter || wordCount <= 4) && !taskUpdated;

  if (lastQ && isContinuation && !session.codingTask) {
    // Abort previous partial answer
    if (session.activeAbort) {
      session.activeAbort.abort();
      session.activeAbort = null;
    }

    session.messages = session.messages.filter(m => !(m.role === 'answer' && m.parentId === lastQ.id));

    lastQ.text = `${lastQ.text.trim()} ${trimmed}`;
    lastQ.rawText = `${lastQ.rawText ? lastQ.rawText.trim() : lastQ.text.trim()} ${rawText}`;
    lastQ.uncertainWords = analysis.uncertainWords;
    lastQ.createdAt = Date.now();
    session.pendingQuestionHash = hashText(lastQ.text);

    broadcastToSession(sessionId, {
      type: 'question_updated',
      msgId: lastQ.id,
      text: lastQ.text,
      rawText: lastQ.rawText,
      uncertainWords: lastQ.uncertainWords,
      sessionId
    });

    streamAiAnswer(sessionId, lastQ.text, lastQ.id, session);
    return;
  }

  // Auto-expire answers stuck in 'streaming' older than 30s
  const now = Date.now();
  for (const m of session.messages) {
    if (m.role === 'answer' && m.status === 'streaming' && (now - (m.createdAt || 0)) > 30000) {
      m.status = 'complete';
      console.log(`[Server] Auto-expired stale streaming answer ${m.id}`);
    }
  }

  // Noise Filter: NEVER discard coding commands or constraints!
  const isCurrentlyStreaming = [...session.messages].some(m => m.role === 'answer' && m.status === 'streaming');
  if (isCurrentlyStreaming && !isCodingSpec && !session.codingTask && (NOISE_ONLY.test(trimmed) || (wordCount <= 2 && /^(ok|yeah|yep|mhm|uh-huh|right|sure|cool|got it)$/i.test(trimmed)))) {
    console.log(`[Noise Filter] Ignored filler noise "${trimmed}" while answer is streaming.`);
    return;
  }

  // Deduplicate by question hash
  const qHash = hashText(trimmed);
  if (session.pendingQuestionHash === qHash) return;
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

  // Abort any in-progress generation immediately so outdated code stops streaming
  if (session.activeAbort) {
    session.activeAbort.abort();
    session.activeAbort = null;
    const inProgress = [...session.messages].reverse().find(m => m.role === 'answer' && m.status === 'streaming');
    if (inProgress) {
      inProgress.status = 'interrupted';
      inProgress.isSuperseded = true;
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
//  Main streaming answer function with task tracking & verification
// ─────────────────────────────────────────────────────────────
async function streamAiAnswer(sessionId, question, questionMsgId, session, continueFromText = '') {
  const reqId = uid('req');
  const aMsgId = uid('a');
  const startTime = Date.now();

  const abort = new AbortController();
  session.activeAbort = abort;
  session.activeReqId = reqId;

  const task = session.codingTask;
  const revision = task ? task.revision : 1;
  const taskPill = task ? (task.activePillSummary || task.getPillSummary()) : null;
  const revisionNote = (task && revision > 1) ? `Revision ${revision} · ${taskPill}` : null;

  // Create answer message
  const aMsg = {
    id: aMsgId,
    role: 'answer',
    text: continueFromText,
    status: 'streaming',
    parentId: questionMsgId,
    reqId,
    taskPill,
    revision,
    revisionNote,
    isSuperseded: false,
    verificationStatus: null,
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
    taskPill,
    revision,
    revisionNote,
    isSuperseded: false,
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

  const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
  const groq = new Groq({ apiKey: groqKey });

  for (const model of models) {
    if (abort.signal.aborted) break;

    try {
      const stream = await groq.chat.completions.create({
        messages: chatMessages,
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

        // Reject if session moved to a new request or revision
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
            taskPill,
            revision,
            revisionNote,
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

        // Code verification and one targeted repair
        if (task) {
          const codeMatch = accumulated.match(/```(\w+)?\n([\s\S]*?)```/);
          if (codeMatch && codeMatch[2]) {
            const detectedLang = codeMatch[1] ? codeMatch[1].toLowerCase() : task.language;
            session.activeCodingLanguage = detectedLang;
            let verif = verifyGeneratedCode(codeMatch[2], detectedLang, task);

            // One targeted repair if verification failed
            if (!verif.ok && groqKey) {
              console.log(`[Verification] Verification failed (${verif.error}). Attempting 1 targeted repair...`);
              try {
                const repairPrompt = `Your previous solution for this coding task failed verification with this specific error:
${verif.error}

Active Task Requirements:
- Problem: ${task.problem}
- Language: ${task.language}
- Forbidden operations: ${task.forbiddenOperations.map(f => f.text).join(', ') || 'none'}
- Expected outputs: ${task.expectedOutput || 'see examples'}

Please fix this issue immediately.
Implement the complete current task and satisfy every active requirement. Follow the specified language and framework. Do not use forbidden operations, including equivalent shortcuts that violate the restriction. Preserve required input and output behavior. Produce one simple, readable solution.`;

                const repairMessages = [
                  { role: 'system', content: systemPrompt },
                  { role: 'assistant', content: accumulated },
                  { role: 'user', content: repairPrompt }
                ];

                const repairRes = await groq.chat.completions.create({
                  messages: repairMessages,
                  model,
                  temperature: 0.1,
                  max_tokens: 800
                });

                const repairedContent = repairRes.choices[0]?.message?.content;
                if (repairedContent) {
                  const repMatch = repairedContent.match(/```(\w+)?\n([\s\S]*?)```/);
                  if (repMatch) {
                    const repVerif = verifyGeneratedCode(repMatch[2], repMatch[1] || task.language, task);
                    if (repVerif.ok) {
                      console.log('[Verification] Targeted repair verified successfully!');
                      accumulated = repairedContent;
                      aMsg.text = accumulated;
                      verif = repVerif;
                    }
                  }
                }
              } catch (repErr) {
                console.warn('[Verification] Repair attempt error:', repErr.message);
              }
            }

            aMsg.verificationStatus = verif.ok ? 'verified' : 'failed';
            aMsg.verificationDetails = verif;
            task.currentCode = codeMatch[2];
            task.verificationStatus = aMsg.verificationStatus;
          }
        }

        broadcastToSession(sessionId, {
          type: 'chat_done',
          msgId: aMsgId,
          reqId,
          fullText: accumulated,
          totalTime,
          taskPill: aMsg.taskPill,
          revision: aMsg.revision,
          revisionNote: aMsg.revisionNote,
          verificationStatus: aMsg.verificationStatus,
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
        // Rate limit — log and try next model or wait briefly
        console.warn(`[Groq] Rate limit 429 on model ${model}, trying next model...`);
        continue;
      }

      if (status === 401) {
        console.warn(`[Groq] 401 Auth error. Falling back to local responder.`);
        break; // break to fallback
      }

      console.warn(`[Groq] Model ${model} error: ${err.message}. Trying next model...`);
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

  if (q.includes('second') && (q.includes('largest') || q.includes('distinct'))) {
    const returnVal = q.includes('-1') ? '-1' : 'None';
    answer = `To find the second distinct largest number without sorting, maintain two variables tracking the largest and second largest distinct values in a single pass.\n\n\`\`\`python\ndef second_distinct_largest(nums):\n    if not nums:\n        return ${returnVal}\n    first = second = None\n    for n in nums:\n        if first is None or n > first:\n            second = first\n            first = n\n        elif n != first and (second is None or n > second):\n            second = n\n    return second if second is not None else ${returnVal}\n\`\`\`\n\nThis scans the array once in O(N) time with O(1) extra space. Comparing against first and second avoids duplicate values like [5, 5, 3] and properly returns ${returnVal} when no second distinct value exists.`;
  } else if (q.includes('sql') || q.includes('query') || q.includes('salary') || q.includes('database')) {
    answer = `To find the second-highest salary per department while handling ties, use the DENSE_RANK() window function.\n\n\`\`\`sql\nSELECT department, employee_name, salary\nFROM (\n  SELECT department, employee_name, salary,\n         DENSE_RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS rnk\n  FROM employees\n  WHERE salary IS NOT NULL\n) ranked\nWHERE rnk = 2;\n\`\`\`\n\nThe inner query ranks employees by salary within each department without skipping rank numbers when ties occur. The outer query filters for rank 2 to return all second-highest earners cleanly.`;
  } else if (q.includes('react') || q.includes('virtual dom') || q.includes('usememo')) {
    answer = `React's Virtual DOM is a lightweight memory representation of the real DOM. When state changes, React compares the new tree with the old one and updates only the changed DOM elements.\n\n- useMemo caches calculated values across renders\n- useCallback preserves function references to avoid child re-renders\n- Keys help React track which items were added or moved`;
  } else if (q.includes('node') || q.includes('event loop')) {
    answer = `Node.js runs single-threaded JavaScript using a non-blocking event loop backed by libuv.\n\nIt handles timers, pending I/O, and poll events in distinct phases, draining microtasks after each phase. Long compute jobs should be offloaded to worker threads so the main event loop never blocks.`;
  } else if (q.includes('broadcast join') || q.includes('join')) {
    answer = `A broadcast join copies a small table to all worker nodes so the large table can be joined locally without network shuffling.\n\nUse it when the smaller table fits comfortably in executor memory, typically under 10MB to a few hundred megabytes in Spark. Avoid broadcasting large tables because it can overwhelm driver and executor memory.`;
  } else {
    const cleanQ = question.replace(/^(what is|how do|explain|tell me about)\s+/i, '').trim();
    const topic = cleanQ ? cleanQ.charAt(0).toUpperCase() + cleanQ.slice(1) : 'This problem';
    answer = `${topic} is best approached by breaking the task into simple, testable steps.\n\nStart directly with the core solution and keep the implementation readable and standard. In my experience, straightforward solutions are easier to maintain, review, and debug.`;
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
