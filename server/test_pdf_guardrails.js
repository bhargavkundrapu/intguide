const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 Starting Verification Tests for PDF Q&A and AI Guardrails...\n');

const PORT = 5005;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const streamText = `BT
/F1 12 Tf
50 700 Td
(Q1: What is a broadcast join in PySpark?) Tj
0 -30 Td
(A1: A broadcast join copies the smaller DataFrame to all worker nodes to avoid network shuffle overhead.) Tj
0 -40 Td
(Q2: How do you handle data skew with salting?) Tj
0 -30 Td
(A2: Salting appends a random integer key between 0 and N to distribute heavily skewed partitions evenly across executors.) Tj
ET`;

const streamLen = Buffer.byteLength(streamText);

const samplePdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>
endobj
4 0 obj
<< /Length ${streamLen} >>
stream
${streamText}
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000302 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
750
%%EOF`;

const pdfBuffer = Buffer.from(samplePdfContent);
const pdfBase64 = pdfBuffer.toString('base64');

let serverProcess = null;

async function startServer() {
  serverProcess = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit'
  });

  // Poll until server responds on port
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${PORT}/api/info`, res => {
          if (res.statusCode === 200) resolve();
          else reject(new Error('Status ' + res.statusCode));
        });
        req.on('error', reject);
      });
      return;
    } catch (e) {
      // keep polling
    }
  }
  throw new Error('Server did not start in time on port ' + PORT);
}

async function runTests() {
  console.log('🚀 Spawning test server on port ' + PORT + '...');
  await startServer();
  await new Promise(r => setTimeout(r, 1000));

  // ── Test 1: Upload PDF via /api/context/upload-pdf ──
  console.log('▶ Test 1: Testing /api/context/upload-pdf');
  const uploadPayload = JSON.stringify({
    fileName: 'Senior_PySpark_Interview_QA.pdf',
    fileBase64: pdfBase64
  });

  const uploadRes = await new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}/api/context/upload-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(uploadPayload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(uploadPayload);
    req.end();
  });

  console.log('  Upload response:', { fileName: uploadRes.fileName, qaCount: uploadRes.qaCount, success: uploadRes.success });
  assert(uploadRes.success, 'Upload should succeed');
  assert(uploadRes.qaCount >= 2, `Expected at least 2 Q&A pairs, got ${uploadRes.qaCount}`);
  assert.strictEqual(uploadRes.fileName, 'Senior_PySpark_Interview_QA.pdf');
  console.log(`  ✅ Successfully parsed PDF: ${uploadRes.qaCount} Q&A pairs extracted!`);

  // ── Test 2: Verify /api/context reflects PDF knowledge and AI Guardrails ──
  console.log('\n▶ Test 2: Testing /api/context reflection');
  const contextPayload = JSON.stringify({
    guardrails: 'Answer in 3 bullet points. Emphasize memory efficiency and latency. Never invent metrics.'
  });

  await new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}/api/context`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(contextPayload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(contextPayload);
    req.end();
  });

  const getCtx = await new Promise((resolve, reject) => {
    http.get(`${BASE_URL}/api/context`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  assert(getCtx.guardrails.includes('Answer in 3 bullet points'), 'Guardrails should be saved');
  assert(getCtx.pdfKnowledge.fileName === 'Senior_PySpark_Interview_QA.pdf', 'PDF file name should be saved in context');
  assert(getCtx.pdfKnowledge.qaCount >= 2, 'PDF qaCount should be in context');
  console.log('  ✅ Context contains active PDF knowledge & updated AI Guardrails!');

  // ── Test 3: Ask a question IN THE PDF via WebSocket ──
  console.log('\n▶ Test 3: Testing question COVERED IN THE PDF');
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const sessionId = 'TEST-SESSION-PDF-' + Date.now();
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

  console.log('  Asking question in PDF: "Can you explain broadcast joins in PySpark?"');
  ws.send(JSON.stringify({
    type: 'trigger_answer',
    question: 'Can you explain broadcast joins in PySpark?'
  }));

  // Wait for answer completion
  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (receivedMessages.some(m => m.type === 'chat_done')) {
        clearInterval(check);
        resolve();
      }
    }, 200);
    setTimeout(() => { clearInterval(check); resolve(); }, 8000);
  });

  const doneMsgInPdf = receivedMessages.find(m => m.type === 'chat_done');
  assert(doneMsgInPdf, 'Expected chat_done event');
  console.log('  Source tag on answer:', doneMsgInPdf.source);
  console.log('  Matched PDF question:', doneMsgInPdf.matchedPdfQuestion);
  console.log('  Answer text:', doneMsgInPdf.fullText.slice(0, 160) + '...');
  assert.strictEqual(doneMsgInPdf.source, 'pdf', 'Question in PDF should have source: "pdf"');
  assert(doneMsgInPdf.matchedPdfQuestion.toLowerCase().includes('broadcast join'), 'Matched question should be broadcast join');
  console.log('  ✅ Question in PDF answered according to PDF ground truth with source: "pdf"!');

  // ── Test 4: Ask a question OUT OF THE PDF via WebSocket ──
  console.log('\n▶ Test 4: Testing question OUT OF THE PDF');
  const receivedMessages2 = [];
  ws.on('message', data => {
    try {
      const msg = JSON.parse(data.toString());
      receivedMessages2.push(msg);
    } catch (e) {}
  });

  console.log('  Asking question OUT of PDF: "How does React Virtual DOM diffing work?"');
  ws.send(JSON.stringify({
    type: 'trigger_answer',
    question: 'How does React Virtual DOM diffing work?'
  }));

  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (receivedMessages2.some(m => m.type === 'chat_done')) {
        clearInterval(check);
        resolve();
      }
    }, 200);
    setTimeout(() => { clearInterval(check); resolve(); }, 8000);
  });

  const doneMsgOutOfPdf = receivedMessages2.find(m => m.type === 'chat_done');
  assert(doneMsgOutOfPdf, 'Expected chat_done event for out of pdf question');
  console.log('  Source tag on answer:', doneMsgOutOfPdf.source);
  console.log('  Answer text:', doneMsgOutOfPdf.fullText.slice(0, 160) + '...');
  assert.strictEqual(doneMsgOutOfPdf.source, 'generated', 'Question out of PDF should have source: "generated"');
  console.log('  ✅ Question out of PDF generated anew with source: "generated" according to AI Guardrails!');

  // ── Test 5: Clear PDF via /api/context/clear-pdf ──
  console.log('\n▶ Test 5: Testing /api/context/clear-pdf');
  const clearRes = await new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}/api/context/clear-pdf`, { method: 'POST' }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
  assert(clearRes.success, 'Clear PDF should succeed');
  console.log('  ✅ PDF cleared successfully.');

  ws.close();
  console.log('\n🎉 ALL PDF & AI GUARDRAILS TESTS PASSED PERFECTLY!\n');
}

runTests()
  .then(() => {
    if (serverProcess) serverProcess.kill();
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Test failed:', err);
    if (serverProcess) serverProcess.kill();
    process.exit(1);
  });
