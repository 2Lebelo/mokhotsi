import * as SecureStore from "expo-secure-store";

import type { KeyValueStore } from "./secrets.ts";

// The only module that imports expo-secure-store. Android keeps these in the Keystore, and
// they are not restored from a backup (the config plugin's default), so a restored phone
// registers again rather than sharing another phone's identity.
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secureStore: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key, options),
  set: (key, value) => SecureStore.setItemAsync(key, value, options),
  delete: (key) => SecureStore.deleteItemAsync(key, options),
};
