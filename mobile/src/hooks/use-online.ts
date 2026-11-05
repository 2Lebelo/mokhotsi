import { useNetInfo } from "@react-native-community/netinfo";

/**
 * Whether the phone can reach the internet. Unknown counts as online, so a slow first check
 * never blocks anyone; the request itself then says if it could not connect.
 */
export function useOnline(): boolean {
  const { isConnected, isInternetReachable } = useNetInfo();
  return isConnected !== false && isInternetReachable !== false;
}
