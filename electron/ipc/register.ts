/* NorthStar — IPC registrar orchestrator

   setupIPC() is called from main.ts after the shared IPC context is
   initialized. It calls each per-domain register*Ipc() in sequence so
   that every channel from the renderer is wired up before the window
   is created.
*/

import { registerStoreIpc } from "./store";
import { registerJobIpc } from "./job";
import { registerAiIpc } from "./ai";
import { registerCalendarIpc } from "./calendar";
import { registerMonthlyContextIpc } from "./monthlyContext";
import { registerModelConfigIpc } from "./modelConfig";
import { registerChatIpc } from "./chat";
import { registerReminderIpc } from "./reminder";
import { registerEnvironmentIpc } from "./environment";
import { registerMemoryIpc } from "./memory";

export function setupIPC(): void {
  registerStoreIpc();
  registerJobIpc();
  registerAiIpc();
  registerCalendarIpc();
  registerMonthlyContextIpc();
  registerModelConfigIpc();
  registerChatIpc();
  registerReminderIpc();
  registerEnvironmentIpc();
  registerMemoryIpc();
}
