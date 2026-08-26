import { translate } from "./shared/i18n/messages";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { CompactApp } from "./app/CompactApp";
import { AnalogClockApp } from "./features/analog-clock/AnalogClockApp";
import { createDefaultClient } from "./shared/ipc/client";
import { MemoryAppClient } from "./shared/ipc/memory-client";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

async function startApp() {
  if (import.meta.env.VITE_WDIO === "true") {
    await import("@wdio/tauri-plugin");
  }
  const client =
    import.meta.env.VITE_DEMO_MODE === "true" ? new MemoryAppClient() : createDefaultClient();
  const root = document.getElementById("root");
  if (root) {
    const windowName = new URLSearchParams(window.location.search).get("window");
    const isSecondaryWindow = windowName === "compact" || windowName === "analog-clock";
    document.documentElement.dataset.windowKind = isSecondaryWindow ? "secondary" : "main";
    if (isSecondaryWindow) {
      document.documentElement.dataset.window = windowName;
    } else {
      delete document.documentElement.dataset.window;
    }
    createRoot(root).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          {windowName === "compact" ? (
            <CompactApp client={client} />
          ) : windowName === "analog-clock" ? (
            <AnalogClockApp client={client} />
          ) : (
            <App
              client={client}
              notificationRuntimeEnabled={import.meta.env.VITE_WDIO !== "true"}
            />
          )}
        </QueryClientProvider>
      </StrictMode>,
    );
  } else {
    document.body.textContent = translate("main.001");
  }
}

void startApp();
