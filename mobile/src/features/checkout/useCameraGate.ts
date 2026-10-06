import { useCameraDevice, useCameraPermission, type CameraDevice } from 'react-native-vision-camera';

export interface CameraGate {
  hasPermission: boolean;
  /** False once the user has denied; they must then enable it in system Settings. */
  canRequestPermission: boolean;
  requestPermission: () => Promise<boolean>;
  /** Back camera, or undefined while devices load / on devices without one. */
  device: CameraDevice | undefined;
}

/** Camera permission + back-camera device for the sell (checkout) screen. */
export function useCameraGate(): CameraGate {
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  return { hasPermission, canRequestPermission, requestPermission, device };
}
