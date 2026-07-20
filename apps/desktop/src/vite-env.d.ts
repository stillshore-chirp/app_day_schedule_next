/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_MODE?: "true" | "false";
  readonly VITE_WDIO?: "true" | "false";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
