// Registry for translators - separate module to avoid circular dependency
export const requestRegistry = new Map();
export const responseRegistry = new Map();

// Register translator
export function register(from, to, requestFn, responseFn) {
  const key = `${from}:${to}`;
  if (requestFn) {
    requestRegistry.set(key, requestFn);
  }
  if (responseFn) {
    responseRegistry.set(key, responseFn);
  }
}
