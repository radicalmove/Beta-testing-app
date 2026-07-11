from pathlib import Path
import json
import re
import subprocess
import tempfile
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[1]


def assert_classic_self_contained_script(source: str) -> None:
    forbidden = {
        "top-level ESM import": r"(?m)^\s*import(?:\s|\{|\*)",
        "top-level ESM export": r"(?m)^\s*export(?:\s|\{|\*)",
        "dynamic import": r"\bimport\s*\(",
        "runtime chunk reference": r"(?:^|[\"'])\.?\.?/chunks/[^\"']+\.js",
        "external script loader": r"\bimportScripts\s*\(",
        "external CommonJS dependency": r"\brequire\s*\(",
    }
    for label, pattern in forbidden.items():
        if re.search(pattern, source):
            raise AssertionError(f"content.js contains {label}")


def assert_production_manifest(manifest: dict) -> None:
    moodle = "https://my.uconline.ac.nz/*"
    service = "https://fld-mini.tail4ccaba.ts.net/*"
    if manifest.get("host_permissions") != [moodle, service]:
        raise AssertionError("production host_permissions must contain only the real UC Online and Tailscale hosts")
    scripts = manifest.get("content_scripts")
    if not isinstance(scripts, list) or len(scripts) != 1:
        raise AssertionError("production manifest must define exactly one content script")
    if scripts[0].get("matches") != [moodle] or scripts[0].get("js") != ["content.js"]:
        raise AssertionError("content.js must match only the real UC Online host")

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

    def test_backup_coordinates_api_stop_and_restart_with_failure_trap(self):
        script = (ROOT / "deploy/scripts/backup-postgres.sh").read_text()
        stop = script.index('stop api')
        dump = script.index('pg_dump')
        attachments = script.index('attachments.tar.gz')
        self.assertLess(stop, dump)
        self.assertLess(stop, attachments)
        self.assertIn("trap", script)
        self.assertIn("start api", script)
        self.assertNotIn("stop db", script)
        self.assertIn("exit_code=$?", script)

    def test_verify_pilot_authenticates_and_requires_migration_head(self):
        script = (ROOT / "deploy/scripts/verify-pilot.sh").read_text()
        for token in (
            "VERIFY_EMAIL", "VERIFY_PASSWORD", "/auth/login", "cookie-jar",
            "dashboard_session", "Secure", "/dashboard", "alembic current",
            "alembic heads", "current_revision", "head_revision",
        ):
            self.assertIn(token, script)
        self.assertNotIn("${VERIFY_PASSWORD}", script)

    def test_verify_pilot_restores_only_to_disposable_resources(self):
        script = (ROOT / "deploy/scripts/verify-pilot.sh").read_text()
        for token in (
            "pg_restore", "createdb", "dropdb", "disposable_db", "users",
            "attachments.tar.gz", "path safety", "mktemp -d", "SHA256SUMS",
        ):
            self.assertIn(token, script)
        self.assertNotIn("--password", script)

    def test_nightly_backup_systemd_units_are_installable(self):
        service = (ROOT / "deploy/systemd/moodle-review-backup.service").read_text()
        timer = (ROOT / "deploy/systemd/moodle-review-backup.timer").read_text()
        self.assertIn("User=root", service)
        self.assertIn("EnvironmentFile=/home/fldadmin/beta-testing-app/.env", service)
        self.assertIn("ExecStart=/home/fldadmin/beta-testing-app/deploy/scripts/backup-postgres.sh", service)
        self.assertIn("OnCalendar=*-*-* 02:00:00", timer)
        self.assertIn("RandomizedDelaySec=1h", timer)
        self.assertIn("Persistent=true", timer)

    def test_guides_cover_tailscale_restore_and_named_pilot_targets(self):
        operations = (ROOT / "docs/operations.md").read_text()
        pilot = (ROOT / "docs/pilot-test-script.md").read_text()
        self.assertIn("tailscale serve", operations)
        self.assertIn("disposable", operations.lower())
        for token in ("CRJU150", "896", "9972", "9976", "118172", "146308", "Reviewer", "LD", "SME"):
            self.assertIn(token, pilot)
        for route in (
            "https://my.uconline.ac.nz/course/view.php?id=896",
            "https://my.uconline.ac.nz/course/section.php?id=9972",
            "https://my.uconline.ac.nz/course/section.php?id=9976",
            "https://my.uconline.ac.nz/mod/page/view.php?id=118172",
            "https://my.uconline.ac.nz/mod/scorm/view.php?id=146308",
            "https://my.uconline.ac.nz/mod/scorm/player.php",
        ):
            self.assertIn(route, pilot)
        self.assertIn("maintenance window", operations.lower())
        self.assertIn("systemctl enable --now moodle-review-backup.timer", operations)

    def test_pilot_build_script_requires_external_private_key(self):
        script = (ROOT / "deploy/scripts/build-pilot-extension.sh").read_text()
        for token in ("PRIVATE_KEY_PATH", "my.uconline.ac.nz", "REVIEW_SERVICE_ORIGIN", "openssl"):
            self.assertIn(token, script)
        self.assertIn('OPTIONAL_FRAME_PATTERNS="${OPTIONAL_FRAME_PATTERNS-}"', script)

    def test_built_content_script_is_classic_and_self_contained(self):
        content_script = (ROOT / "extension/dist/content.js").read_text()
        assert_classic_self_contained_script(content_script)

    def test_classic_script_validator_rejects_esm_chunks_and_external_dependencies(self):
        invalid_sources = (
            'import { mount } from "./chunks/runtime.js";',
            'export { bootstrap };',
            'import("./chunks/runtime.js");',
            'importScripts("https://cdn.example.invalid/runtime.js");',
            'require("external-package");',
        )
        for source in invalid_sources:
            with self.subTest(source=source):
                with self.assertRaises(AssertionError):
                    assert_classic_self_contained_script(source)
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "content.js"
            artifact.write_text('(() => { document.documentElement.setAttribute("data-test", "active"); })();')
            assert_classic_self_contained_script(artifact.read_text())

    def test_production_manifest_uses_only_real_pilot_hosts(self):
        manifest = json.loads((ROOT / "extension/dist/manifest.json").read_text())
        assert_production_manifest(manifest)

    def test_manifest_validator_rejects_placeholder_or_additional_hosts(self):
        valid = {
            "host_permissions": ["https://my.uconline.ac.nz/*", "https://fld-mini.tail4ccaba.ts.net/*"],
            "content_scripts": [{"matches": ["https://my.uconline.ac.nz/*"], "js": ["content.js"]}],
        }
        assert_production_manifest(valid)
        for permissions in (
            ["https://moodle.example.invalid/*", "https://fld-mini.tail4ccaba.ts.net/*"],
            ["https://my.uconline.ac.nz/*", "https://fld-mini.tail4ccaba.ts.net/*", "https://extra.example/*"],
        ):
            with self.subTest(permissions=permissions):
                with self.assertRaises(AssertionError):
                    assert_production_manifest({**valid, "host_permissions": permissions})

    def test_just_built_content_script_executes_as_classic_and_marks_active(self):
        harness = r'''
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Window } from "happy-dom";
const window = new Window({ url: "https://my.uconline.ac.nz/course/view.php?id=896" });
window.document.body.innerHTML = "<h1>CRJU150</h1>";
const chrome = { runtime: { sendMessage(_message, callback) { callback({ ok: false, status: "signed-out", error: "Signed out" }); } } };
const context = { window, document: window.document, chrome, CustomEvent: window.CustomEvent, URL, Symbol, Promise, Error, console, setTimeout, clearTimeout };
vm.runInNewContext(readFileSync("dist/content.js", "utf8"), context, { filename: "content.js" });
await new Promise((resolve) => setTimeout(resolve, 0));
if (window.document.documentElement.getAttribute("data-moodle-review-extension") !== "active") throw new Error("content marker was not activated");
'''
        result = subprocess.run(
            ["node", "--input-type=module", "--eval", harness],
            cwd=ROOT / "extension", text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

if __name__ == "__main__":
    unittest.main()
