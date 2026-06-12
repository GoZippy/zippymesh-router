#!/usr/bin/env node
/**
 * One-time setup: prompt for dashboard password and store in bootstrap.secret
 * (no .env needed). Run once after unzip, then start with: node run.js
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
  console.log('Zippy Mesh — one-time setup (no .env required)\n');

  const password = await question(rl, 'Choose a dashboard password: ');
  if (!password || password.length < 6) {
    console.error('Password must be at least 6 characters.');
    rl.close();
    process.exit(1);
  }

  const portStr = await question(rl, 'Port (default 20128): ');
  const port = portStr.trim() ? parseInt(portStr, 10) : 20128;

  rl.close();

  const JWT_SECRET = crypto.randomBytes(32).toString('hex');
  setBootstrapSecrets({ JWT_SECRET, INITIAL_PASSWORD: password, PORT: port });
  console.log('\nDone. Secrets stored in:', getDataDir());
  console.log('Start the server with: node run.js');
  console.log('Then open http://localhost:' + port + '/dashboard and log in with your password.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
