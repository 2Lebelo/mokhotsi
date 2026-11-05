import { ApiError } from "@/api/client";
import { errorMessage } from "@/components/shop-ui";

const MESSAGES: Record<string, string> = {
  invalid_credentials: "That phone number and PIN don't match.",
  account_locked: "Too many wrong PINs. Wait a little and try again.",
  registration_rejected: "Your registration was not approved. Contact Mokhotsi for help.",
  account_disabled: "This account is disabled. Contact Mokhotsi for help.",
  phone_taken: "This phone number is already registered. Sign in instead.",
  invalid_phone: "Enter your 8-digit phone number.",
  invalid_current_pin: "Your current PIN is not right.",
  pin_reused: "Choose a PIN different from the one you have.",
  pin_taken: "Someone in your shop already uses that PIN. Choose another.",
};

/** What to tell the person when sign-in, registration or a PIN change is refused. */
export function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "rate_limited") return "Too many attempts.";
    return MESSAGES[error.code] ?? error.message;
  }
  return errorMessage(error);
}

/** When the person may try again, if the server said (429/423 with Retry-After). */
export function retryAt(error: unknown, now: number): number | null {
  return error instanceof ApiError && error.retryAfterMs ? now + error.retryAfterMs : null;
}
