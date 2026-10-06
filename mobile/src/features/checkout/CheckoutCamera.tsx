import { useIsFocused } from 'expo-router';
import { StyleSheet } from 'react-native';
import { Camera, type CameraDevice } from 'react-native-vision-camera';

export interface CheckoutCameraProps {
  device: CameraDevice;
}

/**
 * Live preview for checkout. Inactive when the tab is not focused, to free the camera.
 *
 * TODO(feature): add the recognition pipeline as a frame output, entirely on the worklet thread:
 *   const { resizer } = useResizer({ width: 640, height: 640, channelOrder: 'rgb',
 *     dataType: 'float32', scaleMode: 'cover', pixelLayout: 'interleaved' })
 *   const frameOutput = useFrameOutput({ pixelFormat: 'yuv', onFrame(frame) { 'worklet'
 *     detect → crop → embed → index.topK → hand the result to JS; frame.dispose() } })
 *   <Camera … outputs={[frameOutput]} />
 */
export function CheckoutCamera({ device }: CheckoutCameraProps) {
  const isFocused = useIsFocused();
  return <Camera style={StyleSheet.absoluteFill} device={device} isActive={isFocused} />;
}
