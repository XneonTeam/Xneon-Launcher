// ============================================================
// XNLC — Prism Meta Client Singleton
// Ensures only one PrismMetaClient instance exists across the app
// ============================================================

import { PrismMetaClient } from "./prism-meta-client.js";

let instance: PrismMetaClient | null = null;

/**
 * Returns the shared PrismMetaClient singleton instance.
 * Creates it on first call.
 */
export function getPrismMetaClient(): PrismMetaClient {
  if (!instance) instance = new PrismMetaClient();
  return instance;
}
