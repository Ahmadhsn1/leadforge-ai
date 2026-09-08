#!/usr/bin/env node
/**
 * Starts the local Postgres and Redis that LeadForge develops against.
 *
 * Why this exists instead of `docker compose up`: Docker Desktop on Windows
 * runs its engine inside WSL2, and a broken WSL installation takes the whole
 * stack down with it — `wsl -l -v` hanging is enough to stop the engine
 * booting at all. Native binaries have no such dependency, start in about a
 * second, and cost nothing.
 *
 * `docker-compose.yml` is still the reference for CI and for anyone whose
 * Docker works. Both produce the same two services on the same two ports, so
 * `.env` does not change depending on which one you used.
 *
 *   node scripts/dev-services.mjs start | stop | status
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = 'C:/leadforge-runtime';
const PG_CTL = path.join(ROOT, 'pgsql/bin/pg_ctl.exe');
const PG_DATA = path.join(ROOT, 'pgdata');
const REDIS_DIR = path.join(ROOT, 'redis');
const REDIS_SERVER = path.join(REDIS_DIR, 'redis-server.exe');
const REDIS_CLI = path.join(REDIS_DIR, 'redis-cli.exe');

const PG_PORT = Number(process.env.POSTGRES_PORT ?? 5462);
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6389);

/** True when something is accepting connections on the port. */
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net
      .connect({ host: '127.0.0.1', port })
      .setTimeout(1_000)
      .on('connect', () => (socket.destroy(), resolve(true)))
      .on('timeout', () => (socket.destroy(), resolve(false)))
      .on('error', () => resolve(false));
  });
}

async function waitFor(port, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} did not start within ${timeoutMs / 1000}s`);
}

function assertInstalled() {
  const missing = [PG_CTL, REDIS_SERVER].filter((p) => !existsSync(p));
  if (missing.length > 0) {
    throw new Error(
      `Local services are not installed. Missing:\n  ${missing.join('\n  ')}\n` +
        'See docs/44-RUNNING-WITHOUT-DOCKER.md for the one-time setup.',
    );
  }
}

async function start() {
  assertInstalled();

  if (await portOpen(PG_PORT)) {
    console.log(`postgres already listening on ${PG_PORT}`);
  } else {
    // pg_ctl writes its own log and detaches; -w waits for readiness.
    spawnSync(PG_CTL, ['-D', PG_DATA, '-l', path.join(ROOT, 'pg.log'), '-w', 'start'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitFor(PG_PORT, 'postgres');
    console.log(`postgres started on ${PG_PORT}`);
  }

  if (await portOpen(REDIS_PORT)) {
    console.log(`redis already listening on ${REDIS_PORT}`);
  } else {
    // redis-server has no daemonize on Windows, so it is detached here.
    const child = spawn(REDIS_SERVER, ['leadforge.conf'], {
      cwd: REDIS_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    await waitFor(REDIS_PORT, 'redis');
    console.log(`redis started on ${REDIS_PORT}`);
  }
}

function stop() {
  if (existsSync(PG_CTL)) {
    spawnSync(PG_CTL, ['-D', PG_DATA, '-m', 'fast', 'stop'], { stdio: 'ignore', windowsHide: true });
  }
  if (existsSync(REDIS_CLI)) {
    // SHUTDOWN NOSAVE would drop queued jobs; let Redis persist the AOF first.
    spawnSync(REDIS_CLI, ['-p', String(REDIS_PORT), 'SHUTDOWN', 'SAVE'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }
  console.log('stopped');
}

async function status() {
  console.log(`postgres :${PG_PORT} ${(await portOpen(PG_PORT)) ? 'up' : 'down'}`);
  console.log(`redis    :${REDIS_PORT} ${(await portOpen(REDIS_PORT)) ? 'up' : 'down'}`);
}

const command = process.argv[2] ?? 'start';
const actions = { start, stop, status };
if (!actions[command]) {
  console.error(`Unknown command "${command}". Use start, stop or status.`);
  process.exit(1);
}

try {
  await actions[command]();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
