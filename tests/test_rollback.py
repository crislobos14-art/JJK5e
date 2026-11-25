import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from zipfile import BadZipFile, ZipFile

make_rollback = runpy.run_path(str(Path(__file__).resolve().parents[1] / "tools" / "make-rollback.py"))["make_rollback"]


class RollbackTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.assets = Path(tmp.name)
        self.manifest = self.assets / "module.json"
        self.module = self.assets / "module.zip"
        self.output = self.assets / "rollback.zip"
        self.manifest.write_bytes(json.dumps({"id": "jjk5e", "version": "1.95.0"}).encode())
        with ZipFile(self.module, "w") as package:
            package.write(self.manifest, "module.json")

    def test_recovery_is_byte_identical_and_hashes_are_reproducible(self):
        make_rollback("v1.95.0", self.assets, self.output)
        with ZipFile(self.output) as saved:
            expected = []
            for asset in (self.manifest, self.module):
                contents = asset.read_bytes()
                self.assertEqual(saved.read(asset.name), contents)
                expected.append(f"{hashlib.sha256(contents).hexdigest()}  {asset.name}")
            self.assertEqual(saved.read("SHA256SUMS").decode().splitlines(), expected)

    def test_version_mismatch_stops_publication(self):
        with self.assertRaises(ValueError):
            make_rollback("v1.94.0", self.assets, self.output)
        self.assertFalse(self.output.exists())

    def test_corrupt_package_stops_publication(self):
        self.module.write_bytes(b"not a zip")
        with self.assertRaises(BadZipFile):
            make_rollback("v1.95.0", self.assets, self.output)
        self.assertFalse(self.output.exists())

    def test_wrong_embedded_manifest_stops_publication(self):
        with ZipFile(self.module, "w") as package:
            package.writestr("module.json", json.dumps({"id": "jjk5e", "version": "1.94.0"}))
        with self.assertRaises(ValueError):
            make_rollback("v1.95.0", self.assets, self.output)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
