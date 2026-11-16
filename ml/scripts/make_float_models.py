"""Rewrite a shipped LiteRT model so it runs on every Android CPU.

Full-integer (int8 activation) models fail to invoke on some phones' LiteRT runtimes
(seen on a 32-bit Galaxy A02: "TFLite: Failed to run TFLite Model! Status: error"),
while the plain float kernels have worked on every phone tried. This script keeps the
trained weights and produces what the converter's float16 path would have produced:

  int8-to-float   Drop QUANTIZE / DEQUANTIZE, dequantize int8 weights and int32 biases to
                  float32 and make every activation float32: the same function in float.
  fp16-weights    Store conv / depthwise / fully-connected weights and biases as float16
                  behind DEQUANTIZE ops (what `target_spec.supported_types=[tf.float16]`
                  emits). Halves the file; the runtime still computes in float32.

Both passes are pure flatbuffer rewrites: no retraining and no source weights needed.
The result is always run against `--reference` (default: the input) on seeded inputs, with
the default and the delegate-free op resolvers, and the agreement is printed; `--min-cosine`
and `--max-abs-diff` turn that into a pass/fail.

Examples (from ml/):
  python scripts/make_float_models.py --in embedder_int8.tflite --out embedder_f16.tflite
      --pass int8-to-float --pass fp16-weights --input-range -1 1 --min-cosine 0.98
  python scripts/make_float_models.py --in detector_fp32.tflite --out detector.tflite
      --pass fp16-weights --input-range 0 1 --max-abs-diff 0.01
"""

from __future__ import annotations

import argparse
import hashlib
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter, OpResolverType
from tensorflow.lite.python import schema_py_generated as schema
from tensorflow.lite.tools import flatbuffer_utils

Op = schema.BuiltinOperator
TensorType = schema.TensorType
WEIGHT_OPS = frozenset({Op.CONV_2D, Op.DEPTHWISE_CONV_2D, Op.FULLY_CONNECTED})
INTEGER_ACTIVATION_TYPES = frozenset({TensorType.INT8, TensorType.UINT8, TensorType.INT16})
# The converter emits DEQUANTIZE version 3 for float16 weights.
FP16_DEQUANTIZE_VERSION = 3
PASSES = ("int8-to-float", "fp16-weights")


# --- flatbuffer helpers -------------------------------------------------------------


def builtin_code(model: schema.ModelT, op: schema.OperatorT) -> int:
    code = model.operatorCodes[op.opcodeIndex]
    return max(code.builtinCode, code.deprecatedBuiltinCode)


def has_data(model: schema.ModelT, tensor: schema.TensorT) -> bool:
    data = model.buffers[tensor.buffer].data
    return data is not None and len(data) > 0


def tensor_array(model: schema.ModelT, tensor: schema.TensorT, dtype: type) -> np.ndarray:
    raw = np.asarray(model.buffers[tensor.buffer].data, dtype=np.uint8)
    return raw.view(dtype).reshape([int(n) for n in tensor.shape])


def buffer_refcounts(model: schema.ModelT) -> dict[int, int]:
    counts: dict[int, int] = {}
    for sg in model.subgraphs:
        for tensor in sg.tensors:
            counts[int(tensor.buffer)] = counts.get(int(tensor.buffer), 0) + 1
    return counts


def set_data(
    model: schema.ModelT, tensor: schema.TensorT, values: np.ndarray, refcounts: dict[int, int]
) -> None:
    """Replaces a constant's bytes; a buffer shared with another tensor is split first."""
    if refcounts.get(int(tensor.buffer), 0) > 1:
        refcounts[int(tensor.buffer)] -= 1
        model.buffers.append(schema.BufferT())
        tensor.buffer = len(model.buffers) - 1
        refcounts[int(tensor.buffer)] = 1
    model.buffers[tensor.buffer].data = np.frombuffer(values.tobytes(), dtype=np.uint8).copy()


def is_quantized(tensor: schema.TensorT) -> bool:
    q = tensor.quantization
    return q is not None and q.scale is not None and len(q.scale) > 0


