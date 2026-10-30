/**
 * Notification event catalog (docs/ARCHITECTURE.md §24 "Emails"). Each event
 * carries only the data its template needs — the NotificationService never
 * reaches back into other bounded contexts to fetch more.
 */
export type NotificationEvent =
  | { type: "welcome"; recipientEmail: string; fullName: string }
  | { type: "password_reset"; recipientEmail: string; resetUrl: string }
  | { type: "client_invited"; recipientEmail: string; clientName: string; workspaceName: string; inviteUrl: string }
  | { type: "checkout_created"; recipientEmail: string; websiteName: string; checkoutUrl: string; priceDecimal: string; currency: string }
  | { type: "payment_succeeded"; recipientEmail: string; websiteName: string; amountDecimal: string; currency: string }
  | { type: "payment_failed"; recipientEmail: string; websiteName: string; reason: string }
  | { type: "invoice_created"; recipientEmail: string; websiteName: string; amountDecimal: string; currency: string; dueDate: string }
  | { type: "subscription_canceled"; recipientEmail: string; websiteName: string }
  | { type: "website_suspended"; recipientEmail: string; websiteName: string }
  | { type: "website_reactivated"; recipientEmail: string; websiteName: string }
  | { type: "deployment_ready"; recipientEmail: string; websiteName: string; previewUrl: string; version: number }
  | { type: "deployment_failed"; recipientEmail: string; websiteName: string; errorMessage: string }
  | { type: "domain_expiring"; recipientEmail: string; hostname: string; daysRemaining: number; domainId: string }
  | { type: "renewal_reminder"; recipientEmail: string; websiteName: string; amountDecimal: string; currency: string; renewalDate: string; subscriptionId: string };

export type NotificationEventType = NotificationEvent["type"];
