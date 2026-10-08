const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const directory = resolve(__dirname, '../tests');
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.test.js'))
  .map((name) => resolve(directory, name));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
