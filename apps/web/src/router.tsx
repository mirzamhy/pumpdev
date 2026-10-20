import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });
// The token page pulls in React Flow; load it only when needed so the home page stays light.
const tokenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/token/$mint",
  component: lazyRouteComponent(() => import("./pages/TokenPage"), "TokenPage"),
});
const walletRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wallet/$address",
  component: lazyRouteComponent(() => import("./pages/WalletPage"), "WalletPage"),
});

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, tokenRoute, walletRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
