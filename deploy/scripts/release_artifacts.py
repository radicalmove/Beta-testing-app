#!/usr/bin/env python3
import argparse, hashlib, json, os, shutil, stat, subprocess, tempfile, zipfile
from pathlib import Path
FILES = ("background.js", "content.js", "manifest.json")

def git_identity(root: Path) -> str:
    dirty = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=root, text=True, capture_output=True, check=True).stdout
    if dirty: raise RuntimeError(f"refusing release from dirty source tree:\n{dirty}")
    return subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, text=True, capture_output=True, check=True).stdout.strip()

def deterministic_zip(source: Path, target: Path) -> None:
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted((*FILES, "RELEASE.json")):
            info=zipfile.ZipInfo(f"moodle-review-extension/{name}",(1980,1,1,0,0,0)); info.create_system=3; info.external_attr=(stat.S_IFREG|0o644)<<16
            archive.writestr(info,(source/name).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)

def _compatibility_links(delivery: Path) -> None:
    links={"moodle-review-extension":"current/moodle-review-extension","moodle-review-extension-chrome-edge.zip":"current/moodle-review-extension-chrome-edge.zip","SHA256SUMS":"current/SHA256SUMS","RELEASE.json":"current/RELEASE.json"}
    for name,target in links.items():
        path=delivery/name
        if path.is_symlink() and os.readlink(path)==target: continue
        if path.exists() or path.is_symlink():
            legacy=delivery/f".legacy-{name}"; shutil.rmtree(legacy,ignore_errors=True) if path.is_dir() and not path.is_symlink() else legacy.unlink(missing_ok=True); os.replace(path,legacy)
        path.symlink_to(target, target_is_directory=name=="moodle-review-extension")

def publish(dist: Path, delivery: Path, commit: str, fail_phase: str|None=None) -> dict[str,str]:
    delivery.mkdir(parents=True,exist_ok=True); releases=delivery/"releases"; releases.mkdir(exist_ok=True)
    digest=hashlib.sha256(b"".join((dist/n).read_bytes() for n in FILES)).hexdigest()[:12]; name=f"{commit[:12]}-{digest}"; version=releases/name
    with tempfile.TemporaryDirectory(prefix=".release-",dir=releases) as temp:
        stage=Path(temp)/name; unpacked=stage/"moodle-review-extension"; unpacked.mkdir(parents=True)
        for n in FILES: shutil.copyfile(dist/n,unpacked/n)
        metadata={"commit":commit,"artifact_digest":digest}; release_json=json.dumps(metadata,sort_keys=True,separators=(",",":"))+"\n"; (unpacked/"RELEASE.json").write_text(release_json); (stage/"RELEASE.json").write_text(release_json)
        deterministic_zip(unpacked,stage/"moodle-review-extension-chrome-edge.zip")
        hashes={f"moodle-review-extension/{n}":hashlib.sha256((unpacked/n).read_bytes()).hexdigest() for n in FILES}; hashes["moodle-review-extension-chrome-edge.zip"]=hashlib.sha256((stage/"moodle-review-extension-chrome-edge.zip").read_bytes()).hexdigest()
        (stage/"SHA256SUMS").write_text("".join(f"{v}  {k}\n" for k,v in hashes.items()))
        if fail_phase=="staged": raise RuntimeError("injected staged failure")
        if not version.exists(): os.replace(stage,version)
        if fail_phase=="versioned": raise RuntimeError("injected versioned failure")
        current=delivery/"current"
        if not current.exists() and (delivery/"moodle-review-extension").is_symlink():
            old=os.readlink(delivery/"moodle-review-extension"); current.symlink_to(old,target_is_directory=True)
        _compatibility_links(delivery)
        pointer=delivery/f".current-{os.getpid()}"; pointer.symlink_to(f"releases/{name}",target_is_directory=True); os.replace(pointer,current)
        if fail_phase=="switched": raise RuntimeError("injected switched failure")
        return hashes

def main():
    p=argparse.ArgumentParser(); p.add_argument("--root",type=Path,required=True); p.add_argument("--dist",type=Path,required=True); p.add_argument("--delivery",type=Path,required=True); a=p.parse_args(); commit=git_identity(a.root); publish(a.dist,a.delivery,commit); print(commit)
if __name__=="__main__": main()
