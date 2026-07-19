import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { CompactApp } from "./app/CompactApp";
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
    createRoot(root).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          {new URLSearchParams(window.location.search).get("window") === "compact" ? (
            <CompactApp client={client} />
          ) : (
            <App client={client} />
          )}
        </QueryClientProvider>
      </StrictMode>,
    );
  } else {
    document.body.textContent =
      "Day Schedule Next の画面を開始できませんでした。再起動してください。";
  }
}

void startApp();
