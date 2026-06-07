/**
 * Backward compatibility shim.
 * "Chess Results" integration was renamed to "Webhook Sync".
 * This module re-exports the equivalent webhook sync functions under the
 * legacy names so existing call sites continue to compile without changes.
 */
export {
  initializeWebhookSchedulers as initializeChessResultsSchedulers,
  syncWebhook as syncChessResults,
  testWebhookConnection as testChessResultsConnection,
  updateWebhookScheduler as updateChessResultsScheduler,
} from "./webhookSync";
