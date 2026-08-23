import { randomUUID } from "node:crypto";
import { WorkspaceId } from "@sitedock/shared";
import {
  ConnectedAccountGateway,
  ConnectedAccountState,
} from "../domain/money-gateways";

// ── Puerto de persistencia (infraestructura Prisma lo implementa) ──

export type ConnectedAccountStatus = "PENDING_ONBOARDING" | "ACTIVE" | "RESTRICTED" | "DISCONNECTED";

export interface ConnectedAccountRecord {
  id: string;
  workspaceId: string;
  provider: string;
  externalAccountId: string;
  status: ConnectedAccountStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardedAt: Date | null;
}

export interface ConnectedAccountRepository {
  findByWorkspaceId(workspaceId: WorkspaceId): Promise<ConnectedAccountRecord | null>;
  findByExternalAccountId(externalAccountId: string): Promise<ConnectedAccountRecord | null>;
  save(account: ConnectedAccountRecord): Promise<void>;
}

// ── Casos de uso ─────────────────────────────────────────

/**
 * Inicia el onboarding del merchant (freelancer) con Stripe Connect Express:
 * crea la cuenta conectada si no existe y devuelve el link hosted de KYC/KYB.
 * SiteDock nunca toca documentos del merchant — eso vive en Stripe.
 */
export class StartMerchantOnboardingUseCase {
  constructor(
    private readonly accounts: ConnectedAccountRepository,
    private readonly gateway: ConnectedAccountGateway
  ) {}

  async execute(params: {
    workspaceId: string;
    country?: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ accountId: string; onboarded: boolean; url: string }> {
    const workspaceId = WorkspaceId(params.workspaceId);
    const existing = await this.accounts.findByWorkspaceId(workspaceId);

    if (existing?.status === "ACTIVE") {
      // Ya cobrando — re-link solo si necesita actualizar datos.
      const link = await this.gateway.createOnboardingLink(
        existing.externalAccountId,
        params.returnUrl,
        params.refreshUrl
      );
      return { accountId: existing.id, onboarded: true, url: link.url };
    }

    const external =
      existing ??
      (await (async () => {
        const created = await this.gateway.createAccount(workspaceId, params.country ?? "US");
        const record: ConnectedAccountRecord = {
          id: randomUUID(),
          workspaceId: params.workspaceId,
          provider: "stripe",
          externalAccountId: created.externalAccountId,
          status: "PENDING_ONBOARDING",
          chargesEnabled: false,
          payoutsEnabled: false,
          onboardedAt: null,
        };
        await this.accounts.save(record);
        return record;
      })());

    const link = await this.gateway.createOnboardingLink(
      external.externalAccountId,
      params.returnUrl,
      params.refreshUrl
    );
    return { accountId: external.id, onboarded: false, url: link.url };
  }
}

/**
 * Sincroniza el estado del merchant desde `account.updated` (webhook) o desde
 * una consulta directa al gateway. La autoridad es SIEMPRE el estado externo.
 */
export class SyncConnectedAccountStatusUseCase {
  constructor(
    private readonly accounts: ConnectedAccountRepository,
    private readonly gateway: ConnectedAccountGateway
  ) {}

  async execute(params: { workspaceId: string; externalAccountId?: string }): Promise<ConnectedAccountState> {
    const record = params.externalAccountId
      ? await this.accounts.findByExternalAccountId(params.externalAccountId)
      : await this.accounts.findByWorkspaceId(WorkspaceId(params.workspaceId));
    if (!record) throw new Error(`No connected account for ${params.workspaceId}`);

    const state = await this.gateway.retrieveAccountStatus(record.externalAccountId);

    const nextStatus: ConnectedAccountStatus = state.chargesEnabled
      ? "ACTIVE"
      : state.disabledReason
        ? "RESTRICTED"
        : "PENDING_ONBOARDING";

    await this.accounts.save({
      ...record,
      status: nextStatus,
      chargesEnabled: state.chargesEnabled,
      payoutsEnabled: state.payoutsEnabled,
      onboardedAt: nextStatus === "ACTIVE" ? (record.onboardedAt ?? new Date()) : record.onboardedAt,
    });

    return state;
  }
}

