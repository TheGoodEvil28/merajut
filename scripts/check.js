import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

for (const folder of ['apps', 'scripts', 'tests']) {
  for (const entry of await readdir(folder, { recursive: true })) {
    if (!entry.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', join(folder, entry)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
console.log('JavaScript syntax checks passed.');
