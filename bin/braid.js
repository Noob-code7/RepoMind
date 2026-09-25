#!/usr/bin/env node
/**
 * bin/braid.js — the `braid` command (after `npm link`).
 * Bare `braid` → interactive REPL (Tab cycles modes).
 * `braid plan|run …` → non-interactive argv CLI (scripting/CI).
 * Delegates to the project's own tsx so .ts sources run anywhere,
 * with stdio inherited (TTY raw mode keeps working).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const tsxCli = require.resolve('tsx/cli');

const argv = process.argv.slice(2);
const entry = argv[0] === 'plan' || argv[0] === 'run' ? 'cli.ts' : 'repl.ts';
const res = spawnSync(process.execPath, [tsxCli, join(root, entry), ...argv], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_NO_WARNINGS: '1',
  },
});
process.exit(res.status ?? 1);