def dequantize(model: schema.ModelT, tensor: schema.TensorT) -> np.ndarray:
    """(q - zero_point) * scale, per tensor or per channel along `quantizedDimension`."""
    if not is_quantized(tensor):
        raise ValueError(f"{tensor.name!r} is an integer constant without a quantization scale")
    q = tensor.quantization
    dtype = {TensorType.INT8: np.int8, TensorType.INT32: np.int32}[tensor.type]
    values = tensor_array(model, tensor, dtype).astype(np.float64)
    scale = np.asarray(q.scale, dtype=np.float64)
    zero = np.asarray(q.zeroPoint, dtype=np.float64) if q.zeroPoint is not None else np.zeros(1)
    if zero.size == 0:
        zero = np.zeros(1)
    if scale.size > 1:
        shape = [1] * values.ndim
        shape[q.quantizedDimension] = scale.size
        scale = scale.reshape(shape)
        if zero.size == scale.size:
            zero = zero.reshape(shape)
    return ((values - zero) * scale).astype(np.float32)


def prune_opcodes(model: schema.ModelT) -> None:
    used = sorted({int(op.opcodeIndex) for sg in model.subgraphs for op in sg.operators})
    remap = {old: new for new, old in enumerate(used)}
    model.operatorCodes = [model.operatorCodes[i] for i in used]
    for sg in model.subgraphs:
        for op in sg.operators:
            op.opcodeIndex = remap[int(op.opcodeIndex)]


def opcode_index(model: schema.ModelT, code: int, version: int) -> int:
    for i, existing in enumerate(model.operatorCodes):
        builtin = max(existing.builtinCode, existing.deprecatedBuiltinCode)
        if builtin == code and existing.version == version:
            return i
    entry = schema.OperatorCodeT()
    entry.builtinCode = code
    entry.deprecatedBuiltinCode = min(code, 127)
    entry.version = version
    model.operatorCodes.append(entry)
    return len(model.operatorCodes) - 1


def empty_buffer(model: schema.ModelT) -> int:
    model.buffers.append(schema.BufferT())
    return len(model.buffers) - 1


def single_subgraph(model: schema.ModelT) -> schema.SubGraphT:
    if len(model.subgraphs) != 1:
        raise ValueError(f"expected one subgraph, found {len(model.subgraphs)}")
    return model.subgraphs[0]


# --- pass: int8-to-float -----------------------------------------------------------


def int8_to_float(model: schema.ModelT) -> None:
    sg = single_subgraph(model)
    alias: dict[int, int] = {}

    def resolve(index: int) -> int:
        while index in alias:
            index = alias[index]
        return index

    kept: list[schema.OperatorT] = []
    for op in sg.operators:
        code = builtin_code(model, op)
        if code not in (Op.QUANTIZE, Op.DEQUANTIZE):
            kept.append(op)
            continue
        src, dst = sg.tensors[int(op.inputs[0])], sg.tensors[int(op.outputs[0])]
        expected = (
            (TensorType.FLOAT32, TensorType.INT8)
            if code == Op.QUANTIZE
            else (TensorType.INT8, TensorType.FLOAT32)
        )
        if (src.type, dst.type) != expected:
            raise ValueError(
                f"only float<->int8 (de)quantize ops are handled, found {src.type}->{dst.type}"
            )
        alias[int(op.outputs[0])] = int(op.inputs[0])

    def remap(indices: Iterable[int]) -> np.ndarray:
        return np.array([resolve(int(i)) if i >= 0 else -1 for i in indices], dtype=np.int32)

    for op in kept:
        op.inputs = remap(op.inputs)
        op.outputs = remap(op.outputs)
    sg.inputs = remap(sg.inputs)
    sg.outputs = remap(sg.outputs)
    for signature in model.signatureDefs or []:
        for mapping in list(signature.inputs or []) + list(signature.outputs or []):
            mapping.tensorIndex = resolve(int(mapping.tensorIndex))
    sg.operators = kept

    refcounts = buffer_refcounts(model)
    for tensor in sg.tensors:
        if tensor.type == TensorType.INT8 and has_data(model, tensor):
            set_data(model, tensor, dequantize(model, tensor), refcounts)  # weights
        elif tensor.type == TensorType.INT32 and has_data(model, tensor) and is_quantized(tensor):
            set_data(model, tensor, dequantize(model, tensor), refcounts)  # biases
        elif tensor.type != TensorType.INT8:
            tensor.shapeSignature = None  # a fixed batch of one, like the float exports
            continue
        tensor.type = TensorType.FLOAT32
        tensor.quantization = None
        tensor.shapeSignature = None
    prune_opcodes(model)


