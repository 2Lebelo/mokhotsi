"""The shipped manifest must carry every field the Python tooling reads.

Guards against the manifest schema drifting away from ml/scripts (as happened when
schema 5 moved the thresholds onto the embedder), which no other test catches.
"""

import hashlib

from _manifest import SCHEMA_VERSION
from _pipeline import MANIFEST_PATH, MODELS_DIR, load_manifest


def test_manifest_has_the_fields_the_scripts_read():
    manifest = load_manifest(MANIFEST_PATH)
    assert manifest["schema_version"] == SCHEMA_VERSION

    embedder = manifest["embedder"]
    assert 0 <= embedder["match_threshold"] <= 1  # eval_matching.py operating point
    assert 0 <= embedder["match_margin"] <= 1
    assert embedder["dim"] == 256
    assert len(embedder["input"]) == 3  # Models._check / embed
    assert embedder["input_range"][0] < embedder["input_range"][1]
    assert embedder["model_version"]  # eval_matching.py report
    assert "layout" not in embedder  # fixed nhwc since schema 5; _pipeline defaults it

    detector = manifest["detector"]
    for key in ("input", "layout", "input_range", "output", "show_threshold", "keep_threshold"):
        assert key in detector  # Models._check / detect

    assert manifest["matching"]["top_k"] >= 1  # eval_matching.py ranking depth


def test_manifest_names_the_bundled_embedder_file():
    manifest = load_manifest(MANIFEST_PATH)
    model = MODELS_DIR / manifest["embedder"]["file"]
    assert model.is_file(), f"{model} is named by the manifest but missing"
    digest = hashlib.sha256(model.read_bytes()).hexdigest()
    assert digest == manifest["embedder"]["sha256"]
