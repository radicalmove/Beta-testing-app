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

Run `deploy/scripts/backup-postgres.sh` from the root-owned timer. The coordinated backup creates a brief maintenance window: it takes the lock, stops only the API, dumps the still-running database and archives attachments, then restarts the API even if backup creation fails. It is not an online snapshot. The script also uses umask 077, checksums, atomic rename, and retention. Credentials remain in the mode-0600 env file and container environment, not command arguments.

Install and enable the supplied nightly timer exactly as follows:

```sh
sudo install -o root -g root -m 0644 deploy/systemd/moodle-review-backup.service /etc/systemd/system/moodle-review-backup.service
sudo install -o root -g root -m 0644 deploy/systemd/moodle-review-backup.timer /etc/systemd/system/moodle-review-backup.timer
sudo install -o root -g root -m 0755 deploy/scripts/backup-postgres.sh /home/fldadmin/beta-testing-app/deploy/scripts/backup-postgres.sh
sudo systemctl daemon-reload
sudo systemctl enable --now moodle-review-backup.timer
systemctl list-timers moodle-review-backup.timer
```

`verify-pilot.sh` validates archive paths and checksums, restores the custom dump into a uniquely named disposable database in the existing PostgreSQL container, queries the restored `users` table, then always drops that database. It separately extracts attachments into a disposable directory, checks readability, and cleans it up. An empty attachments directory is valid. It never restores into the production database. A live restore requires approval, outage, a pre-restore backup, matching DB and attachment archives, migrations, and health checks.

Run `VERIFY_EMAIL=... VERIFY_PASSWORD=... deploy/scripts/verify-pilot.sh https://<machine>.<tailnet>.ts.net [archive]` using an existing approved pilot account. Do not place credentials in positional arguments or logs. The check verifies authenticated dashboard access, unauthenticated API rejection, exact Alembic head equality, and (when supplied) a disposable restore. Docker was unavailable in the packaging environment, so run the exact Compose config command and disposable restore on Ubuntu before sign-off.
