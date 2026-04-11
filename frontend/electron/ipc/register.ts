/* NorthStar — IPC registrar orchestrator
 *
 * Phase 13: most IPC channels were deleted because they now live on the
 * cloud backend. The only handlers that remain are ones with no cloud
 * equivalent (device calendar access, environment info, runtime model
 * overrides).
 */

import { registerCalendarIpc } from "./calendar";
import { registerEnvironmentIpc } from "./environment";

export function setupIPC(): void {
  registerCalendarIpc();
  registerEnvironmentIpc();
}
