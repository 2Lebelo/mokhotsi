# ml/artifacts

Export outputs land here (`detector.tflite`, `embedder_f16.tflite`, `manifest.json`, eval reports).
Everything except this README and `.gitkeep` is git-ignored. Copy finished models into `mobile/assets/models/`.

Ship float-activation models only. Full-integer (int8 activation) exports load but fail their
first inference on some phones' LiteRT runtimes (seen on a 32-bit Galaxy A02). Run any such
export through `scripts/make_float_models.py` (`--pass int8-to-float --pass fp16-weights`);
`tests/test_shipped_models.py` rejects integer activation tensors in the bundled files.
