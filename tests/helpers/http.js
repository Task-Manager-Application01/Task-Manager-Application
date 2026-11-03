'use strict';

const { createServer } = require('../../src/app');
const { generateJWT } = require('../../src/middleware/authMiddleware');

/** Starts the real HTTP server on a random local port. */
async function startServer() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function stopServer(server) {
  server.closeAllConnections();
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  }
}

function bearer(user) {
  return { Authorization: `Bearer ${generateJWT({ userId: user.user_id, email: user.email })}` };
}

/** Sends a JSON request to the running server and returns { status, body }. */
async function api(server, method, path, { body, headers } = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed };
}

/** Lets fire-and-forget work (such as email sending) finish. */
function flush() {
  return new Promise(resolve => setImmediate(resolve));
}

module.exports = { startServer, stopServer, bearer, api, flush };
