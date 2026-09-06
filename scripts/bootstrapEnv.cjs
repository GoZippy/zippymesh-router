/**
 * Bootstrap secrets for standalone: read/write JWT_SECRET and INITIAL_PASSWORD
 * from the app data dir (no .env required). Used by run.js and store-bootstrap.cjs.
 * Same DATA_DIR as the app: %APPDATA%\zippy-mesh (Win), ~/.zippy-mesh (Linux/mac).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

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
  // Preserve keys this call does not own (API_KEY_SECRET is provisioned by
  // ensureApiKeySecret and must survive a re-run of store-bootstrap.cjs —
  // rotating it would invalidate every issued router API key).
  const existing = readBootstrapRaw() || {};
  const data = {
    ...existing,
    JWT_SECRET: secrets.JWT_SECRET,
    INITIAL_PASSWORD: secrets.INITIAL_PASSWORD || '',
    PORT: secrets.PORT || 20128,
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 0), { mode: 0o600 });
}

/** The raw bootstrap.secret JSON, or null. No validation — for merges. */
function readBootstrapRaw() {
  try {
    const file = path.join(getDataDir(), BOOTSTRAP_FILENAME);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/**
 * Guarantee a PERSISTENT API_KEY_SECRET for this install.
 *
 * src/shared/utils/apiKey.js and src/lib/auth/edgeApiKey.js HMAC every router
 * API key with API_KEY_SECRET; when it is unset they fall back to a random
 * per-process value, so every key an operator issued stops verifying on the
 * next restart (install audit 2026-08-30, finding #22). The .env.example ships
 * the line empty, so a fresh install would hit exactly that.
 *
 * Precedence: an explicit process.env.API_KEY_SECRET (from .env or the
 * service manager) always wins and is never written anywhere. Otherwise the
 * value in <data dir>/bootstrap.secret is used, generated once if missing.
 * Safe to call on every start; idempotent.
 *
 * @returns {string} the secret now in process.env.API_KEY_SECRET
 */
function ensureApiKeySecret() {
  const fromEnv = process.env.API_KEY_SECRET;
  if (typeof fromEnv === 'string' && fromEnv.trim().length >= 16) return fromEnv;

  const dir = getDataDir();
  const file = path.join(dir, BOOTSTRAP_FILENAME);
  const data = readBootstrapRaw() || {};
  if (typeof data.API_KEY_SECRET !== 'string' || data.API_KEY_SECRET.length < 16) {
    data.API_KEY_SECRET = crypto.randomBytes(32).toString('hex');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 0), { mode: 0o600 });
  }
  process.env.API_KEY_SECRET = data.API_KEY_SECRET;
  return data.API_KEY_SECRET;
}

/**
 * Guarantee a PERSISTENT JWT_SECRET for this install.
 *
 * src/middleware.js, api/auth/login/route.js and api/shutdown/route.js all
 * THROW at module load when JWT_SECRET is unset, so a fresh release zip that
 * skips the interactive scripts/store-bootstrap.cjs does not boot at all — it
 * answers 500 with "FATAL: JWT_SECRET environment variable is not set"
 * (adversarial review 2026-08-30, item 8). scripts/ is not in the release zip,
 * so setup-env.mjs cannot cover that path either.
 *
 * Precedence, matching ensureApiKeySecret(): an explicit process.env.JWT_SECRET
 * (from .env or the service manager) always wins and is never written
 * anywhere. Otherwise the value in <data dir>/bootstrap.secret is used,
 * generated once if missing. Safe to call on every start; idempotent.
 *
 * The minimum length is 32 because api/auth/login/route.js rejects anything
 * shorter; a generated value is 64 hex characters.
 *
 * @returns {string} the secret now in process.env.JWT_SECRET
 */
function ensureJwtSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (typeof fromEnv === 'string' && fromEnv.trim().length >= 32) return fromEnv;

  const dir = getDataDir();
  const file = path.join(dir, BOOTSTRAP_FILENAME);
  const data = readBootstrapRaw() || {};
  if (typeof data.JWT_SECRET !== 'string' || data.JWT_SECRET.length < 32) {
    data.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 0), { mode: 0o600 });
    console.warn(
      '[ZippyMesh] Generated a JWT_SECRET for this install and stored it in ' +
        file +
        '. Sessions signed with it survive restarts. If you run more than one ' +
        'instance behind a load balancer, set JWT_SECRET explicitly to the SAME ' +
        'value on every instance instead — otherwise each one mints its own and ' +
        'sessions will appear to expire at random.'
    );
  }
  process.env.JWT_SECRET = data.JWT_SECRET;
  return data.JWT_SECRET;
}

/**
 * If bootstrap.secret exists, set process.env from it. Call before loading server.
 * Always ensures API_KEY_SECRET and JWT_SECRET, even when there is no
 * bootstrap.secret yet.
 */
function injectBootstrapSync() {
  const b = getBootstrapSecrets();
  if (b) {
    process.env.JWT_SECRET = b.JWT_SECRET;
    if (b.INITIAL_PASSWORD !== undefined) process.env.INITIAL_PASSWORD = b.INITIAL_PASSWORD;
    if (b.PORT != null) process.env.PORT = String(b.PORT);
  }
  ensureApiKeySecret();
  ensureJwtSecret();
}

module.exports = {
  getDataDir,
  getBootstrapSecrets,
  setBootstrapSecrets,
  ensureApiKeySecret,
  ensureJwtSecret,
  injectBootstrapSync,
};
