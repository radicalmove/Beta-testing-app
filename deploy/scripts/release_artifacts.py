#!/usr/bin/env python3
import argparse, fcntl, hashlib, json, os, re, shutil, stat, subprocess, tempfile, zipfile
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
        if entry.name == ".DS_Store":
            continue
        if entry.is_symlink() or not entry.is_dir():
            raise RuntimeError(f"malformed immutable release entry: {entry}")
        metadata_path=entry/"RELEASE.json"
        try:
            metadata=json.loads(metadata_path.read_text())
            if set(metadata)=={"commit","artifact_digest"}:
                commit=metadata["commit"]; digest=metadata["artifact_digest"]
                if not isinstance(commit,str) or not isinstance(digest,str) or not re.fullmatch(r"[0-9a-f]{40}",commit) or not re.fullmatch(r"[0-9a-f]{12}",digest) or entry.name != f"{commit[:12]}-{digest}":
                    raise ValueError("invalid legacy release metadata")
                _validate_legacy_release(entry,metadata)
                continue
            if set(metadata)!={"version","commit","artifact_digest"} or not all(isinstance(value,str) for value in metadata.values()):
                raise ValueError("unexpected release metadata")
            _validate_versioned_release(entry,metadata)
        except (OSError, json.JSONDecodeError, ValueError) as error:
            raise RuntimeError(f"malformed immutable release metadata: {metadata_path}") from error
        if metadata["version"]==version:
            matches.append((metadata["commit"],metadata["artifact_digest"]))
    if any(match != identity for match in matches):
        raise RuntimeError(f"version collision for {version}")

def _validate_legacy_release(entry: Path, metadata: dict[str,str]) -> None:
    unpacked=entry/"moodle-review-extension"; archive=entry/"moodle-review-extension-chrome-edge.zip"; sums=entry/"SHA256SUMS"
    expected={Path("RELEASE.json"),Path("SHA256SUMS"),Path("moodle-review-extension-chrome-edge.zip"),Path("moodle-review-extension"),*(Path("moodle-review-extension")/name for name in (*FILES,"RELEASE.json"))}
    actual={path.relative_to(entry) for path in entry.rglob("*")}
    if actual != expected or any((entry/path).is_symlink() for path in actual):
        raise ValueError("invalid legacy release tree")
    release_bytes=(entry/"RELEASE.json").read_bytes()
    if (unpacked/"RELEASE.json").read_bytes() != release_bytes or json.loads(release_bytes) != metadata:
        raise ValueError("legacy metadata copies differ")
    digest=hashlib.sha256(b"".join((unpacked/name).read_bytes() for name in FILES)).hexdigest()[:12]
    if digest != metadata["artifact_digest"]:
        raise ValueError("legacy artifact digest differs")
    checksum_paths=[*(f"moodle-review-extension/{name}" for name in FILES),"moodle-review-extension-chrome-edge.zip"]
    expected_sums="".join(f"{hashlib.sha256((entry/path).read_bytes()).hexdigest()}  {path}\n" for path in checksum_paths)
    if sums.read_text() != expected_sums:
        raise ValueError("legacy checksums differ")
    with tempfile.TemporaryDirectory() as temp:
        expected_zip=Path(temp)/"expected.zip"; deterministic_zip(unpacked,expected_zip)
        if archive.read_bytes() != expected_zip.read_bytes():
            raise ValueError("legacy ZIP differs")

def _valid_version(version: str) -> bool:
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)",version): return False
    components=[int(component) for component in version.split(".")]
    return any(components) and all(component <= 65535 for component in components)

def _validate_versioned_release(entry: Path, metadata: dict[str,str]) -> None:
    version=metadata["version"]; commit=metadata["commit"]; digest=metadata["artifact_digest"]
    if not _valid_version(version) or not re.fullmatch(r"[0-9a-f]{40}",commit) or not re.fullmatch(r"[0-9a-f]{12}",digest) or entry.name != f"v{version}-{commit[:12]}-{digest}":
        raise ValueError("invalid versioned release identity")
    unpacked=entry/"moodle-review-extension"; versioned=f"moodle-review-extension-v{version}-chrome-edge.zip"; stable="moodle-review-extension-chrome-edge.zip"
    paths=[*(f"moodle-review-extension/{name}" for name in FILES),"moodle-review-extension/RELEASE.json","RELEASE.json",versioned,stable]
    expected={Path("moodle-review-extension"),Path("SHA256SUMS"),*(Path(path) for path in paths)}
    actual={path.relative_to(entry) for path in entry.rglob("*")}
    if actual != expected or any((entry/path).is_symlink() for path in actual):
        raise ValueError("invalid versioned release tree")
    release_bytes=(entry/"RELEASE.json").read_bytes()
    if (unpacked/"RELEASE.json").read_bytes() != release_bytes or json.loads(release_bytes) != metadata:
        raise ValueError("versioned metadata copies differ")
    computed=hashlib.sha256(b"".join((unpacked/name).read_bytes() for name in FILES)).hexdigest()[:12]
    if computed != digest:
        raise ValueError("versioned artifact digest differs")
    expected_sums="".join(f"{hashlib.sha256((entry/path).read_bytes()).hexdigest()}  {path}\n" for path in paths)
    if (entry/"SHA256SUMS").read_text() != expected_sums:
        raise ValueError("versioned checksums differ")
    if (entry/versioned).read_bytes() != (entry/stable).read_bytes():
        raise ValueError("versioned ZIP aliases differ")
    with tempfile.TemporaryDirectory() as temp:
        expected_zip=Path(temp)/"expected.zip"; deterministic_zip(unpacked,expected_zip)
        if (entry/versioned).read_bytes() != expected_zip.read_bytes():
            raise ValueError("versioned ZIP differs")

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
