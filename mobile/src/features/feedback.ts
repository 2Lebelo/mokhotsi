import * as Haptics from "expo-haptics";

import { beep } from "@/features/scan-beep";

// Haptics are a nicety: an unsupported device must never break a sale.
function notify(type: Haptics.NotificationFeedbackType) {
  Haptics.notificationAsync(type).catch(() => {});
}

export const feedback = {
  success: () => notify(Haptics.NotificationFeedbackType.Success),
  warning: () => notify(Haptics.NotificationFeedbackType.Warning),
  error: () => notify(Haptics.NotificationFeedbackType.Error),
  /** A product was identified (scanned barcode or a visual lock). */
  beep,
};
