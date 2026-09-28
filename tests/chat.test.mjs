import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { spawnSync } from 'child_process';

const originalFetch = global.fetch;
let mockResponses = [];

global.fetch = async (url, options) => {
  const mock = mockResponses.shift();
  if (mock) {
    if (mock.error) throw mock.error;
    if (mock.delay) await new Promise(r => setTimeout(r, mock.delay));
    return {
      ok: mock.status >= 200 && mock.status < 300,
      status: mock.status,
      json: async () => mock.json,
      text: async () => JSON.stringify(mock.json)
    };
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
};

const startServer = async () => {
  const { default: app } = await import('../artifacts/api-server/dist/app.js');
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      resolve({
        port: server.address().port,
        close: () => new Promise(r => server.close(r))
      });
    });
  });
};

test('Backend Fallback and Edge Cases', async (t) => {
  spawnSync('npx', ['tsc', '-p', 'artifacts/api-server/tsconfig.json']);

  process.env.SAMBANOVA_API_KEY = 'mock-samba';
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY = 'mock-gemini';
  process.env.SAMBANOVA_MODELS = 'Samba-A,Samba-B';
  process.env.GEMINI_MODELS = 'Gem-A,Gem-B';

  const { port, close } = await startServer();
  const chatUrl = 'http://localhost:' + port + '/api/chat';

  const runChat = async (message, isPrime = true) => {
    const res = await originalFetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, isPrime })
    });
    return { status: res.status, json: await res.json() };
  };

  await t.test('1. "hi" (Simple completion)', async () => {
    mockResponses = [{ status: 200, json: { choices: [{ message: { content: "hello" } }] } }];
    const { status, json } = await runChat("hi");
    assert.strictEqual(status, 200);
    assert.strictEqual(json.reply, "hello");
  });

  await t.test('2. Gujarati topic question', async () => {
    mockResponses = [{ status: 200, json: { choices: [{ message: { content: "ગુજરાતનું પાટનગર ગાંધીનગર છે." } }] } }];
    const { status, json } = await runChat("ગુજરાતનું પાટનગર કયું છે?");
    assert.strictEqual(status, 200);
    assert.strictEqual(json.reply, "ગુજરાતનું પાટનગર ગાંધીનગર છે.");
  });

  await t.test('3. Message > 1000 chars (truncated)', async () => {
    mockResponses = [{ status: 200, json: { choices: [{ message: { content: "truncated" } }] } }];
    const longMsg = "A".repeat(1500);
    const { status, json } = await runChat(longMsg);
    assert.strictEqual(status, 200);
    assert.strictEqual(json.reply, "truncated");
  });

  await t.test('4. URL message', async () => {
    mockResponses = [{ status: 200, json: { choices: [{ message: { content: "URL seen" } }] } }];
    const { status, json } = await runChat("Check this https://google.com");
    assert.strictEqual(status, 200);
    assert.strictEqual(json.reply, "URL seen");
  });

  await t.test('5. 429, 404, 500, list fallthrough to success', async () => {
    mockResponses = [
      { status: 429, json: {} }, // Samba-A
      { status: 404, json: {} }, // Samba-B
      { status: 500, json: {} }, // Gem-A
      { status: 200, json: { candidates: [{ content: { parts: [{ text: "Gem-B success" }] } }] } } // Gem-B
    ];
    const { status, json } = await runChat("hi");
    assert.strictEqual(status, 200);
    assert.strictEqual(json.reply, "Gem-B success");
  });

  await t.test('6. Timeout worst-case', async () => {
    const err = new Error('TimeoutError'); err.name = 'TimeoutError';
    mockResponses = [{ error: err }, { error: err }, { error: err }, { error: err }];
    const start = Date.now();
    const { status, json } = await runChat("hi");
    const duration = Date.now() - start;
    assert.strictEqual(status, 502);
    assert.ok(json.reply.includes("AI service unavailable"));
  });

  await t.test('7. Both providers down', async () => {
    mockResponses = [{ status: 500, json: {} }, { status: 502, json: {} }, { status: 503, json: {} }, { status: 500, json: {} }];
    const { status } = await runChat("hi");
    assert.strictEqual(status, 502);
  });

  await t.test('8. Non-Prime blocked (backend)', async () => {
    const { status } = await runChat("hi", false);
    assert.strictEqual(status, 403);
  });

  await close();
});
