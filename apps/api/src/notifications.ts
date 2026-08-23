import { createEmailProviderFromEnv, NotificationService, PrismaNotificationLogRepository } from "@sitedock/notification";
import { logger } from "./logger";

// Singleton per process, same pattern as the payment/domain provider singletons
// (docs/ARCHITECTURE.md §45 "Demo Mode"). Swapped for a ResendEmailProvider in
// production without touching any call site below.
const emailProvider = createEmailProviderFromEnv().provider;
const notificationLog = new PrismaNotificationLogRepository();

export const notificationService = new NotificationService(emailProvider, notificationLog);

/**
 * Fire-and-forget wrapper: a notification failure should never fail the
 * request that triggered it (a registration, a webhook ACK, a deployment).
 * NotificationService already logs failures with sentAt: null internally.
 */
export function notifyBestEffort(event: Parameters<NotificationService["notify"]>[0]) {
  notificationService.notify(event).catch((err) => {
    logger.warn({ err, eventType: event.type }, "Notification failed to send");
  });
}

