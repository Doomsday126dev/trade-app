"""Sanitize only isolated CI evidence, including text inside available trace ZIPs.

Tests use synthetic accounts/transports. Do not point this at account profiles or
use it as a general-purpose private-data anonymizer. Failed sanitization blocks
upload; absent traces are reported honestly and never synthesized.
"""
import json
import os
from pathlib import Path
import re
import zipfile


def redact(data, secrets):
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data  # Synthetic screenshots and image resources, not profiles.
    for secret in secrets:
        text = text.replace(secret, "[REDACTED]")
    text = re.sub(r"\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})", "[REDACTED]", text)
    text = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._~+/-]+=*", r"\1[REDACTED]", text)
    return text.encode("utf-8")


def sanitize(root):
    secrets = [value for key, value in os.environ.items()
               if re.search(r"TOKEN|SECRET|PASSWORD|CREDENTIAL", key) and len(value) >= 8]
    files = []
    for folder in (root / "product-ci-artifacts", root / "test-results"):
        if folder.is_symlink():
            raise ValueError("Evidence root must not be a symlink")
        if not folder.exists():
            continue
        for file in sorted(folder.rglob("*")):
            if file.is_symlink():
                raise ValueError("Evidence must not contain symlinks")
            if not file.is_file():
                continue
            if file.suffix == ".zip":
                # Read/rewrite in memory: never extract untrusted member paths.
                with zipfile.ZipFile(file) as archive:
                    members = [(info, redact(archive.read(info), secrets)) for info in archive.infolist()]
                with zipfile.ZipFile(file, "w") as archive:
                    for info, data in members:
                        archive.writestr(info, data)
            else:
                file.write_bytes(redact(file.read_bytes(), secrets))
            files.append(file.relative_to(root).as_posix())
    output = root / "product-ci-artifacts"
    output.mkdir(exist_ok=True)
    manifest = {"files": files, "traceCount": sum(name.endswith("/trace.zip") for name in files),
                "note": "No trace is promised for a crash before context creation. Only available evidence is retained."}
    (output / "evidence-inventory.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    sanitize(Path.cwd())
