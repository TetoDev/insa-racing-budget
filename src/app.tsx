import { MetaProvider } from "@solidjs/meta";
import { type RouteDefinition, Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { AppProvider } from "./components/AppContext";
import { AppShell } from "./components/AppShell";
import { queryAppContext } from "./server/rpc";
import "./app.css";

export const route: RouteDefinition = {
  preload: ({ location }) => queryAppContext(location.pathname)
};

export default function App() {
  return (
    <Router
      root={props => (
        <MetaProvider>
          <AppProvider>
            <Suspense
              fallback={
                <div class="min-h-screen bg-slate-950 flex items-center justify-center text-sm text-slate-400">
                  INSA Racing — Achats &amp; Budget...
                </div>
              }
            >
              <AppShell>
                <Suspense
                  fallback={
                    <div class="flex items-center justify-center py-20 text-sm text-slate-400">
                      INSA Racing — Achats &amp; Budget...
                    </div>
                  }
                >
                  {props.children}
                </Suspense>
              </AppShell>
            </Suspense>
          </AppProvider>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
