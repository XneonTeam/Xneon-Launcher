// ============================================================
// XNLC — Auth Module
// Handles offline auth sessions
// Author: MAINER4IK
// ============================================================

import {
  AuthSession,
  OfflineAuth,
} from "../types/index.js";
import { generateOfflineUUID } from "../utils/index.js";

export class AuthManager {
  static createOfflineAuth(username: string): OfflineAuth {
    const uuid = generateOfflineUUID(username);
    return {
      mode: "offline",
      username,
      uuid,
      accessToken: "0",
    };
  }
  static validateAuth(auth: AuthSession): boolean {
    if (!auth.username || auth.username.trim().length === 0) return false;
    if (!auth.uuid || auth.uuid.trim().length === 0) return false;
    if (!auth.accessToken || auth.accessToken.trim().length === 0) return false;
    return true;
  }
}
