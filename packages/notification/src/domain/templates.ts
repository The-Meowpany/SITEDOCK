import { NotificationEvent } from "./notification-event";

export interface RenderedEmail {
  to: string;
  subject: string;
  body: string;
}

/**
 * Pure, side-effect-free template rendering — one function per event type, all
 * exhaustively switched so adding a new NotificationEvent variant without a
 * matching case is a compile error. No HTML engine needed for MVP (plain text
 * is enough; a production EmailProvider can wrap this in HTML separately).
 */
export function renderEmail(event: NotificationEvent): RenderedEmail {
  switch (event.type) {
    case "welcome":
      return {
        to: event.recipientEmail,
        subject: "Welcome to SiteDock",
        body: `Hi ${event.fullName}, your SiteDock account is ready. Let's turn your next website into recurring revenue.`,
      };

    case "client_invited":
      return {
        to: event.recipientEmail,
        subject: `${event.workspaceName} invited you to SiteDock`,
        body: `Hi ${event.clientName}, you've been invited to manage your website with ${event.workspaceName}. Accept your invite: ${event.inviteUrl}`,
      };

    case "checkout_created":
      return {
        to: event.recipientEmail,
        subject: `Activate "${event.websiteName}" — ${event.priceDecimal} ${event.currency}/month`,
        body: `Your website "${event.websiteName}" is ready. Complete your subscription here: ${event.checkoutUrl}`,
      };

    case "payment_succeeded":
      return {
        to: event.recipientEmail,
        subject: `Payment received for "${event.websiteName}"`,
        body: `We received your payment of ${event.amountDecimal} ${event.currency}. Your website is now active.`,
      };

    case "payment_failed":
      return {
        to: event.recipientEmail,
        subject: `Payment failed for "${event.websiteName}"`,
        body: `We couldn't process your payment (${event.reason}). Please update your payment method to avoid service interruption.`,
      };

    case "invoice_created":
      return {
        to: event.recipientEmail,
        subject: `New invoice for "${event.websiteName}"`,
        body: `An invoice of ${event.amountDecimal} ${event.currency} is due on ${event.dueDate}.`,
      };

    case "subscription_canceled":
      return {
        to: event.recipientEmail,
        subject: `Subscription canceled for "${event.websiteName}"`,
        body: `Your subscription for "${event.websiteName}" has been canceled.`,
      };

    case "website_suspended":
      return {
        to: event.recipientEmail,
        subject: `"${event.websiteName}" has been suspended`,
        body: `Your website "${event.websiteName}" was suspended due to a failed payment. Update your payment method to reactivate it.`,
      };

    case "website_reactivated":
      return {
        to: event.recipientEmail,
        subject: `"${event.websiteName}" is live again`,
        body: `Good news — your payment went through and "${event.websiteName}" is live again.`,
      };

    case "deployment_ready":
      return {
        to: event.recipientEmail,
        subject: `Preview ready for "${event.websiteName}" (v${event.version})`,
        body: `A new version of "${event.websiteName}" is ready to review: ${event.previewUrl}`,
      };

    case "deployment_failed":
      return {
        to: event.recipientEmail,
        subject: `Deployment failed for "${event.websiteName}"`,
        body: `The latest deployment for "${event.websiteName}" failed: ${event.errorMessage}`,
      };

    case "domain_expiring":
      return {
        to: event.recipientEmail,
        subject: `"${event.hostname}" expires in ${event.daysRemaining} days`,
        body: `Your domain "${event.hostname}" is expiring soon. Renew it to avoid downtime.`,
      };

    case "renewal_reminder":
      return {
        to: event.recipientEmail,
        subject: `"${event.websiteName}" renews on ${event.renewalDate}`,
        body: `Heads up — your subscription for "${event.websiteName}" (${event.amountDecimal} ${event.currency}) renews on ${event.renewalDate}. No action needed if your payment method is up to date.`,
      };
  }
}
