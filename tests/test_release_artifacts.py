import hashlib, json, multiprocessing, os, shutil, subprocess, tempfile, unittest
from pathlib import Path
from deploy.scripts.release_artifacts import canonical_delivery, deterministic_zip, git_identity, publish
ROOT=Path(__file__).resolve().parents[1]
VERSION="0.3.3"

def race_publish(dist, delivery, commit, queue):
 try:
  publish(Path(dist),Path(delivery),commit,VERSION)
  queue.put("ok")
 except Exception as error:
  queue.put(f"{type(error).__name__}:{error}")

class ReleaseArtifactTests(unittest.TestCase):
 def test_delivery_destination_is_canonical_and_external(self):
  with tempfile.TemporaryDirectory() as x:
   base=Path(x); repo=base/"repo"; common=repo/".git"; nested=repo/"nested"; common.mkdir(parents=True); nested.mkdir(); outside=base/"outside"; alias=base/"alias"; alias.symlink_to(nested,target_is_directory=True)
   for candidate in (Path("/"), Path("."), nested, nested/"..", alias):
    with self.subTest(candidate=candidate), self.assertRaises(RuntimeError):
     canonical_delivery(repo,common,candidate if candidate.is_absolute() else repo/candidate)
   self.assertEqual(canonical_delivery(repo,common,outside/"../external"),(base/"external").resolve())
 def make_repo(self,r):
  subprocess.run(["git","init","-q"],cwd=r,check=True); subprocess.run(["git","config","user.email","x@y"],cwd=r,check=True); subprocess.run(["git","config","user.name","T"],cwd=r,check=True); (r/"x").write_text("x"); subprocess.run(["git","add","x"],cwd=r,check=True); subprocess.run(["git","commit","-qm","x"],cwd=r,check=True)
 def dist(self,r,tag="new"):
  d=r/f"dist-{tag}"; d.mkdir(); [(d/n).write_text(tag+n) for n in ("background.js","content.js","manifest.json")]; return d
 def visible(self,d):
  return json.loads((d/"RELEASE.json").read_text())["commit"]
 def legacy_release(self,releases,commit="9"*40,tag="legacy"):
  source=self.dist(releases.parent.parent,tag); digest=hashlib.sha256(b"".join((source/n).read_bytes() for n in ("background.js","content.js","manifest.json"))).hexdigest()[:12]
  legacy=releases/f"{commit[:12]}-{digest}"; unpacked=legacy/"moodle-review-extension"; unpacked.mkdir(parents=True)
  for name in ("background.js","content.js","manifest.json"): shutil.copyfile(source/name,unpacked/name)
  metadata=json.dumps({"commit":commit,"artifact_digest":digest},sort_keys=True,separators=(",",":"))+"\n"; (legacy/"RELEASE.json").write_text(metadata); (unpacked/"RELEASE.json").write_text(metadata)
  deterministic_zip(unpacked,legacy/"moodle-review-extension-chrome-edge.zip")
  paths=[*(f"moodle-review-extension/{name}" for name in ("background.js","content.js","manifest.json")),"moodle-review-extension-chrome-edge.zip"]
  (legacy/"SHA256SUMS").write_text("".join(f"{hashlib.sha256((legacy/path).read_bytes()).hexdigest()}  {path}\n" for path in paths))
  return legacy
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
   r=Path(x); delivery=r/"delivery"; publish(self.dist(r,"old"),delivery,"a"*40,"0.1.0"); new=self.dist(r,"new")
   for phase in ("staged","versioned"):
    with self.assertRaises(RuntimeError): publish(new,delivery,"b"*40,VERSION,phase)
    self.assertEqual(self.visible(delivery),"a"*40)
   with self.assertRaises(RuntimeError): publish(new,delivery,"b"*40,VERSION,"switched")
   self.assertEqual(self.visible(delivery),"b"*40)
   current=(delivery/"current").resolve(); self.assertTrue((current/"moodle-review-extension").is_dir()); self.assertTrue((current/"moodle-review-extension-chrome-edge.zip").is_file()); self.assertTrue((current/"SHA256SUMS").is_file()); self.assertTrue((current/"RELEASE.json").is_file())
   self.assertEqual(os.readlink(delivery/"moodle-review-extension"),"current/moodle-review-extension")
 def test_repeated_release_is_deterministic(self):
  with tempfile.TemporaryDirectory() as x:
   r=Path(x); d=self.dist(r); delivery=r/"delivery"; publish(d,delivery,"c"*40,VERSION); z=(delivery/"moodle-review-extension-chrome-edge.zip").read_bytes(); s=(delivery/"SHA256SUMS").read_bytes(); publish(d,delivery,"c"*40,VERSION); self.assertEqual(z,(delivery/"moodle-review-extension-chrome-edge.zip").read_bytes()); self.assertEqual(s,(delivery/"SHA256SUMS").read_bytes())
 def test_migration_removes_an_existing_legacy_directory(self):
  with tempfile.TemporaryDirectory() as x:
   r=Path(x); delivery=r/"delivery"; delivery.mkdir(); old=delivery/"old"; old.mkdir(); (old/"RELEASE.json").write_text('{"commit":"old"}'); (delivery/"moodle-review-extension").symlink_to("old"); (delivery/".legacy-moodle-review-extension").mkdir()
   publish(self.dist(r),delivery,"d"*40,VERSION); self.assertEqual(self.visible(delivery),"d"*40)
 def test_versioned_release_metadata_zip_aliases_and_exact_checksums(self):
  with tempfile.TemporaryDirectory() as x:
   r=Path(x); dist=self.dist(r); delivery=r/"delivery"; commit="e"*40
   publish(dist,delivery,commit,VERSION)
   digest=hashlib.sha256(b"".join((dist/n).read_bytes() for n in ("background.js","content.js","manifest.json"))).hexdigest()[:12]
   release=delivery/"releases"/f"v{VERSION}-{commit[:12]}-{digest}"
   metadata={"version":VERSION,"commit":commit,"artifact_digest":digest}
   self.assertEqual(json.loads((release/"RELEASE.json").read_text()),metadata)
   self.assertEqual(json.loads((release/"moodle-review-extension/RELEASE.json").read_text()),metadata)
   versioned=f"moodle-review-extension-v{VERSION}-chrome-edge.zip"
   expected={"moodle-review-extension/background.js","moodle-review-extension/content.js","moodle-review-extension/manifest.json","moodle-review-extension/RELEASE.json","RELEASE.json",versioned,"moodle-review-extension-chrome-edge.zip"}
   lines=(release/"SHA256SUMS").read_text().splitlines(); self.assertEqual({line.split("  ",1)[1] for line in lines},expected)
   self.assertEqual((release/versioned).read_bytes(),(release/"moodle-review-extension-chrome-edge.zip").read_bytes())
   self.assertEqual(os.readlink(delivery/versioned),f"current/{versioned}")
 def test_collision_scan_fails_closed_before_staging_or_switch(self):
  with tempfile.TemporaryDirectory() as x:
   r=Path(x); delivery=r/"delivery"; original=self.dist(r,"original"); publish(original,delivery,"1"*40,VERSION)
   current=os.readlink(delivery/"current"); history=set((delivery/"releases").iterdir())
   malformed=delivery/"releases"/"malformed"; malformed.mkdir(); (malformed/"RELEASE.json").write_text("not-json")
   with self.assertRaises(RuntimeError): publish(self.dist(r,"new"),delivery,"2"*40,VERSION)
   self.assertEqual(os.readlink(delivery/"current"),current); self.assertEqual(set((delivery/"releases").iterdir()),history|{malformed})
 def test_external_delivery_migrates_past_exact_validated_legacy_metadata(self):
  with tempfile.TemporaryDirectory() as x:
   r=Path(x); delivery=r/"external-delivery"; releases=delivery/"releases"; releases.mkdir(parents=True)
   legacy=self.legacy_release(releases)
   publish(self.dist(r),delivery,"b"*40,VERSION)
   self.assertEqual(self.visible(delivery),"b"*40)
   self.assertTrue(legacy.is_dir())
 def test_legacy_release_missing_tampered_or_symlinked_artifacts_fail_closed(self):
  cases=(("missing","SHA256SUMS"),("tampered","moodle-review-extension/content.js"),("tampered","moodle-review-extension-chrome-edge.zip"),("symlink","moodle-review-extension/manifest.json"))
  for action,relative in cases:
   with self.subTest(action=action,path=relative), tempfile.TemporaryDirectory() as x:
    r=Path(x); releases=r/"delivery/releases"; releases.mkdir(parents=True); legacy=self.legacy_release(releases); target=legacy/relative
    if action=="missing": target.unlink()
    elif action=="tampered": target.write_bytes(b"tampered")
    else: target.unlink(); target.symlink_to(legacy/"RELEASE.json")
    with self.assertRaisesRegex(RuntimeError,"malformed immutable release metadata"):
     publish(self.dist(r,"new"),r/"delivery","b"*40,VERSION)
 def test_legacy_metadata_exception_still_fails_closed_on_invalid_or_ambiguous_entries(self):
  cases=(
   ("short-commit",{"commit":"9"*39,"artifact_digest":"a"*12}),
   ("short-digest",{"commit":"9"*40,"artifact_digest":"a"*11}),
   ("non-hex",{"commit":"z"*40,"artifact_digest":"a"*12}),
   ("extra-field",{"commit":"9"*40,"artifact_digest":"a"*12,"extra":"x"}),
   ("wrong-name",{"commit":"9"*40,"artifact_digest":"a"*12}),
  )
  for name,metadata in cases:
   with self.subTest(case=name), tempfile.TemporaryDirectory() as x:
    r=Path(x); releases=r/"delivery/releases"; releases.mkdir(parents=True)
    entry_name=(f"{metadata['commit'][:12]}-{metadata['artifact_digest']}" if name != "wrong-name" else "unmatched")
    entry=releases/entry_name; entry.mkdir(); (entry/"RELEASE.json").write_text(json.dumps(metadata))
    with self.assertRaisesRegex(RuntimeError,"malformed immutable release metadata"):
     publish(self.dist(r),r/"delivery","b"*40,VERSION)
 def test_same_version_different_commit_or_digest_is_rejected_but_identical_repeat_allowed(self):
  with tempfile.TemporaryDirectory() as x:
   r=Path(x); delivery=r/"delivery"; dist=self.dist(r,"same"); publish(dist,delivery,"3"*40,VERSION); publish(dist,delivery,"3"*40,VERSION)
   with self.assertRaises(RuntimeError): publish(dist,delivery,"4"*40,VERSION)
   with self.assertRaises(RuntimeError): publish(self.dist(r,"different"),delivery,"3"*40,VERSION)
 def test_duplicate_version_metadata_with_different_identity_fails_closed(self):
  with tempfile.TemporaryDirectory() as x:
   r=Path(x); delivery=r/"delivery"; publish(self.dist(r),delivery,"5"*40,VERSION)
   duplicate=delivery/"releases"/"duplicate"; duplicate.mkdir(); (duplicate/"RELEASE.json").write_text(json.dumps({"version":VERSION,"commit":"6"*40,"artifact_digest":"f"*12}))
   with self.assertRaises(RuntimeError): publish(self.dist(r,"retry"),delivery,"5"*40,VERSION)
 def test_concurrent_publishers_allow_exactly_one_version_identity(self):
  with tempfile.TemporaryDirectory() as x:
   r=Path(x); delivery=r/"delivery"; queue=multiprocessing.Queue()
   processes=[multiprocessing.Process(target=race_publish,args=(str(self.dist(r,tag)),str(delivery),commit,queue)) for tag,commit in (("one","7"*40),("two","8"*40))]
   for process in processes: process.start()
   for process in processes: process.join(10); self.assertEqual(process.exitcode,0)
   results=[queue.get(timeout=2) for _ in processes]; self.assertEqual(results.count("ok"),1); self.assertTrue(any("collision" in result for result in results))
   releases=list((delivery/"releases").iterdir()); self.assertEqual(len(releases),1); self.assertEqual((delivery/"current").resolve(),releases[0].resolve())
 def test_tampered_immutable_release_is_never_reused_or_switched_current(self):
  tampered_paths=("RELEASE.json","moodle-review-extension/RELEASE.json","moodle-review-extension/content.js",f"moodle-review-extension-v{VERSION}-chrome-edge.zip","moodle-review-extension-chrome-edge.zip","SHA256SUMS")
  for tampered_path in tampered_paths:
   with self.subTest(path=tampered_path), tempfile.TemporaryDirectory() as x:
    r=Path(x); delivery=r/"delivery"; publish(self.dist(r,"old"),delivery,"a"*40,"0.1.0"); dist=self.dist(r,"candidate")
    with self.assertRaises(RuntimeError): publish(dist,delivery,"b"*40,VERSION,"versioned")
    candidate=next(path for path in (delivery/"releases").iterdir() if path.name.startswith(f"v{VERSION}-")); (candidate/tampered_path).write_bytes(b"tampered")
    with self.assertRaisesRegex(RuntimeError,"immutable release"):
     publish(dist,delivery,"b"*40,VERSION)
    self.assertEqual(self.visible(delivery),"a"*40)
 def test_symlinked_derived_release_directory_is_never_reused(self):
  with tempfile.TemporaryDirectory() as x:
   r=Path(x); delivery=r/"delivery"; publish(self.dist(r,"old"),delivery,"c"*40,"0.1.0"); dist=self.dist(r,"candidate")
   with self.assertRaises(RuntimeError): publish(dist,delivery,"d"*40,VERSION,"versioned")
   candidate=next(path for path in (delivery/"releases").iterdir() if path.name.startswith(f"v{VERSION}-")); replacement=r/"replacement"; shutil.copytree(candidate,replacement); shutil.rmtree(candidate); candidate.symlink_to(replacement,target_is_directory=True)
   with self.assertRaisesRegex(RuntimeError,"immutable release"):
    publish(dist,delivery,"d"*40,VERSION)
   self.assertEqual(self.visible(delivery),"c"*40)
 def test_other_version_history_is_fully_validated_before_publish(self):
  tampered_paths=("moodle-review-extension/background.js","moodle-review-extension/RELEASE.json",f"moodle-review-extension-v0.2.0-chrome-edge.zip","moodle-review-extension-chrome-edge.zip","SHA256SUMS")
  for relative in tampered_paths:
   with self.subTest(path=relative), tempfile.TemporaryDirectory() as x:
    r=Path(x); delivery=r/"delivery"; publish(self.dist(r,"history"),delivery,"e"*40,"0.2.0"); history=next((delivery/"releases").iterdir()); (history/relative).write_bytes(b"tampered")
    with self.assertRaisesRegex(RuntimeError,"malformed immutable release metadata"):
     publish(self.dist(r,"new"),delivery,"f"*40,VERSION)
 def test_arbitrary_or_invalid_versioned_history_fails_closed(self):
  versions=("0.0.0","00.2.0","65536.0.0","not-a-version")
  for historical_version in versions:
   with self.subTest(version=historical_version), tempfile.TemporaryDirectory() as x:
    r=Path(x); releases=r/"delivery/releases"; releases.mkdir(parents=True); entry=releases/"arbitrary"; entry.mkdir(); (entry/"RELEASE.json").write_text(json.dumps({"version":historical_version,"commit":"a"*40,"artifact_digest":"b"*12}))
    with self.assertRaisesRegex(RuntimeError,"malformed immutable release metadata"):
     publish(self.dist(r),r/"delivery","f"*40,VERSION)
if __name__=='__main__': unittest.main()
