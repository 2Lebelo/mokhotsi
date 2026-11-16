"""The bundled models must run on every Android CPU.

Full-integer (int8 activation) models passed the manifest shape check on the phone and
then failed their first inference ("TFLite: Failed to run TFLite Model! Status: error")
on a 32-bit Galaxy A02. Guard against shipping one again: both files must be float at
the tensor level, run under the default and the delegate-free op resolvers, and match
what the manifest says about them.
"""

import hashlib

import numpy as np
import pytest
from ai_edge_litert.interpreter import Interpreter, OpResolverType
from tensorflow.lite.python import schema_py_generated as schema
from tensorflow.lite.tools import flatbuffer_utils

from _pipeline import MANIFEST_PATH, MODELS_DIR, load_manifest

INTEGER_ACTIVATION_TYPES = {
    schema.TensorType.INT8,
    schema.TensorType.UINT8,
    schema.TensorType.INT16,
}


@pytest.fixture(scope="module")
def manifest() -> dict:
    return load_manifest(MANIFEST_PATH)


@pytest.mark.parametrize("role", ["detector", "embedder"])
def test_shipped_model_has_no_integer_activations(manifest: dict, role: str) -> None:
    model = flatbuffer_utils.read_model(str(MODELS_DIR / manifest[role]["file"]))
    integer_tensors = [
        tensor.name
        for subgraph in model.subgraphs
        for tensor in subgraph.tensors
        if tensor.type in INTEGER_ACTIVATION_TYPES
    ]
    assert integer_tensors == [], (
        f"{role} carries int8 tensors; rewrite it with scripts/make_float_models.py"
    )


@pytest.mark.parametrize(
    "resolver", [OpResolverType.AUTO, OpResolverType.BUILTIN_WITHOUT_DEFAULT_DELEGATES]
)
@pytest.mark.parametrize("role", ["detector", "embedder"])
def test_shipped_model_runs_on_zeros_like_the_app_warm_up(
    manifest: dict, role: str, resolver: OpResolverType
) -> None:
    spec = manifest[role]
    interpreter = Interpreter(
        model_path=str(MODELS_DIR / spec["file"]), experimental_op_resolver_type=resolver
    )
    interpreter.allocate_tensors()
    inp = interpreter.get_input_details()[0]
    out = interpreter.get_output_details()[0]
    h, w, c = spec["input"]
    expected_in = [1, c, h, w] if spec.get("layout", "nhwc") == "nchw" else [1, h, w, c]
    expected_out = [1, *spec["output"]] if role == "detector" else [1, spec["dim"]]
    assert inp["dtype"] == np.float32 and out["dtype"] == np.float32
    assert list(inp["shape"]) == expected_in
    assert list(out["shape"]) == expected_out

    interpreter.set_tensor(inp["index"], np.zeros(inp["shape"], dtype=np.float32))
    interpreter.invoke()
    result = interpreter.get_tensor(out["index"])
    assert np.isfinite(result).all()


def test_manifest_pins_the_bundled_embedder(manifest: dict) -> None:
    path = MODELS_DIR / manifest["embedder"]["file"]
    assert path.is_file(), f"{path} is named by the manifest but missing"
    assert hashlib.sha256(path.read_bytes()).hexdigest() == manifest["embedder"]["sha256"]