# --- pass: fp16-weights ------------------------------------------------------------


def fp16_weights(model: schema.ModelT) -> None:
    sg = single_subgraph(model)
    dequantize_op = opcode_index(model, Op.DEQUANTIZE, FP16_DEQUANTIZE_VERSION)
    no_data = empty_buffer(model)
    converted: dict[int, int] = {}  # constant tensor -> its float32 dequantized tensor
    dequantize_ops: list[schema.OperatorT] = []
    refcounts = buffer_refcounts(model)
    limit = float(np.finfo(np.float16).max)
    for op in sg.operators:
        if builtin_code(model, op) not in WEIGHT_OPS:
            continue
        for slot in (1, 2):  # weights, bias
            if slot >= len(op.inputs) or op.inputs[slot] < 0:
                continue
            index = int(op.inputs[slot])
            if index in converted:  # a constant shared by several ops (e.g. a zero bias)
                op.inputs[slot] = converted[index]
                continue
            tensor = sg.tensors[index]
            if tensor.type != TensorType.FLOAT32 or not has_data(model, tensor):
                continue
            values = tensor_array(model, tensor, np.float32)
            if float(np.abs(values).max()) > limit:
                raise ValueError(f"{tensor.name!r} has values beyond the float16 range")
            set_data(model, tensor, values.astype(np.float16), refcounts)
            tensor.type = TensorType.FLOAT16
            full = schema.TensorT()
            full.shape = np.array(tensor.shape, dtype=np.int32)
            full.type = TensorType.FLOAT32
            full.buffer = no_data
            full.name = (tensor.name or b"weights") + b"_dequantized"
            sg.tensors.append(full)
            deq = schema.OperatorT()
            deq.opcodeIndex = dequantize_op
            deq.inputs = np.array([index], dtype=np.int32)
            deq.outputs = np.array([len(sg.tensors) - 1], dtype=np.int32)
            dequantize_ops.append(deq)
            converted[index] = len(sg.tensors) - 1
            op.inputs[slot] = converted[index]
    sg.operators = dequantize_ops + list(sg.operators)


# --- checks ------------------------------------------------------------------------


def integer_activation_tensors(model: schema.ModelT) -> list[str]:
    sg = single_subgraph(model)
    return [str(t.name) for t in sg.tensors if t.type in INTEGER_ACTIVATION_TYPES]


# Constant frames come first: they exercise the zero-input warm-up the app does, but their
# embeddings are near-degenerate (quantisation noise dominates), so they count towards the
# max abs difference only, not the cosine gate.
CONSTANT_FRAMES = 3


