import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Camera, useFrameOutput, type CameraDevice, type Frame } from 'react-native-vision-camera';
import { useResizer } from 'react-native-vision-camera-resizer';
import { scheduleOnRN } from 'react-native-worklets';

import { detect, detectorResizerOptions, type DetectorContext } from '@/ml/detector';

import { createDetectionStore, type DetectionStore } from './detectionStore';
import { useDetector, type DetectorState } from './useDetector';

export interface CheckoutCameraProps {
  device: CameraDevice;
}

/**
 * The resizer needs YUV on iOS; on Android it accepts the camera's native (private) format directly,
 * which avoids a conversion in the camera pipeline.
 */
const PIXEL_FORMAT = Platform.OS === 'ios' ? 'yuv' : 'native';

/**
 * Live preview for checkout. Inactive when the tab is not focused, to free the camera.
 * Runs stage 1 (detection) on every frame once the detector has loaded.
 *
 * TODO(feature): stage 2 in the same worklet: crop the detected box → embed → index.topK → hand the
 * match to JS. crop() must read the GPU frame before detect() disposes it, so move that dispose here.
 */
export function CheckoutCamera({ device }: CheckoutCameraProps) {
  const isFocused = useIsFocused();
  const detector = useDetector();
  const store = useMemo(() => createDetectionStore(), []);

  return (
    <View style={StyleSheet.absoluteFill}>
      {detector.state === 'ready' ? (
        <DetectingCamera device={device} isActive={isFocused} detector={detector} store={store} />
      ) : (
        <Camera style={StyleSheet.absoluteFill} device={device} isActive={isFocused} />
      )}
      <DetectionHud detector={detector} store={store} />
    </View>
  );
}

interface DetectingCameraProps {
  device: CameraDevice;
  isActive: boolean;
  detector: Extract<DetectorState, { state: 'ready' }>;
  store: DetectionStore;
}

function DetectingCamera({ device, isActive, detector, store }: DetectingCameraProps) {
  const { model, spec, channels } = detector;
  const resizerOptions = useMemo(() => detectorResizerOptions(spec), [spec]);
  const { resizer, error: resizerError } = useResizer(resizerOptions);
  const { publish, publishError } = store;

  useEffect(() => {
    if (resizerError) publishError(`GPU resizer unavailable: ${resizerError.message}`);
  }, [resizerError, publishError]);

  const ctx = useMemo<DetectorContext | null>(
    () => (resizer ? { model, resizer, spec, channels } : null),
    [model, resizer, spec, channels],
  );

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      try {
        if (ctx == null) return;
        const start = Date.now();
        const box = detect(frame, ctx);
        scheduleOnRN(publish, box, Date.now() - start);
      } catch (e) {
        scheduleOnRN(publishError, e instanceof Error ? e.message : String(e));
      } finally {
        frame.dispose();
      }
    },
    [ctx, publish, publishError],
  );

  const frameOutput = useFrameOutput({
    pixelFormat: PIXEL_FORMAT,
    // The model sees 640×640; full-resolution buffers would only cost memory bandwidth.
    enablePreviewSizedOutputBuffers: true,
    onFrame,
  });
  const outputs = useMemo(() => [frameOutput], [frameOutput]);

  return <Camera style={StyleSheet.absoluteFill} device={device} isActive={isActive} outputs={outputs} />;
}

/** Live stage-1 readout on the preview, so integration can be checked on a device. */
function DetectionHud({ detector, store }: { detector: DetectorState; store: DetectionStore }) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);

  let text: string;
  if (detector.state === 'loading') text = 'Detector loading…';
  else if (detector.state === 'unavailable') text = 'Detector not bundled';
  else if (detector.state === 'error') text = `Detector failed: ${detector.message}`;
  else if (snap.error) text = `Detection error: ${snap.error}`;
  else if (snap.fps === 0 && snap.box === null) text = 'Detector ready · waiting for frames';
  else {
    const what = snap.box
      ? `Item ${snap.box.score.toFixed(2)} · ${Math.round(snap.box.width * 100)}×${Math.round(snap.box.height * 100)}%`
      : 'No item';
    text = `${what} · ${snap.latencyMs} ms · ${snap.fps} fps`;
  }

  return (
    <View style={styles.hud} pointerEvents="none">
      <Text style={styles.hudText} accessibilityLiveRegion="polite">
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hud: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    right: 12,
    alignItems: 'flex-start',
  },
  hudText: {
    fontSize: 13,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
});
