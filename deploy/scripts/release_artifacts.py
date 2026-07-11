#!/usr/bin/env python3
import argparse, fcntl, hashlib, json, os, shutil, stat, subprocess, tempfile, zipfile
from pathlib import Path
FILES = ("background.js", "content.js", "manifest.json")

def canonical_delivery(root: Path, git_common: Path, candidate: Path) -> Path:
    resolved = candidate.expanduser().resolve()
    if resolved == Path(resolved.anchor):
        raise RuntimeError(f"delivery destination must not be filesystem root: {resolved}")
    forbidden = (root.resolve(), git_common.resolve(), git_common.resolve().parent)
    for boundary in forbidden:
        if resolved == boundary or boundary in resolved.parents:
            raise RuntimeError(f"delivery destination must be external to repository: {resolved}")
    return resolved

def git_identity(root: Path) -> str:
    dirty = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=root, text=True, capture_output=True, check=True).stdout
    if dirty: raise RuntimeError(f"refusing release from dirty source tree:\n{dirty}")
    return subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, text=True, capture_output=True, check=True).stdout.strip()

def deterministic_zip(source: Path, target: Path) -> None:
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted((*FILES, "RELEASE.json")):
            info=zipfile.ZipInfo(f"moodle-review-extension/{name}",(1980,1,1,0,0,0)); info.create_system=3; info.external_attr=(stat.S_IFREG|0o644)<<16
            archive.writestr(info,(source/name).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)

def _compatibility_links(delivery: Path, version: str) -> None:
    versioned_zip=f"moodle-review-extension-v{version}-chrome-edge.zip"
    links={"moodle-review-extension":"current/moodle-review-extension","moodle-review-extension-chrome-edge.zip":"current/moodle-review-extension-chrome-edge.zip",versioned_zip:f"current/{versioned_zip}","SHA256SUMS":"current/SHA256SUMS","RELEASE.json":"current/RELEASE.json"}
    for name,target in links.items():
        path=delivery/name
        if path.is_symlink() and os.readlink(path)==target: continue
        if path.exists() or path.is_symlink():
            legacy=delivery/f".legacy-{name}"
            if legacy.is_dir() and not legacy.is_symlink(): shutil.rmtree(legacy)
            else: legacy.unlink(missing_ok=True)
            os.replace(path,legacy)
        path.symlink_to(target, target_is_directory=name=="moodle-review-extension")

def _scan_version(releases: Path, version: str, identity: tuple[str, str]) -> None:
    matches=[]
    for entry in releases.iterdir():
        if entry.is_symlink() or not entry.is_dir():
            raise RuntimeError(f"malformed immutable release entry: {entry}")
        metadata_path=entry/"RELEASE.json"
        try:
            metadata=json.loads(metadata_path.read_text())
            if set(metadata)!={"version","commit","artifact_digest"} or not all(isinstance(value,str) for value in metadata.values()):
                raise ValueError("unexpected release metadata")
        except (OSError, json.JSONDecodeError, ValueError) as error:
            raise RuntimeError(f"malformed immutable release metadata: {metadata_path}") from error
        if metadata["version"]==version:
            matches.append((metadata["commit"],metadata["artifact_digest"]))
    if any(match != identity for match in matches):
        raise RuntimeError(f"version collision for {version}")

def _validate_immutable_release(expected: Path, installed: Path) -> None:
    if installed.is_symlink() or not installed.is_dir():
        raise RuntimeError(f"invalid immutable release directory: {installed}")
    expected_entries={path.relative_to(expected) for path in expected.rglob("*")}
    installed_entries={path.relative_to(installed) for path in installed.rglob("*")}
    if expected_entries != installed_entries:
        raise RuntimeError(f"immutable release contents differ: {installed}")
    for relative in expected_entries:
        expected_path=expected/relative; installed_path=installed/relative
        if installed_path.is_symlink() or expected_path.is_dir() != installed_path.is_dir():
            raise RuntimeError(f"immutable release entry differs: {installed_path}")
        if expected_path.is_file() and expected_path.read_bytes() != installed_path.read_bytes():
            raise RuntimeError(f"immutable release file differs: {installed_path}")

def publish(dist: Path, delivery: Path, commit: str, version: str, fail_phase: str|None=None) -> dict[str,str]:
    delivery.mkdir(parents=True,exist_ok=True); releases=delivery/"releases"; releases.mkdir(exist_ok=True)
    digest=hashlib.sha256(b"".join((dist/n).read_bytes() for n in FILES)).hexdigest()[:12]; name=f"v{version}-{commit[:12]}-{digest}"; release=releases/name
    with (delivery/".publish.lock").open("a+") as lock:
      fcntl.flock(lock,fcntl.LOCK_EX)
      _scan_version(releases,version,(commit,digest))
      with tempfile.TemporaryDirectory(prefix=".release-",dir=delivery) as temp:
        stage=Path(temp)/name; unpacked=stage/"moodle-review-extension"; unpacked.mkdir(parents=True)
        for n in FILES: shutil.copyfile(dist/n,unpacked/n)
        metadata={"version":version,"commit":commit,"artifact_digest":digest}; release_json=json.dumps(metadata,sort_keys=True,separators=(",",":"))+"\n"; (unpacked/"RELEASE.json").write_text(release_json); (stage/"RELEASE.json").write_text(release_json)
        versioned_zip=f"moodle-review-extension-v{version}-chrome-edge.zip"; deterministic_zip(unpacked,stage/versioned_zip); shutil.copyfile(stage/versioned_zip,stage/"moodle-review-extension-chrome-edge.zip")
        paths=[*(f"moodle-review-extension/{n}" for n in FILES),"moodle-review-extension/RELEASE.json","RELEASE.json",versioned_zip,"moodle-review-extension-chrome-edge.zip"]
        hashes={path:hashlib.sha256((stage/path).read_bytes()).hexdigest() for path in paths}
        (stage/"SHA256SUMS").write_text("".join(f"{hashes[path]}  {path}\n" for path in paths))
        if fail_phase=="staged": raise RuntimeError("injected staged failure")
        if not release.exists(): os.replace(stage,release)
        else: _validate_immutable_release(stage,release)
        if fail_phase=="versioned": raise RuntimeError("injected versioned failure")
        current=delivery/"current"
        if not current.exists() and (delivery/"moodle-review-extension").is_symlink():
            old=os.readlink(delivery/"moodle-review-extension"); current.symlink_to(old,target_is_directory=True)
        _compatibility_links(delivery,version)
        pointer=delivery/f".current-{os.getpid()}"; pointer.symlink_to(f"releases/{name}",target_is_directory=True); os.replace(pointer,current)
        if fail_phase=="switched": raise RuntimeError("injected switched failure")
        return hashes

def main():
    p=argparse.ArgumentParser(); p.add_argument("--root",type=Path,required=True); p.add_argument("--dist",type=Path,required=True); p.add_argument("--delivery",type=Path,required=True); p.add_argument("--version",required=True); a=p.parse_args(); commit=git_identity(a.root); publish(a.dist,a.delivery,commit,a.version); print(commit)
if __name__=="__main__": main()
