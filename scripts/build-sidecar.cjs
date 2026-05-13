#!/usr/bin/env node
/**
 * build-sidecar.cjs — Builds the zippy-node Node SEA sidecar binary.
 *
 * Produces: src-tauri/binaries/zippy-node-x86_64-pc-windows-msvc.exe  (Windows)
 *           src-tauri/binaries/zippy-node-x86_64-unknown-linux-gnu     (Linux)
 *           src-tauri/binaries/zippy-node-x86_64-apple-darwin          (macOS Intel)
 *           src-tauri/binaries/zippy-node-aarch64-apple-darwin         (macOS Apple Silicon)
 *
 * Requires: Node.js 20+ (for --experimental-sea-config), npx postject
 *
 * Usage: node scripts/build-sidecar.cjs
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const binDir = path.join(root, 'src-tauri', 'binaries');
const tmpDir = path.join(root, '.sea-build');

// Determine platform target triple
const platform = os.platform();
const arch = os.arch();

const TRIPLE_MAP = {
  'win32-x64':   'x86_64-pc-windows-msvc',
  'linux-x64':   'x86_64-unknown-linux-gnu',
  'darwin-x64':  'x86_64-apple-darwin',
  'darwin-arm64':'aarch64-apple-darwin',
};
const tripleKey = `${platform}-${arch}`;
const triple = TRIPLE_MAP[tripleKey];
if (!triple) {
  console.error(`[build-sidecar] Unsupported platform: ${tripleKey}`);
  process.exit(1);
}

const exeSuffix = platform === 'win32' ? '.exe' : '';
const outBinary = path.join(binDir, `zippy-node-${triple}${exeSuffix}`);
const launcherSrc = path.join(root, 'scripts', 'zippy-launcher.cjs');
const seaConfig = path.join(tmpDir, 'sea-config.json');
const seaBlob = path.join(tmpDir, 'sea-prep.blob');
const nodeCopy = path.join(tmpDir, `zippy-node-build${exeSuffix}`);

console.log(`[build-sidecar] Target triple: ${triple}`);
console.log(`[build-sidecar] Output:        ${outBinary}`);

// Ensure directories exist
fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync(binDir, { recursive: true });

// Step 1: Write sea-config.json
const config = {
  main: launcherSrc,
  output: seaBlob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: true,
};
fs.writeFileSync(seaConfig, JSON.stringify(config, null, 2));
console.log('[build-sidecar] Step 1: Wrote sea-config.json');

// Step 2: Generate the SEA blob
console.log('[build-sidecar] Step 2: Generating SEA blob...');
execSync(`node --experimental-sea-config "${seaConfig}"`, { stdio: 'inherit', cwd: root });

// Step 3: Copy the current node executable as the base binary
console.log('[build-sidecar] Step 3: Copying node executable...');
fs.copyFileSync(process.execPath, nodeCopy);

// On Windows, remove the signing signature so postject can inject
if (platform === 'win32') {
  const signtoolResult = spawnSync('signtool', ['remove', '/s', nodeCopy], { encoding: 'utf8' });
  if (signtoolResult.status !== 0) {
    // signtool not available or not signed — safe to continue
    console.log('[build-sidecar] signtool not available or binary unsigned, continuing...');
  }
}

// Step 4: Inject the SEA blob into the copied binary using postject
console.log('[build-sidecar] Step 4: Injecting SEA blob with postject...');
const postjectArgs = [
  `"${nodeCopy}"`,
  'NODE_SEA_BLOB',
  `"${seaBlob}"`,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
if (platform === 'darwin') {
  postjectArgs.push('--macho-segment-name', '__NODE_SEA');
}
execSync(`npx --yes postject ${postjectArgs.join(' ')}`, { stdio: 'inherit', cwd: root });

// Step 5: Sign the binary (macOS required, Windows optional)
if (platform === 'darwin') {
  console.log('[build-sidecar] Step 5: Code-signing for macOS...');
  execSync(`codesign --sign - "${nodeCopy}"`, { stdio: 'inherit' });
}

// Step 6: Move to final output location
console.log('[build-sidecar] Step 6: Moving binary to output location...');
fs.copyFileSync(nodeCopy, outBinary);
if (platform !== 'win32') {
  fs.chmodSync(outBinary, 0o755);
}

// Cleanup temp dir
fs.rmSync(tmpDir, { recursive: true, force: true });

const sizeMB = (fs.statSync(outBinary).size / 1024 / 1024).toFixed(1);
console.log(`\n[build-sidecar] Done! zippy-node-${triple}${exeSuffix} (${sizeMB} MB)`);
