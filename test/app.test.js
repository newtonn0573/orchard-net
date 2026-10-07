const test = require('node:test');
const assert = require('node:assert/strict');
const { app, startServer, stopServer } = require('../server');

let server;

test.before(async () => {
  server = await startServer(0);
});

test.after(async () => {
  await stopServer(server);
});

test('public landing page loads', async () => {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Orchard Net/i);
});

test('user can sign up and log in', async () => {
  const port = server.address().port;
  const username = `user_${Date.now()}`;

  const signupRes = await fetch(`http://127.0.0.1:${port}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      email: `${username}@example.com`,
      password: 'SecurePass123!',
      full_name: 'Test User'
    })
  });

  assert.equal(signupRes.status, 200, 'signup should succeed');
  const signupBody = await signupRes.json();
  assert.ok(signupBody.token);

  const loginRes = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: 'SecurePass123!'
    })
  });

  assert.equal(loginRes.status, 200, 'login should succeed');
  const loginBody = await loginRes.json();
  assert.ok(loginBody.token);
});

test('protected API needs auth', async () => {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/me`);
  assert.equal(res.status, 401);
});
