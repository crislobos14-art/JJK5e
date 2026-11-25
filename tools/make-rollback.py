from hashlib import sha256
import json
from pathlib import Path
import sys
from zipfile import ZIP_STORED, ZipFile


def make_rollback(tag, assets, output):
    manifest, package = (assets / name for name in ("module.json", "module.zip"))
    metadata = json.loads(manifest.read_bytes())
    if metadata["id"] != "jjk5e" or tag != "v" + metadata["version"]:
        raise ValueError("Previous release manifest does not match JJK5e " + tag)

    with ZipFile(package) as previous:
        if previous.testzip() or json.loads(previous.read("module.json")) != metadata:
            raise ValueError("Previous module.zip is damaged or has a different manifest")

    with ZipFile(output, "w", ZIP_STORED) as backup:
        checksums = []
        for asset in (manifest, package):
            backup.write(asset, asset.name)
            checksums.append(f"{sha256(asset.read_bytes()).hexdigest()}  {asset.name}\n")
        backup.writestr("SHA256SUMS", "".join(checksums))


if __name__ == "__main__":
    make_rollback(sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3]))
