import { Redirect } from "expo-router";

// The Menu tab opens the dock menu in place (see components/dock-menu) and never
// navigates here; the route exists only because every tab needs one. A deep
// link to it lands on Home.
export default function MenuRoute() {
  return <Redirect href="/" />;
}
