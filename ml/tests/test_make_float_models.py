"""make_float_models.py keeps the function of a model while changing its precision.

Builds a small MobileNet-shaped network (conv, depthwise conv, dense, L2 normalise), converts
it the way the shipped embedder was converted (full int8 with a float32 tensor interface), and
checks both passes against the originals on the script's own sampled inputs.
"""

from pathlib import Path

import numpy as np
import pytest
import tensorflow as tf
from ai_edge_litert.interpreter import Interpreter, OpResolverType
from tensorflow.lite.python import schema_py_generated as schema
from tensorflow.lite.tools import flatbuffer_utils

from make_float_models import compare, integer_activation_tensors, rewrite

INPUT = (32, 32, 3)


def _network() -> tf.keras.Model:
    tf.keras.utils.set_random_seed(0)
    inputs = tf.keras.Input(INPUT)
    x = tf.keras.layers.Conv2D(8, 3, strides=2, padding="same", activation="relu6")(inputs)
    x = tf.keras.layers.DepthwiseConv2D(3, padding="same", activation="relu6")(x)
    x = tf.keras.layers.Conv2D(16, 1, activation="relu6")(x)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dense(8, use_bias=False)(x)
    outputs = tf.keras.layers.UnitNormalization()(x)
    return tf.keras.Model(inputs, outputs)


def _representative():
    rng = np.random.default_rng(1)
    for _ in range(16):
        yield [rng.uniform(-1, 1, (1, *INPUT)).astype(np.float32)]


@pytest.fixture(scope="module")
def exports(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    out = tmp_path_factory.mktemp("models")
    network = _network()
    converter = tf.lite.TFLiteConverter.from_keras_model(network)
    (out / "float.tflite").write_bytes(converter.convert())
    converter = tf.lite.TFLiteConverter.from_keras_model(network)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = _representative
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    (out / "int8.tflite").write_bytes(converter.convert())
    return {"float": out / "float.tflite", "int8": out / "int8.tflite", "dir": out}


def test_the_int8_fixture_is_full_integer(exports: dict[str, Path]) -> None:
    model = flatbuffer_utils.read_model(str(exports["int8"]))
    assert integer_activation_tensors(model), "the fixture should contain int8 tensors"


def test_int8_to_float_matches_the_original_float_model(exports: dict[str, Path]) -> None:
    target = exports["dir"] / "from_int8.tflite"
    rewrite(exports["int8"], target, ["int8-to-float", "fp16-weights"])
    assert integer_activation_tensors(flatbuffer_utils.read_model(str(target))) == []
    # Against the true float model the rewrite is closer than the int8 model it came from.
    against_float = compare(exports["float"], target, -1.0, 1.0, 12)
    against_int8 = compare(exports["int8"], target, -1.0, 1.0, 12)
    assert against_float.min_cosine > 0.99
    assert against_int8.min_cosine > 0.95


def test_fp16_weights_keep_the_float_model(exports: dict[str, Path]) -> None:
    target = exports["dir"] / "f16.tflite"
    rewrite(exports["float"], target, ["fp16-weights"])
    agreement = compare(exports["float"], target, -1.0, 1.0, 12)
    assert agreement.min_cosine > 0.999
    assert agreement.max_abs_diff < 1e-2
    model = flatbuffer_utils.read_model(str(target))
    types = {t.type for t in model.subgraphs[0].tensors}
    assert schema.TensorType.FLOAT16 in types, "FLOAT16 weights expected"


def test_rewritten_model_runs_without_delegates(exports: dict[str, Path]) -> None:
    target = exports["dir"] / "plain.tflite"
    rewrite(exports["int8"], target, ["int8-to-float", "fp16-weights"])
    interpreter = Interpreter(
        model_path=str(target),
        experimental_op_resolver_type=OpResolverType.BUILTIN_WITHOUT_DEFAULT_DELEGATES,
    )
    interpreter.allocate_tensors()
    inp = interpreter.get_input_details()[0]
    assert list(inp["shape_signature"]) == [1, *INPUT], "batch is fixed after the rewrite"
    # Zeros first: the app warms up on them. This untrained fixture has zero biases, so a
    # zero frame maps to a zero vector; a flat grey frame checks for a finite, non-zero output.
    for frame in (np.zeros(inp["shape"], np.float32), np.full(inp["shape"], 0.5, np.float32)):
        interpreter.set_tensor(inp["index"], frame)
        interpreter.invoke()
    vector = interpreter.get_tensor(interpreter.get_output_details()[0]["index"])
    assert np.isfinite(vector).all()
    assert np.linalg.norm(vector) > 0
