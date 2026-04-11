/* NorthStar — auth token source
 *
 * The renderer never hardcodes a token at the call site. Every HTTP request
 * to the cloud API reads it from here. Phase 1 returns a fixed dev token;
 * phase 2 will swap this for a real JWT read from macOS Keychain via the
 * Electron `safeStorage` bridge, with no other code changes.
 *
 * Keeping this in one function is the same pattern as the server's
 * authMiddleware: a single source of truth for "who is the current user".
 */

/**
 * Returns the bearer token to send with cloud API requests.
 *
 * Phase 1: hardcoded "sophie" — matches the server's DEV_USER_ID secret.
 * Phase 2: read a JWT from secure storage (Keychain).
 */
export function getAuthToken(): string {
  return "sophie";
}
