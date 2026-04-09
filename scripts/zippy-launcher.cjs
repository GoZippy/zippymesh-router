#!/usr/bin/env node
/**
 * zippy-launcher.cjs — Node SEA entry point for the zippy-node sidecar binary.
 *
 * This file is compiled into a Node.js Single Executable Application (SEA).
 * At runtime it reads ZIPPY_STANDALONE_DIR (set by the Tauri Rust host) and
 * loads the Next.js standalone server from that directory.
 *
 * The standalone directory is bundled as a Tauri resource and extracted to:
 *   <app resource dir>/standalone/
 */

'use strict';

const path = require('path');

const standaloneDir = process.env.ZIPPY_STANDALONE_DIR;
if (!standaloneDir) {
  console.error('[zippy-node] ZIPPY_STANDALONE_DIR is not set — cannot locate standalone server');
  process.exit(1);
}

const serverPath = path.join(standaloneDir, 'server.js');

try {
  require(serverPath);
} catch (err) {
  console.error('[zippy-node] Failed to load standalone server from:', serverPath);
  console.error(err);
  process.exit(1);
}
