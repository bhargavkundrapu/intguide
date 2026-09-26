const WebSocket = require('ws');
const assert = require('assert');

const PORT = 5000;

async function testSequentialQuestions() {
  console.log('🧪 Testing Sequential Question Detection & Deduplication Across Questions...\n');

  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const sessionId = 'TEST-SEQ-' + Date.now();
  const committedQuestions = [];
  const updatedQuestions = [];

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
      if (msg.type === 'question_committed') {
        committedQuestions.push(msg);
      } else if (msg.type === 'question_updated') {
        updatedQuestions.push(msg);
      }
    } catch (e) {}
  });

  // ── Test Question 1 ──
  console.log('▶ Question 1: "What is the difference between a process and a thread?"');
  ws.send(JSON.stringify({
    type: 'trigger_answer',
    question: 'What is the difference between a process and a thread?'
  }));

  await new Promise(r => setTimeout(r, 1500));
  assert(committedQuestions.length >= 1, 'Question 1 should be committed');
  assert(committedQuestions[0].text.startsWith('What is'), `Question 1 should start with "What is", got: "${committedQuestions[0].text}"`);
  console.log(`  ✅ Question 1 detected properly: "${committedQuestions[0].text}"`);

  // ── Test Question 2 (Starts with identical opening words "What is") ──
  console.log('\n▶ Question 2: Starting with identical opener "What is the event loop in Node.js?"');
  ws.send(JSON.stringify({
    type: 'trigger_answer',
    question: 'What is the event loop in Node.js?'
  }));

  await new Promise(r => setTimeout(r, 1500));
  assert(committedQuestions.length >= 2, 'Question 2 should be committed as a new question');
  const q2 = committedQuestions[committedQuestions.length - 1];
  assert(q2.text.startsWith('What is'), `Question 2 must NOT drop the start! Expected to start with "What is", got: "${q2.text}"`);
  console.log(`  ✅ Question 2 detected from the start without dropping "What is": "${q2.text}"`);

  // ── Test Question 3 (Multi-part premise + continuation) ──
  console.log('\n▶ Question 3: Premise + question in sequence');
  ws.send(JSON.stringify({
    type: 'trigger_answer',
    question: 'Suppose we have an array of integers.'
  }));

  await new Promise(r => setTimeout(r, 800));

  ws.send(JSON.stringify({
    type: 'trigger_answer',
    question: 'How do we find two numbers that sum up to target?'
  }));

  await new Promise(r => setTimeout(r, 2000));
  const latestUpdated = updatedQuestions[updatedQuestions.length - 1];
  assert(latestUpdated, 'Question 3 should be stitched');
  assert(latestUpdated.text.includes('Suppose we have an array of integers'), 'Must include the premise from the start');
  assert(latestUpdated.text.includes('sum up to target'), 'Must include the core question');
  console.log(`  ✅ Question 3 stitched successfully with entire question from start: "${latestUpdated.text}"`);

  ws.close();
  console.log('\n🎉 ALL SEQUENTIAL QUESTION TESTS PASSED!\n');
}

testSequentialQuestions().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
