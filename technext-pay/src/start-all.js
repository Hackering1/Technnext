import { spawn, spawnSync } from 'node:child_process';

const migration = spawnSync(process.execPath, ['scripts/migrate.js'], { stdio: 'inherit' });
if (migration.error) throw migration.error;
if (migration.status !== 0) process.exit(migration.status ?? 1);

const children = [
  spawn(process.execPath, ['src/server.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['src/outbox-worker.js'], { stdio: 'inherit' })
];
let stopping = false;
let exitCode = 0;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill(signal);
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

await Promise.all(children.map((child) => new Promise((resolve) => {
  child.once('error', (error) => {
    console.error(JSON.stringify({ level: 'error', event: 'service_child_error', message: error.message }));
    exitCode = 1;
    stop();
    resolve();
  });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(JSON.stringify({ level: 'error', event: 'service_child_exit', code, signal }));
      exitCode = code || 1;
      stop();
    }
    resolve();
  });
})));

process.exitCode = exitCode;
