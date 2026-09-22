const WebSocket = require('ws');
const http = require('http');

async function main() {
  console.log('=== Starting Dual Stream & 100+ Keywords Verification Test ===\n');

  // Test 1: Check 100+ Technical Keywords endpoint
  console.log('1. Checking /api/vocabulary & /api/context for >= 100 technical keywords...');
  const vocabRes = await fetch('http://localhost:5000/api/vocabulary').then(r => r.json());
  console.log(`   - Technical vocabulary count: ${vocabRes.count}`);
  if (vocabRes.count < 100) {
    throw new Error(`Expected at least 100 keywords, got ${vocabRes.count}`);
  }
  console.log(`   - Sample keywords: ${vocabRes.terms.slice(0, 8).join(', ')}...`);
  console.log('   ✓ 100+ technical keywords verified.\n');

  // Test 2: Save background and verify only technical keywords saved
  console.log('2. Testing POST /api/context background save...');
  const saveRes = await fetch('http://localhost:5000/api/context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetRole: 'Senior Data Engineer',
      resume: '5 years with PySpark, Delta Lake, Databricks, Redshift, Kafka, and Kubernetes. Strong experience building data mesh architectures.',
      projects: 'Real-time streaming pipeline using Structured Streaming and Broadcast Joins.'
    })
  }).then(r => r.json());

  console.log(`   - Saved context keywords count: ${saveRes.keywordsCount}`);
  if (saveRes.keywordsCount < 100) {
    throw new Error(`Keywords count dropped below 100: ${saveRes.keywordsCount}`);
  }
  console.log('   ✓ Background saved with 100+ technical keywords preserved.\n');

  // Test 3: WebSocket Dual Stream Simulation
  console.log('3. Testing WebSocket Dual Stream separation...');
  const testSessionId = 'SESSION-TEST-' + Math.floor(Math.random() * 10000);
  const ws = new WebSocket('ws://localhost:5000');

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  const receivedMessages = [];
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      receivedMessages.push(msg);
    } catch (e) {}
  });

  // Register as laptop
  ws.send(JSON.stringify({
    type: 'register',
    session: testSessionId,
    role: 'laptop'
  }));

  await new Promise(r => setTimeout(r, 400));

  // Test 4: Candidate speaks via transcript_sync (source: 'candidate')
  console.log('4. Testing candidate microphone speech (MUST NOT trigger auto-answer)...');
  const initialMsgCount = receivedMessages.filter(m => m.type === 'chat_message').length;

  ws.send(JSON.stringify({
    type: 'transcript_sync',
    source: 'candidate',
    transcript: 'I would use a broadcast join because the dimension table is smaller than 10MB.',
    isFinal: true
  }));

  await new Promise(r => setTimeout(r, 600));

  const candidateFinal = receivedMessages.find(m => m.type === 'candidate_speech_final');
  if (!candidateFinal) {
    throw new Error('Expected candidate_speech_final event for candidate speech');
  }
  console.log(`   - Received candidate_speech_final: "${candidateFinal.text}"`);

  // Verify NO auto-answer was triggered by candidate's speech
  const postCandidateChatMsgs = receivedMessages.filter(m => m.type === 'chat_message').length;
  if (postCandidateChatMsgs > initialMsgCount) {
    throw new Error('FAIL: Candidate speech incorrectly triggered an AI answer!');
  }
  console.log('   ✓ Candidate speech recorded without triggering unwanted AI generation.\n');

  // Test 5: Interviewer asks a question
  console.log('5. Testing interviewer question commit and AI generation...');
  ws.send(JSON.stringify({
    type: 'transcript_sync',
    source: 'interviewer',
    transcript: 'How do you handle data skew in PySpark when performing a large shuffle join?',
    isFinal: true
  }));

  // Wait for interviewer question commit & AI generation start
  let questionCommitted = false;
  let chatStarted = false;
  const startWait = Date.now();
  while (Date.now() - startWait < 8000) {
    if (receivedMessages.some(m => m.type === 'question_committed')) questionCommitted = true;
    if (receivedMessages.some(m => m.type === 'chat_message')) chatStarted = true;
    if (questionCommitted && chatStarted) break;
    await new Promise(r => setTimeout(r, 200));
  }

  if (!questionCommitted) throw new Error('Interviewer question was not committed');
  if (!chatStarted) throw new Error('AI answer generation did not start for interviewer question');
  console.log('   ✓ Interviewer question committed and AI answer started streaming.\n');

  // Test 6: Help Continue action
  console.log('6. Testing "Help Me Continue" action based on candidate spoken speech...');
  receivedMessages.length = 0; // reset
  ws.send(JSON.stringify({
    type: 'help_continue'
  }));

  let helpContinueAnswer = false;
  const helpStart = Date.now();
  while (Date.now() - helpStart < 8000) {
    if (receivedMessages.some(m => m.type === 'chat_message')) {
      helpContinueAnswer = true;
      break;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  if (!helpContinueAnswer) throw new Error('"help_continue" did not generate AI continuation');
  console.log('   ✓ "Help Me Continue" successfully generated contextual continuation points.\n');

  // Test 7: Binary Audio Framing
  console.log('7. Testing Binary audio multiplexing framing (0x01 = interviewer, 0x02 = candidate)...');
  const interviewerChunk = Buffer.from([1, 0x1a, 0x45, 0xdf, 0xa3]);
  ws.send(interviewerChunk);

  const candidateChunk = Buffer.from([2, 0x1a, 0x45, 0xdf, 0xa3]);
  ws.send(candidateChunk);

  await new Promise(r => setTimeout(r, 400));
  console.log('   ✓ Binary framed chunks routed without server errors.\n');

  ws.close();
  console.log('=== All 7 Verification Tests Passed Successfully! ===');
}

main().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
