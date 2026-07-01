/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the server-side Gemini proxy Function URL. */
  readonly VITE_PROXY_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
