/**
 * stdout is the MCP protocol channel. Nothing but framed JSON-RPC may reach it.
 *
 * `src/mcp/zmlr-server.js` logs through `console.log` in `hooks.onInit`,
 * `beforeToolCall` and `afterToolCall`, and any transitive dependency
 * (`localDb.js`, provider code, a third-party package) may do the same. A
 * single stray line corrupts the stream and the client drops the connection
 * with a parse error that points nowhere near the cause.
 *
 * So before the application graph is imported we capture the real
 * `process.stdout.write` and replace it with one that forwards to stderr.
 * `writeMessage()` is then the ONLY path back to the real stdout.
 */

/** The genuine `process.stdout.write`, captured before redirection. */
let realWrite = null;

/** True once `protectStdout()` has run. */
let installed = false;

/**
 * Redirect every ordinary stdout write to stderr and reserve the real stdout
 * for `writeMessage()`. Idempotent.
 */
export function protectStdout() {
  if (installed) return;
  installed = true;

  realWrite = process.stdout.write.bind(process.stdout);
  const toStderr = process.stderr.write.bind(process.stderr);

  process.stdout.write = function guardedStdoutWrite(chunk, encoding, callback) {
    return toStderr(chunk, encoding, callback);
  };

  // console.log/info/debug/dir are bound to the stream at construction time in
  // some Node builds, so patching the stream alone is not always enough.
  // Rebind them explicitly onto stderr.
  const toErr = console.error.bind(console);
  console.log = toErr;
  console.info = toErr;
  console.debug = toErr;
  console.dir = (obj) => toErr(obj);
}

/**
 * Write one newline-delimited JSON message to the real stdout.
 *
 * One `write()` call per message: Node streams preserve write order and never
 * interleave a single chunk, so concurrent in-flight requests can each call
 * this without a lock and every line lands whole.
 *
 * @param {object} message — a JSON-RPC response or notification
 */
export function writeMessage(message) {
  const line = JSON.stringify(message) + "\n";
  if (realWrite) realWrite(line);
  else process.stdout.write(line);
}

/** Test seam: has the guard been installed in this process? */
export function isStdoutProtected() {
  return installed;
}
