/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "false" strips the NovaStar exports. See src/config/features.ts. */
  readonly VITE_NOVASTAR_EXPORTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
