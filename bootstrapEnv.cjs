/**
 * Bootstrap secrets for standalone: read/write JWT_SECRET and INITIAL_PASSWORD
 * from the app data dir (no .env required). Used by run.js and store-bootstrap.cjs.
 * Same DATA_DIR as the app: %APPDATA%\zippy-mesh (Win), ~/.zippy-mesh (Linux/mac).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_NAME = process.env.ZIPPY_APP_NAME || 'zippy-mesh';
const BOOTSTRAP_FILENAME = 'bootstrap.secret';

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

/**
 * Read bootstrap secrets from data dir. Returns null if missing or invalid.
 */
function getBootstrapSecrets() {
  try {
    const dir = getDataDir();
    const file = path.join(dir, BOOTSTRAP_FILENAME);
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data.JWT_SECRET !== 'string' || data.JWT_SECRET.length < 16) return null;
    return {
      JWT_SECRET: data.JWT_SECRET,
      INITIAL_PASSWORD: typeof data.INITIAL_PASSWORD === 'string' ? data.INITIAL_PASSWORD : '',
      PORT: data.PORT,
    };
  } catch {
    return null;
  }
}

/**
 * Write bootstrap secrets to data dir (mode 0600). Creates dir if needed.
 */
function setBootstrapSecrets(secrets) {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, BOOTSTRAP_FILENAME);
  const data = {
    JWT_SECRET: secrets.JWT_SECRET,
    INITIAL_PASSWORD: secrets.INITIAL_PASSWORD || '',
    PORT: secrets.PORT || 20128,
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 0), { mode: 0o600 });
}

/**
 * If bootstrap.secret exists, set process.env from it. Call before loading server.
 */
function injectBootstrapSync() {
  const b = getBootstrapSecrets();
  if (!b) return;
  process.env.JWT_SECRET = b.JWT_SECRET;
  if (b.INITIAL_PASSWORD !== undefined) process.env.INITIAL_PASSWORD = b.INITIAL_PASSWORD;
  if (b.PORT != null) process.env.PORT = String(b.PORT);
}

module.exports = {
  getDataDir,
  getBootstrapSecrets,
  setBootstrapSecrets,
  injectBootstrapSync,
};
