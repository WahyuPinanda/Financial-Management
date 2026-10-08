const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');

function check(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) check(path);
    else if (entry.name.endsWith('.js'))
      execFileSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  }
}
check(resolve(__dirname, '../apps/api/src'));
check(resolve(__dirname, '../packages/shared/src'));
console.log('Backend JavaScript syntax valid.');
