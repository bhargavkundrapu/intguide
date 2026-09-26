const http = require('http');
const WebSocket = require('ws');
const assert = require('assert');

const PORT = 5000;
const BASE_URL = `http://localhost:${PORT}`;

async function runWholeQuestionTests() {
  console.log('🧪 Starting Advanced Whole Question Detection & Response Tests...\n');

  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const sessionId = 'TEST-WHOLE-Q-' + Date.now();
  const receivedMessages = [];

  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'register', session: sessionId, role: 'laptop' }));
      resolve();
    });
    ws.on('error', reject);
  });

  ws.on('message', data => {
    try {
      const msg = JSON.parse(data.toString());
      receivedMessages.push(msg);
    } catch (e) {}
  });

  // ── Test 1: Premise Clause + Action Question Stitching ──
  console.log('▶ Test 1: Testing problem setup premise followed by actual question');
  console.log('  Sending premise: "Suppose we have two sorted arrays."');
  ws.send(JSON.stringify({
    type: 'trigger_answer',
    question: 'Suppose we have two sorted arrays.'
  }));

  await new Promise(r => setTimeout(r, 600));

  console.log('  Sending actual question within continuation window: "How do we find the median in logarithmic time?"');
  ws.send(JSON.stringify({
    type: 'trigger_answer',
    question: 'How do we find the median in logarithmic time?'
  }));

  // Wait for answer
  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (receivedMessages.some(m => m.type === 'chat_done')) {
        clearInterval(check);
        resolve();
      }
    }, 200);
    setTimeout(() => { clearInterval(check); resolve(); }, 8000);
  });

  const stitched1 = receivedMessages.find(m => m.type === 'question_updated');
  assert(stitched1, 'Expected question_updated event for stitched premise + question!');
  assert(
    stitched1.text.includes('Suppose we have two sorted arrays') &&
    stitched1.text.includes('find the median'),
    `Stitched question text should contain both premise and question, got: "${stitched1.text}"`
  );
  console.log(`  ✅ Stitched successfully into: "${stitched1.text}"`);

  // ── Test 2: Core Question + In-Place / Constraint Continuation ──
  console.log('\n▶ Test 2: Testing constraint continuation: "Write a function to reverse a list" + "in-place and without allocating extra memory"');
  const countBefore = receivedMessages.filter(m => m.type === 'chat_done').length;

  ws.send(JSON.stringify({
    type: 'trigger_answer',
    question: 'Write a function to reverse a list'
  }));

  await new Promise(r => setTimeout(r, 700));

  ws.send(JSON.stringify({
    type: 'trigger_answer',
    question: 'in-place and without allocating extra memory'
  }));

  await new Promise((resolve) => {
    const check = setInterval(() => {
      const countNow = receivedMessages.filter(m => m.type === 'chat_done').length;
      if (countNow > countBefore) {
        clearInterval(check);
        resolve();
      }
    }, 200);
    setTimeout(() => { clearInterval(check); resolve(); }, 8000);
  });

  const stitched2 = receivedMessages.filter(m => m.type === 'question_updated');
  const latestStitched = stitched2[stitched2.length - 1];
  assert(latestStitched, 'Expected question_updated event for constraint stitching!');
  assert(
    latestStitched.text.toLowerCase().includes('reverse a list') &&
    latestStitched.text.toLowerCase().includes('in-place'),
    `Stitched question should contain constraint, got: "${latestStitched.text}"`
  );
  console.log(`  ✅ Stitched constraint successfully into: "${latestStitched.text}"`);

  // Verify answer response
  const latestAnswer = receivedMessages.filter(m => m.type === 'chat_done').pop();
  assert(latestAnswer && latestAnswer.fullText, 'Expected answer response from Groq/LLM');
  console.log(`  ✅ Received comprehensive answer (${latestAnswer.fullText.length} chars)`);

  // ── Test 3: Behavioral Question Detection ──
  console.log('\n▶ Test 3: Testing behavioral question detection: "Tell me about a time you handled a difficult production issue."');
  const countBefore3 = receivedMessages.filter(m => m.type === 'chat_done').length;

  ws.send(JSON.stringify({
    type: 'trigger_answer',
    question: 'Tell me about a time you handled a difficult production issue.'
  }));

  await new Promise((resolve) => {
    const check = setInterval(() => {
      const countNow = receivedMessages.filter(m => m.type === 'chat_done').length;
      if (countNow > countBefore3) {
        clearInterval(check);
        resolve();
      }
    }, 200);
    setTimeout(() => { clearInterval(check); resolve(); }, 8000);
  });

  const behavioralQ = receivedMessages.find(m => m.type === 'question_committed' && m.text.includes('production issue'));
  assert(behavioralQ, 'Expected behavioral question to be committed (not filtered as noise)!');
  console.log(`  ✅ Behavioral question accepted and committed: "${behavioralQ.text}"`);

  ws.close();
  console.log('\n🎉 ALL WHOLE-QUESTION TESTS PASSED WITH 100% SUCCESS!\n');
}

runWholeQuestionTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
