#!/usr/bin/env python3
import argparse, hashlib, json, os, shutil, stat, subprocess, tempfile, zipfile
from pathlib import Path

FILES = ("background.js", "content.js", "manifest.json")

def git_identity(root: Path) -> str:
    dirty = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=root, text=True, capture_output=True, check=True).stdout
    if dirty:
        raise RuntimeError(f"refusing release from dirty source tree:\n{dirty}")
    return subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, text=True, capture_output=True, check=True).stdout.strip()

def deterministic_zip(source: Path, target: Path) -> None:
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted((*FILES, "RELEASE.json")):
            info = zipfile.ZipInfo(f"moodle-review-extension/{name}", (1980, 1, 1, 0, 0, 0))
            info.create_system = 3; info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, (source / name).read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

def publish(dist: Path, delivery: Path, commit: str, fail_before_switch: bool = False) -> dict[str, str]:
    delivery.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(b"".join((dist / name).read_bytes() for name in FILES)).hexdigest()[:12]
    version_name = f"moodle-review-extension-{commit[:12]}-{digest}"
    version = delivery / version_name
    with tempfile.TemporaryDirectory(prefix=".release-", dir=delivery) as temp_name:
        stage = Path(temp_name) / version_name; stage.mkdir()
        for name in FILES: shutil.copyfile(dist / name, stage / name)
        metadata = {"commit": commit, "artifact_digest": digest}
        (stage / "RELEASE.json").write_text(json.dumps(metadata, sort_keys=True, separators=(",", ":")) + "\n")
        zip_stage = Path(temp_name) / "extension.zip"; deterministic_zip(stage, zip_stage)
        if fail_before_switch: raise RuntimeError("injected pre-publication failure")
        if not version.exists(): os.replace(stage, version)
        zip_target = delivery / "moodle-review-extension-chrome-edge.zip"
        os.replace(zip_stage, zip_target)
        stable = delivery / "moodle-review-extension"
        link_stage = delivery / f".current-{os.getpid()}"
        link_stage.symlink_to(version_name, target_is_directory=True)
        if stable.exists() and not stable.is_symlink():
            legacy = delivery / ".legacy-moodle-review-extension"
            if legacy.exists(): shutil.rmtree(legacy)
            os.replace(stable, legacy)
        os.replace(link_stage, stable)
        hashes = {f"{stable.name}/{name}": hashlib.sha256((version / name).read_bytes()).hexdigest() for name in FILES}
        hashes[zip_target.name] = hashlib.sha256(zip_target.read_bytes()).hexdigest()
        checksum_stage = delivery / f".SHA256SUMS-{os.getpid()}"
        checksum_stage.write_text("".join(f"{value}  {name}\n" for name, value in hashes.items()))
        os.replace(checksum_stage, delivery / "SHA256SUMS")
        return hashes

def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--root", type=Path, required=True); parser.add_argument("--dist", type=Path, required=True); parser.add_argument("--delivery", type=Path, required=True)
    args = parser.parse_args(); commit = git_identity(args.root); publish(args.dist, args.delivery, commit); print(commit)
if __name__ == "__main__": main()
