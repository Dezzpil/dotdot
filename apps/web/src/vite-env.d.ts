/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** API origin; empty in production (same domain behind Caddy) */
  readonly VITE_API_BASE?: string;
}
