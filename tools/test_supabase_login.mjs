const SUPABASE_URL = 'https://kbcuolhjjnmhjaarxxmu.supabase.co';
const ANON_KEY = 'sb_publishable_jccnbflVydTNLaf2hxGbtw_1rMbIh49';

async function testCandidate(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (res.ok && data.access_token) {
    console.log(`SUCCESS: ${email} -> Logged in!`);
    return true;
  } else {
    console.log(`FAIL: ${email} -> ${data.error_description || data.msg || JSON.stringify(data)}`);
    return false;
  }
}

async function trySignup(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  console.log(`SIGNUP: ${email} ->`, data);
}

async function main() {
  await testCandidate('testci@habitapp.dev', 'TestHabit123!');
  await testCandidate('testci@gmail.com', 'TestHabit123!');
  await testCandidate('testci@supatest.com', 'TestHabit123!');
  await testCandidate('demo@aderyth.app', 'TestHabit123!');
  await trySignup(`dev_${Date.now()}@aderyth.app`, 'TestHabit123!');
}

main();
