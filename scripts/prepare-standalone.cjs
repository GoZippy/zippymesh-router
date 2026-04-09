#!/usr/bin/env node
/**
 * Prepare standalone deployable: copy static + public into .next/standalone.
 * Also creates data folder symlink to user data directory for persistence.
 * Run after: npm run build:next
 * Then run: node .next/standalone/server.js (with PORT=20128)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const distDir = process.env.ZIPPY_NEXT_DIST_DIR || '.next';
const standalone = path.join(root, distDir, 'standalone');
const staticDir = path.join(root, distDir, 'static');
const publicDir = path.join(root, 'public');
const standaloneNext = path.join(standalone, '.next');

if (!fs.existsSync(standalone)) {
  console.error(`Missing ${distDir}/standalone — run npm run build:next first.`);
  process.exit(1);
}

if (fs.existsSync(staticDir)) {
  const dest = path.join(standaloneNext, 'static');
  fs.mkdirSync(standaloneNext, { recursive: true });
  copyRecursive(staticDir, dest);
  console.log(`Copied ${distDir}/static -> ${distDir}/standalone/.next/static`);
}

if (fs.existsSync(publicDir)) {
  const dest = path.join(standalone, 'public');
  copyRecursive(publicDir, dest);
  console.log(`Copied public -> ${distDir}/standalone/public`);
}

// Install and run guide + env template for prebuilt zip
const standaloneReadme = path.join(root, 'docs', 'STANDALONE_README.md');
const envExample = path.join(root, '.env.example');
if (fs.existsSync(standaloneReadme)) {
  fs.copyFileSync(standaloneReadme, path.join(standalone, 'README.md'));
  console.log(`Copied docs/STANDALONE_README.md -> ${distDir}/standalone/README.md`);
}
if (fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, path.join(standalone, '.env.example'));
  console.log(`Copied .env.example -> ${distDir}/standalone/.env.example`);
}

// Bootstrap (no .env): run.js + bootstrapEnv.cjs + store-bootstrap.cjs
const bootstrapEnv = path.join(root, 'scripts', 'bootstrapEnv.cjs');
const runWithBootstrap = path.join(root, 'scripts', 'run-with-bootstrap.js');
const storeBootstrap = path.join(root, 'scripts', 'store-bootstrap.cjs');
if (fs.existsSync(bootstrapEnv)) {
  fs.copyFileSync(bootstrapEnv, path.join(standalone, 'bootstrapEnv.cjs'));
  console.log(`Copied scripts/bootstrapEnv.cjs -> standalone`);
}
if (fs.existsSync(runWithBootstrap)) {
  fs.copyFileSync(runWithBootstrap, path.join(standalone, 'run.js'));
  console.log(`Copied scripts/run-with-bootstrap.js -> standalone/run.js`);
}
if (fs.existsSync(storeBootstrap)) {
  fs.copyFileSync(storeBootstrap, path.join(standalone, 'store-bootstrap.cjs'));
  console.log(`Copied scripts/store-bootstrap.cjs -> standalone`);
}

// Setup data directory symlink for persistence across rebuilds
setupDataSymlink();

console.log('Standalone app ready. Run (no .env):');
console.log('  First time: node store-bootstrap.cjs');
console.log('  Then: node run.js');
console.log('  Or use .env and: node server.js');

function setupDataSymlink() {
  const appName = process.env.ZIPPY_APP_NAME || 'zippy-mesh';
  const standaloneData = path.join(standalone, 'data');
  
  // Determine user data directory based on platform
  let userDataDir;
  if (process.platform === 'win32') {
    userDataDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
  } else if (process.platform === 'darwin') {
    userDataDir = path.join(os.homedir(), 'Library', 'Application Support', appName);
  } else {
    userDataDir = path.join(os.homedir(), `.${appName}`);
  }
  
  // Ensure user data directory exists
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
    console.log(`Created user data directory: ${userDataDir}`);
  }
  
  // Check current state of standalone data folder
  try {
    const stat = fs.lstatSync(standaloneData);
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      // Check if it's already a symlink to the right place
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(standaloneData);
        if (path.resolve(standalone, target) === userDataDir || target === userDataDir) {
          console.log(`Data symlink already correct: ${standaloneData} -> ${userDataDir}`);
          return;
        }
      }
      // Remove existing folder/symlink
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(standaloneData);
      } else {
        // Migrate existing data to user directory
        console.log('Migrating existing standalone data to user directory...');
        migrateData(standaloneData, userDataDir);
        fs.rmSync(standaloneData, { recursive: true, force: true });
      }
    }
  } catch (e) {
    // Doesn't exist, which is fine
  }
  
  // Create symlink/junction
  try {
    if (process.platform === 'win32') {
      // Use directory junction on Windows (no admin required)
      execSync(`mklink /J "${standaloneData}" "${userDataDir}"`, { stdio: 'ignore', shell: true });
    } else {
      fs.symlinkSync(userDataDir, standaloneData, 'dir');
    }
    console.log(`Created data symlink: ${standaloneData} -> ${userDataDir}`);
  } catch (e) {
    console.warn(`Warning: Could not create symlink (${e.message}). Data will be stored locally.`);
  }
}

function migrateData(src, dest) {
  if (!fs.existsSync(src)) return;
  
  for (const file of fs.readdirSync(src)) {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    
    // Only migrate if dest doesn't exist (don't overwrite user data)
    if (!fs.existsSync(destPath)) {
      if (fs.statSync(srcPath).isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
      console.log(`  Migrated: ${file}`);
    } else {
      console.log(`  Skipped (exists in user dir): ${file}`);
    }
  }
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) {
      copyRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
