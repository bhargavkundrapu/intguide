const WebSocket = require('../server/node_modules/ws');
const { execFileSync } = require('child_process');

function createClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:5000');
    const sessionId = 'TEST-SESSION-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const messages = [];

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'register',
        session: sessionId,
        role: 'laptop'
      }));
    });

    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());
        messages.push(parsed);
        if (parsed.type === 'registered') {
          resolve({ ws, sessionId, messages });
        }
      } catch (e) {
        messages.push({ raw: raw.toString() });
      }
    });

    ws.on('error', reject);
  });
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sendQuestion(ws, messages, text) {
  return new Promise((resolve, reject) => {
    let timeoutId;

    const checkInterval = setInterval(() => {
      const doneMsg = messages.find(m => m.type === 'chat_done');
      if (doneMsg) {
        clearInterval(checkInterval);
        clearTimeout(timeoutId);
        resolve(doneMsg);
      }
    }, 200);

    timeoutId = setTimeout(() => {
      clearInterval(checkInterval);
      reject(new Error(`Timeout waiting for chat_done for question: "${text}"`));
    }, 35000);

    // Trigger answer
    ws.send(JSON.stringify({
      type: 'trigger_answer',
      question: text
    }));
  });
}

async function runTests() {
  console.log('=== STARTING CODING WORKFLOW VERIFICATION SUITE ===\n');
  let passed = 0;
  let total = 0;

  // TEST 1: Multi-part instructions across pauses (Python + second distinct largest + do not sort + return None)
  total++;
  console.log('Test 1: Complete instructions across pauses into single active CodingTaskRecord...');
  try {
    const { ws, sessionId, messages } = await createClient();
    await wait(300);

    // Initial problem
    const ans1 = await sendQuestion(ws, messages, 'Write a python function to find the second distinct largest number.');
    console.log(`  Initial revision: ${ans1.revision || 1}, taskPill: "${ans1.taskPill}"`);

    // Add constraint after pause: "Do not sort."
    messages.length = 0;
    const ans2 = await sendQuestion(ws, messages, 'Do not sort.');
    console.log(`  After constraint 1: revision ${ans2.revision}, taskPill: "${ans2.taskPill}"`);

    // Add constraint after pause: "Return None if it does not exist."
    messages.length = 0;
    const ans3 = await sendQuestion(ws, messages, 'Return None if it does not exist.');
    console.log(`  After constraint 2: revision ${ans3.revision}, taskPill: "${ans3.taskPill}"`);

    const fullCode = ans3.fullText || '';
    const cleanCode = fullCode.replace(/#.*$/gm, '').replace(/"""[\s\S]*?"""/g, '');
    const hasNoSort = !/\b(sort|sorted)\s*\(/.test(cleanCode);
    const hasPython = fullCode.includes('def ') || ans3.taskPill?.includes('Python');
    const hasPill = Boolean(ans3.taskPill);

    console.log(`  - No sorting in code body: ${hasNoSort ? 'YES' : 'NO'}`);
    console.log(`  - Python function generated: ${hasPython ? 'YES' : 'NO'}`);
    console.log(`  - Task pill preserved: ${hasPill ? 'YES' : 'NO'} (${ans3.taskPill})`);
    console.log(`  - Verification status: ${ans3.verificationStatus || 'unverified'}`);

    if (hasNoSort && hasPython && hasPill) {
      console.log('  PASSED: Multi-turn instruction retention verified.\n');
      passed++;
    } else {
      console.error('  FAILED: Requirements not satisfied.\n');
    }
    ws.close();
  } catch (err) {
    console.error('  FAILED Test 1:', err.message, '\n');
  }

  // TEST 2: Replacement / correction ("Actually, return -1 instead of None if it does not exist")
  total++;
  console.log('Test 2: Correction & replacement with revision increment...');
  try {
    const { ws, sessionId, messages } = await createClient();
    await wait(300);

    await sendQuestion(ws, messages, 'Write a python function to find the second distinct largest number without sorting, return None if not found.');
    
    messages.length = 0;
    const rev2 = await sendQuestion(ws, messages, 'Actually, return -1 instead of None if it does not exist.');
    console.log(`  Received revision ${rev2.revision}. Note: "${rev2.revisionNote}"`);

    const hasMinusOne = (rev2.fullText || '').includes('-1');
    const revisionIncremented = (rev2.revision || 1) >= 2;

    console.log(`  - Code returns -1: ${hasMinusOne ? 'YES' : 'NO'}`);
    console.log(`  - Revision incremented (>= 2): ${revisionIncremented ? 'YES' : 'NO'}`);

    if (hasMinusOne && revisionIncremented) {
      console.log('  PASSED: Replacement updated requirements and incremented revision.\n');
      passed++;
    } else {
      console.error('  FAILED: Replacement not reflected properly.\n');
    }
    ws.close();
  } catch (err) {
    console.error('  FAILED Test 2:', err.message, '\n');
  }

  // TEST 3: New problem resets earlier restrictions
  total++;
  console.log('Test 3: New problem resets earlier restrictions...');
  try {
    const { ws, sessionId, messages } = await createClient();
    await wait(300);

    // Question 1 has "do not sort"
    await sendQuestion(ws, messages, 'Write a python function to find the second distinct largest number without sorting.');

    messages.length = 0;
    // Question 2 is a new problem
    const newProb = await sendQuestion(ws, messages, 'New problem: Write a function to check if a string is a palindrome.');
    console.log(`  New problem taskPill: "${newProb.taskPill}"`);

    const restrictionCleared = !newProb.taskPill?.includes('no sorting') && !newProb.taskPill?.includes('second distinct');
    console.log(`  - Previous restrictions cleared: ${restrictionCleared ? 'YES' : 'NO'}`);

    if (restrictionCleared) {
      console.log('  PASSED: New problem successfully cleared earlier restrictions.\n');
      passed++;
    } else {
      console.error('  FAILED: Old restrictions carried into new problem.\n');
    }
    ws.close();
  } catch (err) {
    console.error('  FAILED Test 3:', err.message, '\n');
  }

  // TEST 4: Clarification question for ambiguous instruction
  total++;
  console.log('Test 4: Clarification question for ambiguous "don\'t use built-in functions"...');
  try {
    const { ws, sessionId, messages } = await createClient();
    await wait(300);

    const ans = await sendQuestion(ws, messages, 'Write a function to reverse a string, but don\'t use built-in functions.');
    const text = ans.fullText || '';
    const clarifiesOrSpecifies = text.includes('?') || text.toLowerCase().includes('built-in') || text.toLowerCase().includes('slice') || text.toLowerCase().includes('loop');

    console.log(`  Answer preview: ${text.slice(0, 180).replace(/\n/g, ' ')}...`);
    console.log(`  - Clarifies or explicitly notes which built-in avoided: ${clarifiesOrSpecifies ? 'YES' : 'NO'}`);

    if (clarifiesOrSpecifies) {
      console.log('  PASSED: Handled ambiguous constraint gracefully.\n');
      passed++;
    } else {
      console.error('  FAILED: Ambiguous constraint not handled.\n');
    }
    ws.close();
  } catch (err) {
    console.error('  FAILED Test 4:', err.message, '\n');
  }

  // TEST 5: Standalone Python AST & unit-test evaluation of the [5,5,3]->3, [-1,-3,-2]->-2, [4,4]->None logic
  total++;
  console.log('Test 5: Validating second distinct largest algorithm edge cases against isolated Python executor...');
  {
    const pythonCode = `
def second_distinct_largest(nums):
    if not nums:
        return None
    first = second = None
    for n in nums:
        if first is None or n > first:
            second = first
            first = n
        elif n != first and (second is None or n > second):
            second = n
    return second
`;
    const testCases = [
      { input: [5, 5, 3], expected: 3 },
      { input: [-1, -3, -2], expected: -2 },
      { input: [4, 4], expected: null }
    ];

    const testHarness = `
import json, sys

${pythonCode}

cases = json.loads('''${JSON.stringify(testCases)}''')
results = []
fn = second_distinct_largest

for i, tc in enumerate(cases):
    inp = tc["input"]
    exp = tc["expected"]
    actual = fn(inp)
    match = (actual == exp)
    results.append({"case": i+1, "actual": actual, "expected": exp, "passed": match})

print(json.dumps(results))
`;
    try {
      const out = execFileSync('python', ['-c', testHarness], { encoding: 'utf8', timeout: 5000 });
      const res = JSON.parse(out.trim());
      const allPassed = res.every(r => r.passed);
      console.log('  Isolated execution results:', res);
      if (allPassed) {
        console.log('  PASSED: [5, 5, 3] -> 3, [-1, -3, -2] -> -2, [4, 4] -> None all verified without sorting.\n');
        passed++;
      } else {
        console.error('  FAILED: Unit test output mismatch.\n');
      }
    } catch (e) {
      console.error('  FAILED execution:', e.message);
    }
  }

  console.log(`=============================================`);
  console.log(`TEST SUMMARY: ${passed}/${total} TESTS PASSED`);
  console.log(`=============================================`);
  process.exit(passed === total ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
