from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[1]

class DeploymentPackageTests(unittest.TestCase):
    def test_compose_is_private_persistent_and_health_checked(self):
        compose = yaml.safe_load((ROOT / "deploy/docker-compose.yml").read_text())
        api, db = compose["services"]["api"], compose["services"]["db"]
        self.assertIn("127.0.0.1:${API_PORT:-8000}:8000", api["ports"])
        self.assertEqual(api["restart"], "unless-stopped")
        self.assertIn("healthcheck", api)
        self.assertIn("postgres_data:/var/lib/postgresql/data", db["volumes"])
        self.assertIn("attachments:/data/attachments", api["volumes"])
        self.assertIn("alembic upgrade head", " ".join(api["command"]))

    def test_production_env_example_has_required_controls(self):
        env = (ROOT / ".env.example").read_text()
        for name in ("POSTGRES_PASSWORD", "DATABASE_URL", "SESSION_SECRET", "BOOTSTRAP_ADMIN_PASSWORD", "ATTACHMENT_STORAGE_DIR", "ATTACHMENT_MAX_BYTES", "EXTENSION_REDIRECT_URIS", "MOODLE_HOST_PATTERNS", "SERVICE_ORIGIN"):
            self.assertRegex(env, rf"(?m)^{name}=")

    def test_systemd_and_nginx_never_create_public_listener(self):
        unit = (ROOT / "deploy/systemd/moodle-review.service").read_text()
        nginx = (ROOT / "deploy/nginx/moodle-review.conf").read_text()
        self.assertIn("/home/fldadmin/beta-testing-app", unit)
        self.assertIn("docker compose --env-file", unit)
        self.assertNotRegex(nginx, r"(?m)^\s*listen\s+(80|443)")
        self.assertIn("127.0.0.1", nginx)

    def test_backup_uses_lock_permissions_and_atomic_archives(self):
        script = (ROOT / "deploy/scripts/backup-postgres.sh").read_text()
        for token in ("flock", "umask 077", "pg_dump", "gzip", "sha256sum", "mv", "attachments", "RETENTION_DAYS"):
            self.assertIn(token, script)
        self.assertNotIn("--password", script)

    def test_guides_cover_tailscale_restore_and_named_pilot_targets(self):
        operations = (ROOT / "docs/operations.md").read_text()
        pilot = (ROOT / "docs/pilot-test-script.md").read_text()
        self.assertIn("tailscale serve", operations)
        self.assertIn("disposable", operations.lower())
        for token in ("CRJU150", "896", "9972", "9976", "118172", "146308", "Reviewer", "LD", "SME"):
            self.assertIn(token, pilot)

    def test_pilot_build_script_requires_external_private_key(self):
        script = (ROOT / "deploy/scripts/build-pilot-extension.sh").read_text()
        for token in ("PRIVATE_KEY_PATH", "my.uconline.ac.nz", "REVIEW_SERVICE_ORIGIN", "openssl"):
            self.assertIn(token, script)

if __name__ == "__main__":
    unittest.main()
