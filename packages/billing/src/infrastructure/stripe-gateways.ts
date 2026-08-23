import { WorkspaceId } from "@sitedock/shared";
import {
  BalanceTransactionEntry,
  ConnectedAccountGateway,
  ReconciliationSource,
  RefundGateway,
} from "../domain/money-gateways";
import { StripeHttpClient } from "./stripe-http.client";

/**
 * Gateways REALES de Fase 16 sobre la API REST de Stripe. Toda llamada vive
 * aquí — el dominio solo ve los puertos, y los tests inyectan fakes.
 */

interface StripeAccountResponse {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  requirements?: { disabled_reason?: string | null };
}

interface StripeAccountLinkResponse {
  url: string;
  expires_at: number;
}

interface StripeRefundResponse {
  id: string;
  status: string;
}

interface StripeBalanceTransaction {
  id: string;
  amount: number;
  fee: number;
  currency: string;
  type: string;
  source?: { payment_intent?: string | null; id: string };
}

export class StripeConnectedAccountGateway implements ConnectedAccountGateway {
  constructor(private readonly http: StripeHttpClient) {}

  async createAccount(workspaceId: WorkspaceId, country: string) {
    const account = await this.http.post<StripeAccountResponse>("/accounts", {
      type: "express",
      country,
      metadata: { sitedock_workspace_id: workspaceId },
    });
    return { externalAccountId: account.id };
  }

  async createOnboardingLink(externalAccountId: string, returnUrl: string, refreshUrl: string) {
    const link = await this.http.post<StripeAccountLinkResponse>("/account_links", {
      account: externalAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });
    return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
  }

  async retrieveAccountStatus(externalAccountId: string) {
    const account = await this.http.get<StripeAccountResponse>(`/accounts/${externalAccountId}`);
    return {
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      disabledReason: account.requirements?.disabled_reason ?? undefined,
    };
  }
}

export class StripeRefundGateway implements RefundGateway {
  constructor(private readonly http: StripeHttpClient) {}

  async createRefund(params: {
    externalPaymentId: string;
    amountCents?: number;
    currency: string;
  }) {
    const refund = await this.http.post<StripeRefundResponse>("/refunds", {
      payment_intent: params.externalPaymentId,
      ...(params.amountCents !== undefined ? { amount: params.amountCents } : {}),
    });
    return {
      externalRefundId: refund.id,
      status: refund.status === "succeeded" ? "SUCCEEDED" : "PENDING",
    } as const;
  }
}

export class StripeReconciliationSource implements ReconciliationSource {
  constructor(private readonly http: StripeHttpClient) {}

  /**
   * Lista balance transactions tipo "charge" desde `createdSince`, con expand
   * del source para poder mapearlas al payment_intent que nuestro ledger usa
   * como referencia externa. Paginación simple por has_more (MVP).
   */
  async listBalanceTransactions(createdSince: Date): Promise<BalanceTransactionEntry[]> {
    const entries: BalanceTransactionEntry[] = [];
    let startingAfter: string | undefined;

    for (let page = 0; page < 20; page++) {
      const res = await this.http.get<{
        data: StripeBalanceTransaction[];
        has_more: boolean;
      }>(
        "/balance_transactions",
        {
          created: { gte: Math.floor(createdSince.getTime() / 1000) },
          limit: 100,
          "expand[]": "data.source",
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        }
      );

      for (const txn of res.data) {
        if (txn.type !== "charge") continue;
        const paymentIntentId = txn.source?.payment_intent ?? null;
        if (!paymentIntentId) continue;
        entries.push({
          externalPaymentId: paymentIntentId,
          balanceTransactionId: txn.id,
          amountCents: txn.amount,
          feeCents: txn.fee,
          currency: String(txn.currency).toUpperCase(),
        });
      }

      if (!res.has_more || res.data.length === 0) break;
      startingAfter = res.data.at(-1)?.id;
    }

    return entries;
  }
}
