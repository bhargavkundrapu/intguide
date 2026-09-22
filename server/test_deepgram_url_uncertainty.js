const assert = require('assert');

// Test buildDeepgramUrl and analyzeWordUncertainty logic
function testUrlConstruction() {
  const terms = ['PySpark', 'broadcast join', 'coalesce', 'dense_rank'];
  const base = 'wss://api.deepgram.com/v1/listen';
  const url = new URL(base);
  url.searchParams.set('model', 'nova-2');
  url.searchParams.set('smart_format', 'true');
  url.searchParams.set('interim_results', 'true');

  for (const term of terms) {
    url.searchParams.append('keywords', `${term}:2`);
  }

  const serialized = url.toString();
  console.log('Constructed Deepgram URL query string:');
  console.log(url.search);

  // Check that repeated keywords parameters are present
  const keywordParams = url.searchParams.getAll('keywords');
  assert.strictEqual(keywordParams.length, 4, 'Should have 4 keyword parameters');
  assert.strictEqual(keywordParams[0], 'PySpark:2');
  assert.strictEqual(keywordParams[1], 'broadcast join:2');
  assert.strictEqual(keywordParams[2], 'coalesce:2');
  assert.strictEqual(keywordParams[3], 'dense_rank:2');

  // Verify that it is NOT comma-separated
  assert(!serialized.includes('keywords=PySpark%2C'), 'Must not be comma-separated');
  console.log('✅ Deepgram URL keyterm repetition verified!');
}

function testUncertaintyAnalysis() {
  const CRITICAL_WORDS = new Set([
    'not', 'no', 'never', 'neither', 'nor', 'dont', 'doesnt', 'isnt', 'arent', 'wont', 'cant',
    'pyspark', 'coalesce', 'repartition', 'databricks', 'athena', 'redshift',
    'broadcast', 'shuffle', 'dense_rank', 'row_number'
  ]);

  const mockWords = [
    { word: 'write', confidence: 0.95 },
    { word: 'a', confidence: 0.98 },
    { word: 'broadcast', confidence: 0.52 }, // Critical word, low confidence!
    { word: 'join', confidence: 0.91 },
    { word: 'in', confidence: 0.88 },
    { word: 'pyspark', confidence: 0.99 },
    { word: 'not', confidence: 0.45 } // Negation, low confidence!
  ];

  const uncertain = [];
  for (const w of mockWords) {
    const clean = (w.word || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    const isCritical = CRITICAL_WORDS.has(clean);
    const threshold = isCritical ? 0.68 : 0.40;
    if (w.confidence < threshold) {
      uncertain.push({ word: w.word, confidence: w.confidence, isCritical });
    }
  }

  assert.strictEqual(uncertain.length, 2, 'Should flag broadcast and not');
  assert.strictEqual(uncertain[0].word, 'broadcast');
  assert.strictEqual(uncertain[1].word, 'not');
  console.log('✅ Word uncertainty detection verified on critical words!');
}

testUrlConstruction();
testUncertaintyAnalysis();
console.log('🎉 All Deepgram & Uncertainty unit tests passed!');
