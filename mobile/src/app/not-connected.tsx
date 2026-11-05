import { Notice } from "@/components/shop-ui";
import { AuthLayout } from "@/features/auth/components/auth-layout";

/** A build without EXPO_PUBLIC_API_URL: nobody can sign in, so nothing else can open. */
export default function NotConnectedScreen() {
  return (
    <AuthLayout title="Not connected" subtitle="This copy of Mokhotsi has no server to sign in with.">
      <Notice message="Install the Mokhotsi app from your supplier, or set EXPO_PUBLIC_API_URL in a development build." />
    </AuthLayout>
  );
}
