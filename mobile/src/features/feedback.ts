import * as Haptics from "expo-haptics";

// Haptics are a nicety: an unsupported device must never break a sale.
function notify(type: Haptics.NotificationFeedbackType) {
  Haptics.notificationAsync(type).catch(() => {});
}

export const feedback = {
  success: () => notify(Haptics.NotificationFeedbackType.Success),
  warning: () => notify(Haptics.NotificationFeedbackType.Warning),
  error: () => notify(Haptics.NotificationFeedbackType.Error),
};
