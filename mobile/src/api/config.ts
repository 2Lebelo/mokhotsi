/**
 * Where the API lives. Set EXPO_PUBLIC_API_URL (e.g. in mobile/.env) to the server's base URL,
 * such as https://api.mokhotsi.co.ls. Without it the app runs offline-only, as before
 * registration, and the account screens say so.
 */
export const API_URL: string | null = process.env.EXPO_PUBLIC_API_URL?.trim() || null;
