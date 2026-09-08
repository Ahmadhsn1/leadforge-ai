# Running Without Docker

`docker compose up` is still the documented path and still works. This document
covers the alternative: running PostgreSQL and Redis as native binaries.

## Why this exists

Docker Desktop on Windows runs its engine inside a WSL2 virtual machine. If WSL
breaks — and it does — Docker cannot start at all, with an error that names WSL
rather than anything you did:

```
engine linux/wsl failed to start: listing WSL distros: running wslexec:
DockerDesktop/Wsl/CommandTimedOut: c:\windows\system32\wsl.exe -l -v --all
```

That happened during this build. `wsl -l -v` hung indefinitely, `wsl --shutdown`
returned without doing anything, and the distro registry
(`HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss`) contained zero
distributions. Repairing it needs a reboot or a WSL reinstall.

Postgres and Redis have no such dependency. They are ordinary Windows
executables, they start in about a second, and they cost nothing.

## One-time setup

Both binaries live under `C:\leadforge-runtime`, outside the repository, because
they are machine state rather than source.

### PostgreSQL 16

The official EnterpriseDB installer download returns HTTP 403 to non-browser
clients. Maven Central serves the same binaries, packaged for the
`embedded-postgres` project, and does not:

```bash
curl -sL -o pg.jar \
  https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-windows-amd64/16.4.0/embedded-postgres-binaries-windows-amd64-16.4.0.jar
unzip -o -q pg.jar -d jar
mkdir -p /c/leadforge-runtime/pgsql
tar -xJf jar/postgres-windows-x86_64.txz -C /c/leadforge-runtime/pgsql
```

This distribution is trimmed: it has `postgres`, `initdb` and `pg_ctl`, but no
`psql` and no `pg_dump`. That is enough to run the application — Prisma connects
over TCP — but you cannot use `psql` for ad-hoc queries. Use Prisma Studio
(`pnpm --filter @leadforge/database exec prisma studio`) instead.

Initialise the cluster:

```bash
echo "leadforge" > /c/leadforge-runtime/pwfile
/c/leadforge-runtime/pgsql/bin/initdb.exe \
  -D /c/leadforge-runtime/pgdata -U leadforge \
  --pwfile=/c/leadforge-runtime/pwfile -E UTF8 --locale=C
rm /c/leadforge-runtime/pwfile

printf 'port = 5462\nlisten_addresses = %s\n' "'localhost'" \
  >> /c/leadforge-runtime/pgdata/postgresql.conf
```

Port 5462 rather than 5432 because 5432 is usually already taken by another
project on a developer machine. `.env` expects 5462.

Then create the two databases. `scripts/dev-services.mjs start` will bring the
server up; the databases themselves are created once, through Prisma:

```js
// from packages/database, with DATABASE_URL pointing at .../postgres
await prisma.$executeRawUnsafe('CREATE DATABASE "leadforge" OWNER leadforge');
await prisma.$executeRawUnsafe('CREATE DATABASE "leadforge_test" OWNER leadforge');
```

### Redis 8

```bash
curl -sL -o redis.zip \
  https://github.com/redis-windows/redis-windows/releases/download/8.10.1/Redis-8.10.1-Windows-x64-msys2.zip
unzip -o -q redis.zip -d /c/leadforge-runtime
mv /c/leadforge-runtime/Redis-8.10.1-Windows-x64-msys2 /c/leadforge-runtime/redis
```

Write `C:\leadforge-runtime\redis\leadforge.conf`:

```
port 6389
bind 127.0.0.1
protected-mode yes
appendonly yes
appendfsync everysec
maxmemory-policy noeviction
notify-keyspace-events Ex
dir ./
logfile redis.log
```

Two of those lines are not optional:

- **`maxmemory-policy noeviction`** — BullMQ stores job state in Redis. If Redis
  is allowed to evict keys under memory pressure, queued jobs disappear with no
  error anywhere.
- **`notify-keyspace-events Ex`** — BullMQ uses key-expiry events to wake
  delayed and repeatable jobs. Without it, delayed jobs never fire, which is
  exactly what schedules every follow-up.

## Daily use

```bash
pnpm services          # start both
pnpm services:status   # check both
pnpm services:stop     # stop both, flushing Redis to disk first
```

`services:stop` uses `SHUTDOWN SAVE`, not `SHUTDOWN NOSAVE`: the append-only
file is what preserves queued jobs across a restart.

## What this changes about the application

Nothing. `.env` is identical either way — the same two ports, the same
credentials — because the compose file and this setup deliberately agree on
them. Migrations, tests, the API, the worker and the smoke suites all behave the
same.

The only difference is `docker compose ps` versus `pnpm services:status`.
