# Moodle Course Review

Private FastAPI service for collecting Moodle course-review feedback. This initial scaffold exposes a health endpoint and supplies PostgreSQL-ready configuration.

## Run locally

1. Create a local environment file: `cp .env.example .env`, then replace the placeholder database password in both relevant values.
2. Start the service: `docker compose --env-file .env -f deploy/docker-compose.yml up --build`.
3. Check [http://localhost:8000/health](http://localhost:8000/health); it returns `{"status":"ok"}`.

To provision the first administrator, set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_DISPLAY_NAME`, and `BOOTSTRAP_ADMIN_PASSWORD` as deployment secrets, run migrations, then run `python -m app.bootstrap` from `server`. This one-time command does nothing once an administrator exists.

Use the same explicit environment file when validating Compose configuration:

```sh
docker compose --env-file .env -f deploy/docker-compose.yml config
```

## Test

From `server`, install the development dependencies and run:

```sh
python -m pip install -e ".[dev]"
pytest tests/test_health.py -q
```

Configuration is supplied through environment variables. The explicit `--env-file .env` option supplies values for Compose interpolation; `env_file` in the Compose file supplies them to the running containers. Do not commit the root `.env` file.

## Private pilot

Production uses Compose managed by systemd, loopback-only API binding, and Tailscale Serve for stable private HTTPS. See [operations](docs/operations.md) and the [pilot script](docs/pilot-test-script.md). Build with `deploy/scripts/build-pilot-extension.sh`, with its RSA private key outside the repo. In Chrome/Edge enable Developer mode and Load unpacked `extension/dist`; record the exact stable IDs/redirect URIs in server configuration. Never commit the key.
