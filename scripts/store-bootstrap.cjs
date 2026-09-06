#!/usr/bin/env node
/**
 * One-time bootstrap: generate JWT_SECRET and store it in the user data dir
 * (no .env required). Run once after unzip, then start with: node run.js
 *
 * Passwords are no longer set here — the setup wizard at /setup handles that
 * and stores a bcrypt hash in the user data directory (db.json).
 */
const crypto = require('crypto');
const readline = require('readline');
const { getDataDir, setBootstrapSecrets, getBootstrapSecrets } = require('./bootstrapEnv.cjs');

function question(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer || ''));
  });
}

async function main() {
  const existing = getBootstrapSecrets();
  if (existing) {
    console.log('Bootstrap already set. Data dir:', getDataDir());
    console.log('To reset, delete the bootstrap.secret file in that folder and run this again.');
    process.exit(0);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('ZippyMesh LLM Router — one-time bootstrap (no .env required)\n');

  const portStr = await question(rl, 'Port (default 20128): ');
  const port = portStr.trim() ? parseInt(portStr, 10) : 20128;

  rl.close();

  const JWT_SECRET = crypto.randomBytes(32).toString('hex');
  setBootstrapSecrets({ JWT_SECRET, PORT: port });
  console.log('\nDone. Secrets stored in:', getDataDir());
  console.log('Start the server with: node run.js');
  console.log('Then open http://localhost:' + port + ' — the setup wizard will guide you through creating your password.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
