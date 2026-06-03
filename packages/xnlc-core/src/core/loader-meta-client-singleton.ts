// ============================================================
// XNLC — Loader Meta Client Singleton
// Ensures only one LoaderMetaClient instance exists across the app
// ============================================================

import { LoaderMetaClient } from "./loader-meta-client.js";

let instance: LoaderMetaClient | null = null;

/**
 * Returns the shared LoaderMetaClient singleton instance.
 * Creates it on first call.
 */
export function getLoaderMetaClient(): LoaderMetaClient {
  if (!instance) instance = new LoaderMetaClient();
  return instance;
}
