import subprocess, tempfile, unittest
from pathlib import Path
from deploy.scripts.release_artifacts import deterministic_zip, git_identity, publish

class ReleaseArtifactTests(unittest.TestCase):
    def make_repo(self, root: Path):
        subprocess.run(["git", "init", "-q"], cwd=root, check=True); subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=root, check=True); subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
        (root / "tracked").write_text("clean"); subprocess.run(["git", "add", "tracked"], cwd=root, check=True); subprocess.run(["git", "commit", "-qm", "initial"], cwd=root, check=True)
    def make_dist(self, root: Path):
        dist = root / "dist"; dist.mkdir();
        for name in ("background.js", "content.js", "manifest.json"): (dist / name).write_text(name)
        return dist
    def test_dirty_tracked_and_untracked_sources_are_rejected_but_ignored_outputs_are_allowed(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); self.make_repo(root); (root/".gitignore").write_text("dist/\n"); subprocess.run(["git","add",".gitignore"],cwd=root,check=True); subprocess.run(["git","commit","-qm","ignore"],cwd=root,check=True)
            (root/"dist").mkdir(); (root/"dist/x").write_text("ignored"); self.assertTrue(git_identity(root))
            (root/"untracked").write_text("x"); self.assertRaises(RuntimeError, git_identity, root); (root/"untracked").unlink(); (root/"tracked").write_text("dirty"); self.assertRaises(RuntimeError, git_identity, root)
    def test_failure_preserves_current_and_success_is_atomic_versioned_and_records_commit(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); delivery=root/"delivery"; delivery.mkdir(); old=delivery/"old"; old.mkdir(); stable=delivery/"moodle-review-extension"; stable.symlink_to("old"); dist=self.make_dist(root)
            with self.assertRaises(RuntimeError): publish(dist, delivery, "a"*40, True)
            self.assertEqual(stable.resolve(), old.resolve())
            publish(dist, delivery, "a"*40); self.assertTrue(stable.is_symlink()); self.assertEqual(__import__('json').loads((stable/"RELEASE.json").read_text())["commit"], "a"*40)
    def test_repeated_release_produces_identical_zip_and_checksums(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); dist=self.make_dist(root); delivery=root/"delivery"; first=publish(dist,delivery,"b"*40); zip1=(delivery/"moodle-review-extension-chrome-edge.zip").read_bytes(); sums1=(delivery/"SHA256SUMS").read_bytes(); second=publish(dist,delivery,"b"*40)
            self.assertEqual(first,second); self.assertEqual(zip1,(delivery/"moodle-review-extension-chrome-edge.zip").read_bytes()); self.assertEqual(sums1,(delivery/"SHA256SUMS").read_bytes())
if __name__ == '__main__': unittest.main()
