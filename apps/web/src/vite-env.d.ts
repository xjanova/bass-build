interface ImportMetaEnv {
  /** '1' for the public website build, which has no C# server behind it. */
  readonly VITE_STATIC?: string;
}

/** Release number from the root package.json, and the day this build was made (YYYY-MM-DD). */
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
