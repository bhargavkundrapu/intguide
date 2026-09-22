// Automated verification test script for speech recognition fixes & response quality
const http = require('http');
const WebSocket = require('ws');
const assert = require('assert');

const PORT = 5000;
const BASE_URL = `http://localhost:${PORT}`;

async function runTests() {
  console.log('🧪 Starting End-to-End Verification Tests...\n');

  // ── Test 1: Vocabulary REST API ──
  console.log('▶ Test 1: Testing /api/vocabulary GET & POST');
  const getVocab = await new Promise((resolve, reject) => {
    http.get(`${BASE_URL}/api/vocabulary`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  console.log(`  Found ${getVocab.count} technical vocabulary terms.`);
  const requiredTerms = [
    'PySpark', 'coalesce', 'repartition', 'Databricks', 'Athena',
    'Redshift', 'broadcast join', 'shuffle join', 'partition projection',
    'dense_rank', 'row_number'
  ];
  for (const term of requiredTerms) {
    assert(
      getVocab.terms.some(t => t.toLowerCase() === term.toLowerCase()),
      `Expected term "${term}" to be in vocabulary!`
    );
  }
  console.log('  ✅ All required résumé and technical terms are present.');

  // Test adding a custom term via POST
  const postVocab = await new Promise((resolve, reject) => {
    const payload = JSON.stringify({ term: 'Apache Iceberg' });
    const req = http.request(`${BASE_URL}/api/vocabulary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
  assert(postVocab.terms.includes('Apache Iceberg'), 'Expected Apache Iceberg to be dynamically added!');
  console.log('  ✅ Dynamic keyterm addition via POST /api/vocabulary confirmed.');

  // ── Test 2: WebSocket Connection, Question Stitching & Uncertainty Detection ──
  console.log('\n▶ Test 2: Testing WebSocket session, question handling & answer streaming');
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const sessionId = 'TEST-SESSION-' + Date.now();
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

  // Step 2a: Trigger "write a code for" (incomplete preposition)
  console.log('  Simulating speech fragment: "write a code for"...');
  ws.send(JSON.stringify({
    type: 'trigger_answer',
    question: 'write a code for'
  }));

  await new Promise(r => setTimeout(r, 600));

  // Step 2b: Within 5 seconds, simulate continuation fragment: "palindrome"
  console.log('  Simulating follow-up continuation: "palindrome" within 5 seconds...');
  ws.send(JSON.stringify({
    type: 'trigger_answer',
    question: 'palindrome'
  }));

  // Wait for answer streaming to finish
  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (receivedMessages.some(m => m.type === 'chat_done')) {
        clearInterval(check);
        resolve();
      }
    }, 200);
    setTimeout(() => { clearInterval(check); resolve(); }, 6000);
  });

  // Verify stitching occurred
  const updatedQuestion = receivedMessages.find(m => m.type === 'question_updated');
  assert(updatedQuestion, 'Expected question_updated event for stitched question!');
  assert(
    updatedQuestion.text.toLowerCase().includes('write a code for') &&
    updatedQuestion.text.toLowerCase().includes('palindrome'),
    `Stitched question text should contain both parts, got: "${updatedQuestion.text}"`
  );
  console.log(`  ✅ Stitched successfully into: "${updatedQuestion.text}"`);

  // ── Test 3: "Edit question" action and clean regeneration ──
  console.log('\n▶ Test 3: Testing "edit_question" action and answer cancellation/regeneration');
  const initialDoneAnswer = receivedMessages.find(m => m.type === 'chat_done');
  assert(initialDoneAnswer, 'Expected initial answer to finish before testing edit.');

  // Edit question to "explain broadcast join vs shuffle join in PySpark"
  console.log('  Sending edit_question: "explain broadcast join vs shuffle join in PySpark"...');
  ws.send(JSON.stringify({
    type: 'edit_question',
    msgId: updatedQuestion.msgId,
    newText: 'explain broadcast join vs shuffle join in PySpark'
  }));

  // Wait for new chat_done
  await new Promise((resolve) => {
    const check = setInterval(() => {
      const newDones = receivedMessages.filter(m => m.type === 'chat_done');
      if (newDones.length > 1) {
        clearInterval(check);
        resolve();
      }
    }, 200);
    setTimeout(() => { clearInterval(check); resolve(); }, 7000);
  });

  const questionEditEvent = receivedMessages.find(m => m.type === 'question_updated' && m.isEdited);
  assert(questionEditEvent, 'Expected question_updated event with isEdited: true');
  assert.strictEqual(questionEditEvent.text, 'explain broadcast join vs shuffle join in PySpark');
  console.log('  ✅ Edit question broadcast received with updated text.');

  const allAnswers = receivedMessages.filter(m => m.type === 'chat_done');
  const latestAnswer = allAnswers[allAnswers.length - 1];
  assert(latestAnswer && latestAnswer.fullText, 'Expected regenerated answer content!');
  console.log(`  ✅ Regenerated answer received (${latestAnswer.fullText.length} chars).`);

  ws.close();

  console.log('\n🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
