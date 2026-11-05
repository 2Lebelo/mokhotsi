import * as Device from "expo-device";
import { Platform } from "react-native";

import type { DeviceRef } from "@/api/endpoints";
import type { NewDevice } from "@/api/types";
import type { Secrets } from "@/auth/secrets";
import type { DeviceRepository } from "@/db/device/repository";

/** How this phone introduces itself when it registers. */
export function newDevice(): NewDevice {
  return {
    name: (Device.deviceName || Device.modelName || "Phone").slice(0, 60),
    platform: Platform.OS === "ios" ? "ios" : "android",
  };
}

/** The phone's credential if it is registered (and not revoked), otherwise a registration. */
export async function deviceRef(
  secrets: Secrets,
  device: DeviceRepository,
): Promise<DeviceRef> {
  const credential = device.isRevoked() ? null : await secrets.deviceCredential();
  return credential ?? newDevice();
}
