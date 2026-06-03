// ============================================================
// XNLC — Launch Error
// Structured error class for launch pipeline failures
// ============================================================

/**
 * Represents a structured error during the Minecraft launch pipeline.
 * Can be serialized across worker IPC boundaries and deserialized
 * in the main process.
 */
export class LaunchError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "LaunchError"
  }

  /**
   * Serialize to a plain object suitable for IPC transport.
   */
  toJSON(): { name: string; code: string; message: string; details?: Record<string, unknown> } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    }
  }

  /**
   * Deserialize a plain object back into a LaunchError.
   */
  static fromJSON(data: { code: string; message: string; details?: Record<string, unknown> }): LaunchError {
    return new LaunchError(data.code, data.message, data.details)
  }

  /**
   * Wrap any unknown error into a LaunchError.
   */
  static wrap(error: unknown, code: string = "UNKNOWN"): LaunchError {
    if (error instanceof LaunchError) return error
    if (error instanceof Error) {
      return new LaunchError(code, error.message)
    }
    return new LaunchError(code, String(error))
  }
}
