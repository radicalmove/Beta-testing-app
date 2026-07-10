# Private pilot operations

Compose runs PostgreSQL and FastAPI on the Ubuntu Mac mini. The API publishes only `127.0.0.1:8000`; PostgreSQL has no host port. Tailscale Serve terminates Tailnet HTTPS. The optional nginx sample is loopback-only. Never add a public listener.

Before deployment obtain the Tailnet DNS name, confirm Tailscale HTTPS, choose encrypted off-host backup storage, and obtain stable Chrome/Edge IDs and administrator identity. Clone to `/home/fldadmin/beta-testing-app`, create `.env`, replace every placeholder with separate random secrets, and `chmod 600 .env`.

```sh
docker compose --env-file .env -f deploy/docker-compose.yml config
bash -n deploy/scripts/*.sh
```

Install the systemd unit, enable/start it, and confirm with `ss -lnt` that port 8000 is loopback-only. Check the installed CLI syntax with `tailscale serve --help`, then normally run:

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:8000
tailscale serve status
```

Use the resulting stable `https://<machine>.<tailnet>.ts.net` as `SERVICE_ORIGIN` and restrict Tailnet ACL/grants to pilot users.

## Backup and restore

Run `deploy/scripts/backup-postgres.sh` from a root-owned timer. It locks concurrent runs, uses umask 077, PostgreSQL custom format, coordinated attachments tar, checksums, atomic rename, and retention. Credentials remain in the mode-0600 env file and container environment, not command arguments.

Validate with `tar -tzf`, extract to a temporary directory, and run `sha256sum -c SHA256SUMS`. For a disposable restore drill, create an isolated PostgreSQL container/volume, run `pg_restore --list database.dump`, restore to a new empty test database, compare tables/row counts, extract attachments into a disposable directory, then destroy only those test resources. Never test against live data. A live restore requires approval, outage, a pre-restore backup, matching DB and attachment archives, migrations, and health checks.

Run `deploy/scripts/verify-pilot.sh https://<machine>.<tailnet>.ts.net [archive]` for non-destructive health, authentication, migration and archive checks. Docker was unavailable in the packaging environment, so run the exact Compose config command and disposable restore on Ubuntu before sign-off.
