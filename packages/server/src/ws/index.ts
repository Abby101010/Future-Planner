/* NorthStar server — ws/ barrel
 *
 * Public surface of the WebSocket transport. Route handlers should
 * import event emitters from here; startup code pulls in
 * `attachWebSocketServer` and (optionally) the registry singleton.
 */

export { attachWebSocketServer } from "./server";
export {
  ConnectionRegistry,
  connectionRegistry,
} from "./connections";
export {
  emitAiStreamStart,
  emitAiTokenDelta,
  emitAiStreamEnd,
  emitAgentProgress,
  emitAgentCritique,
  emitViewInvalidate,
  emitReminderTriggered,
} from "./events";
export type {
  AiStreamStartPayload,
  AiTokenDeltaPayload,
  AiStreamEndPayload,
  AgentProgressPayload,
  AgentCritiquePayload,
  CritiqueIssue,
  ViewInvalidatePayload,
  ReminderTriggeredPayload,
} from "./events";
