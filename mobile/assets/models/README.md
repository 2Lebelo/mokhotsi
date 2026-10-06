# On-device models

The app expects the files named in `manifest.json` in this folder:

| File              | Produced by                     | Input     | Output                    |
| ----------------- | ------------------------------- | --------- | ------------------------- |
| `detector.tflite` | `ml/scripts/export_detector.py` | 640×640×3 | YOLOv8n detections        |
| `embedder.tflite` | `ml/scripts/export_embedder.py` | 224×224×3 | 1280-d MobileNetV2 vector |

`.tflite` files are tracked with **Git LFS** (see the root `.gitattributes`). Run `git lfs install` once per machine.

## Adding or replacing models

1. Run the export scripts in `ml/`. They write the `.tflite` files **and** a `manifest.json` in the shape `src/ml/manifest.ts` validates.
2. Copy both into this folder.
3. Run `npm run models:sync`. It regenerates `src/ml/modelAssets.generated.ts` so Metro bundles only the files that exist. `npm start` and `npm run android` run it for you.
4. Rebuild or reload the app.

If a file is missing, the app still starts. The Sell and Debug screens show which model is missing instead of crashing.