def sample_inputs(shape: list[int], low: float, high: float, count: int) -> list[np.ndarray]:
    """Constant frames plus low-frequency noise: closer to camera frames than white noise."""
    rng = np.random.default_rng(0)
    samples = [np.full(shape, v, dtype=np.float32) for v in (0.0, low, high)]
    spatial = sorted(range(len(shape)), key=lambda axis: shape[axis], reverse=True)[:2]
    while len(samples) < count:
        small = list(shape)
        for axis in spatial:
            if shape[axis] % 16 == 0:
                small[axis] = shape[axis] // 16
        noise = rng.uniform(low, high, small).astype(np.float32)
        for axis in spatial:
            noise = np.repeat(noise, shape[axis] // small[axis], axis=axis)
        samples.append(noise)
    return samples[:count]


def run_model(path: Path, inputs: list[np.ndarray], resolver: OpResolverType) -> list[np.ndarray]:
    interpreter = Interpreter(model_path=str(path), experimental_op_resolver_type=resolver)
    interpreter.allocate_tensors()
    inp = interpreter.get_input_details()[0]
    out = interpreter.get_output_details()[0]
    results = []
    for x in inputs:
        interpreter.set_tensor(inp["index"], x)
        interpreter.invoke()
        results.append(interpreter.get_tensor(out["index"]).astype(np.float64).copy())
    return results


@dataclass(frozen=True)
class Agreement:
    min_cosine: float
    max_abs_diff: float


def compare(reference: Path, candidate: Path, low: float, high: float, samples: int) -> Agreement:
    interpreter = Interpreter(model_path=str(candidate))
    shape = [int(n) for n in interpreter.get_input_details()[0]["shape"]]
    inputs = sample_inputs(shape, low, high, samples)
    expected = run_model(reference, inputs, OpResolverType.AUTO)
    min_cosine, max_abs = 1.0, 0.0
    for resolver in (OpResolverType.AUTO, OpResolverType.BUILTIN_WITHOUT_DEFAULT_DELEGATES):
        actual = run_model(candidate, inputs, resolver)
        for i, (want, got) in enumerate(zip(expected, actual, strict=True)):
            a, b = want.ravel(), got.ravel()
            max_abs = max(max_abs, float(np.abs(a - b).max()))
            if i < CONSTANT_FRAMES:
                continue
            denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
            cosine = float(a @ b) / denominator if denominator > 0 else 1.0
            min_cosine = min(min_cosine, cosine)
    return Agreement(min_cosine, max_abs)


# --- CLI ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--in", dest="source", type=Path, required=True)
    parser.add_argument("--out", dest="target", type=Path, required=True)
    parser.add_argument(
        "--pass",
        dest="passes",
        action="append",
        choices=PASSES,
        required=True,
        help="rewrite pass; repeat to chain (applied in the order given)",
    )
    parser.add_argument(
        "--reference",
        type=Path,
        default=None,
        help="model to agree with on sampled inputs (default: --in)",
    )
    parser.add_argument(
        "--input-range", type=float, nargs=2, default=(0.0, 1.0), metavar=("LOW", "HIGH")
    )
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--min-cosine", type=float, default=None)
    parser.add_argument("--max-abs-diff", type=float, default=None)
    return parser.parse_args()


def rewrite(source: Path, target: Path, passes: Iterable[str]) -> None:
    model = flatbuffer_utils.read_model(str(source))
    for name in passes:
        {"int8-to-float": int8_to_float, "fp16-weights": fp16_weights}[name](model)
    leftover = integer_activation_tensors(model)
    if leftover:
        raise ValueError(f"integer tensors remain after rewriting: {leftover[:5]}")
    target.parent.mkdir(parents=True, exist_ok=True)
    flatbuffer_utils.write_model(model, str(target))


def main() -> None:
    args = parse_args()
    rewrite(args.source, args.target, args.passes)
    digest = hashlib.sha256(args.target.read_bytes()).hexdigest()
    print(f"{args.target}: {args.target.stat().st_size:,} bytes, sha256 {digest}")
    low, high = args.input_range
    reference = args.reference or args.source
    agreement = compare(reference, args.target, low, high, args.samples)
    print(
        f"agreement with {reference} on {args.samples} inputs: "
        f"min cosine {agreement.min_cosine:.5f}, max abs diff {agreement.max_abs_diff:.5f}"
    )
    if args.min_cosine is not None and agreement.min_cosine < args.min_cosine:
        raise SystemExit(f"cosine {agreement.min_cosine:.5f} is below {args.min_cosine}")
    if args.max_abs_diff is not None and agreement.max_abs_diff > args.max_abs_diff:
        raise SystemExit(f"max abs diff {agreement.max_abs_diff:.5f} is above {args.max_abs_diff}")


if __name__ == "__main__":
    main()
