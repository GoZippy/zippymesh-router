/**
 * Entry point for standalone: load bootstrap secrets (no .env) then start server.
 * Copy to standalone root as run.js. User runs: node run.js
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

require('./bootstrapEnv.cjs').injectBootstrapSync();
await import('./server.js');
