import { spawn, spawnSync } from 'node:child_process';

const compose = spawnSync('docker', ['compose','version'], {stdio:'ignore'}).status === 0
  ? ['docker','compose'] : ['docker-compose'];

export function startCompose(project, args, options = {}) {
  return spawn(compose[0],[...compose.slice(1),'-p',project,...args],options);
}

export function checkedExit(process) {
  return new Promise((resolve,reject) => {
    process.once('error',reject);
    process.once('exit',code => code===0 ? resolve() : reject(new Error('Compose command failed with status '+code)));
  });
}
