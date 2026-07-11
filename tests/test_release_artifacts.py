import json, os, subprocess, tempfile, unittest
from pathlib import Path
from deploy.scripts.release_artifacts import git_identity, publish
ROOT=Path(__file__).resolve().parents[1]
class ReleaseArtifactTests(unittest.TestCase):
 def make_repo(self,r):
  subprocess.run(["git","init","-q"],cwd=r,check=True); subprocess.run(["git","config","user.email","x@y"],cwd=r,check=True); subprocess.run(["git","config","user.name","T"],cwd=r,check=True); (r/"x").write_text("x"); subprocess.run(["git","add","x"],cwd=r,check=True); subprocess.run(["git","commit","-qm","x"],cwd=r,check=True)
 def dist(self,r,tag="new"):
  d=r/f"dist-{tag}"; d.mkdir(); [(d/n).write_text(tag+n) for n in ("background.js","content.js","manifest.json")]; return d
 def visible(self,d):
  return json.loads((d/"RELEASE.json").read_text())["commit"]
 def test_absolute_preflight_is_cwd_independent(self):
  with tempfile.TemporaryDirectory() as outside:
   env={**os.environ,"PRIVATE_KEY_PATH":"/tmp/not-read-in-preflight.pem","REVIEW_SERVICE_ORIGIN":"https://x.ts.net","RELEASE_PREFLIGHT_ONLY":"1"}
   result=subprocess.run([str(ROOT/"deploy/scripts/release-pilot-extension.sh")],cwd=outside,env=env,text=True,capture_output=True)
   self.assertNotIn("ModuleNotFoundError",result.stderr)
   self.assertTrue(result.returncode==0 or "dirty source tree" in result.stderr,result.stderr)
 def test_dirty_sources_rejected(self):
  with tempfile.TemporaryDirectory() as x:
   r=Path(x); self.make_repo(r); self.assertTrue(git_identity(r)); (r/"u").write_text("x"); self.assertRaises(RuntimeError,git_identity,r)
 def test_every_pre_switch_failure_keeps_old_coherent_release_and_switch_exposes_new_set(self):
  with tempfile.TemporaryDirectory() as x:
   r=Path(x); delivery=r/"delivery"; publish(self.dist(r,"old"),delivery,"a"*40)
   for phase in ("staged","versioned"):
    with self.assertRaises(RuntimeError): publish(self.dist(r,phase),delivery,"b"*40,phase)
    self.assertEqual(self.visible(delivery),"a"*40)
   with self.assertRaises(RuntimeError): publish(self.dist(r,"switch"),delivery,"b"*40,"switched")
   self.assertEqual(self.visible(delivery),"b"*40)
   current=(delivery/"current").resolve(); self.assertTrue((current/"moodle-review-extension").is_dir()); self.assertTrue((current/"moodle-review-extension-chrome-edge.zip").is_file()); self.assertTrue((current/"SHA256SUMS").is_file()); self.assertTrue((current/"RELEASE.json").is_file())
   self.assertEqual(os.readlink(delivery/"moodle-review-extension"),"current/moodle-review-extension")
 def test_repeated_release_is_deterministic(self):
  with tempfile.TemporaryDirectory() as x:
   r=Path(x); d=self.dist(r); delivery=r/"delivery"; publish(d,delivery,"c"*40); z=(delivery/"moodle-review-extension-chrome-edge.zip").read_bytes(); s=(delivery/"SHA256SUMS").read_bytes(); publish(d,delivery,"c"*40); self.assertEqual(z,(delivery/"moodle-review-extension-chrome-edge.zip").read_bytes()); self.assertEqual(s,(delivery/"SHA256SUMS").read_bytes())
 def test_migration_removes_an_existing_legacy_directory(self):
  with tempfile.TemporaryDirectory() as x:
   r=Path(x); delivery=r/"delivery"; delivery.mkdir(); old=delivery/"old"; old.mkdir(); (old/"RELEASE.json").write_text('{"commit":"old"}'); (delivery/"moodle-review-extension").symlink_to("old"); (delivery/".legacy-moodle-review-extension").mkdir()
   publish(self.dist(r),delivery,"d"*40); self.assertEqual(self.visible(delivery),"d"*40)
if __name__=='__main__': unittest.main()
