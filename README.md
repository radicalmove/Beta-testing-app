# Moodle Course Review

Private FastAPI service for collecting Moodle course-review feedback. This initial scaffold exposes a health endpoint and supplies PostgreSQL-ready configuration.

## Run locally

1. Create a local environment file: `cp .env.example .env`, then replace the placeholder database password in both relevant values.
2. Start the service: `docker compose -f deploy/docker-compose.yml up --build`.
3. Check [http://localhost:8000/health](http://localhost:8000/health); it returns `{"status":"ok"}`.

## Test

From `server`, install the development dependencies and run:

```sh
python -m pip install -e ".[dev]"
pytest tests/test_health.py -q
```

Configuration is supplied through environment variables. Do not commit the root `.env` file.
