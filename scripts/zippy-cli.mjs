#!/usr/bin/env node
/**
 * scripts/zippy-cli.mjs — the `zmlr` / `npm run cli` entry point.
 *
 * A minimal dispatcher, deliberately: it owns argument routing and nothing
 * else, so each subcommand stays independently runnable
 * (`node scripts/doctor.mjs` works with or without this file).
 *
 *   npm run cli -- doctor            # or: node scripts/zippy-cli.mjs doctor
 *   npm run cli -- doctor --json
 *   npm run cli -- --help
 *
 * The child's exit code is this process's exit code, so a supervisor or CI
 * step can branch on `doctor` failing.
 */

import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMMANDS = {
  doctor: {
    script: path.join(__dirname, "doctor.mjs"),
    summary: "Check this install: env, data dir, DB, proxy trust, vault, providers",
  },
};

const USAGE = `zippy — ZippyMesh / ZMLR command line

Usage:
  npm run cli -- <command> [options]
  node scripts/zippy-cli.mjs <command> [options]

Commands:
${Object.entries(COMMANDS)
  .map(([name, c]) => `  ${name.padEnd(10)} ${c.summary}`)
  .join("\n")}

Options:
  -h, --help    Show this help (or pass --help to a command)

Examples:
  npm run cli -- doctor
  npm run cli -- doctor --json
  npm run cli -- doctor --url http://127.0.0.1:20128
`;

function run(scriptPath, args) {
  const child = spawn(process.execPath, [scriptPath, ...args], { stdio: "inherit" });
  child.on("error", (err) => {
    process.stderr.write(`zippy: failed to start ${path.basename(scriptPath)}: ${err.message}\n`);
    process.exit(2);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.stderr.write(`zippy: ${path.basename(scriptPath)} terminated by ${signal}\n`);
      process.exit(2);
    }
    process.exit(code ?? 0);
  });
}

const argv = process.argv.slice(2);
const first = argv[0];

if (!first || first === "-h" || first === "--help" || first === "help") {
  process.stdout.write(USAGE);
  process.exit(0);
}

const command = COMMANDS[first];
if (!command) {
  process.stderr.write(`zippy: unknown command "${first}"\n\n${USAGE}`);
  process.exit(2);
}

run(command.script, argv.slice(1));
