import { describe, expect, it, beforeEach } from "vitest";
import type { ConnectedAccountGateway, ConnectedAccountState } from "../domain/money-gateways";
import { reconcilePayments } from "../domain/money-gateways";
import { StartMerchantOnboardingUseCase } from "../application/merchant-onboarding.use-cases";

const WS = "11111111-1111-1111-1111-111111111111";

class FakeConnectedAccountsGateway implements ConnectedAccountGateway {
  createdAccounts: string[] = [];
  nextState: ConnectedAccountState = { chargesEnabled: false, payoutsEnabled: false };

  async createAccount() {
    const id = `acct_${this.createdAccounts.length + 1}`;
    this.createdAccounts.push(id);
    return { externalAccountId: id };
  }

  async createOnboardingLink(externalAccountId: string) {
    void externalAccountId;
    return { url: "https://connect.stripe.test/onboarding", expiresAt: new Date(Date.now() + 3_600_000) };
  }

  async retrieveAccountStatus(): Promise<ConnectedAccountState> {
    return this.nextState;
  }
}

class InMemoryConnectedAccountRepository {
  store = new Map<string, Record<string, unknown> & { workspaceId: string; externalAccountId: string }>();

  async findByWorkspaceId(workspaceId: string) {
    return this.store.get(workspaceId) ?? null;
  }
  async findByExternalAccountId(externalAccountId: string) {
    for (const record of this.store.values()) {
      if (record.externalAccountId === externalAccountId) return record;
    }
    return null;
  }
  async save(account: Record<string, unknown>): Promise<void> {
    const r = account as { workspaceId: string };
    this.store.set(r.workspaceId, account as never);
  }
}

describe("Merchant onboarding (Stripe Connect Express)", () => {
  let gateway: FakeConnectedAccountsGateway;
  let repository: InstanceType<typeof InMemoryConnectedAccountRepository>;
  let useCase: StartMerchantOnboardingUseCase;

  beforeEach(() => {
    gateway = new FakeConnectedAccountsGateway();
    repository = new InMemoryConnectedAccountRepository();
    useCase = new StartMerchantOnboardingUseCase(
      repository as unknown as ConstructorParameters<typeof StartMerchantOnboardingUseCase>[0],
      gateway
    );
  });

  it("crea la cuenta conectada y devuelve el link hosted de KYC/KYB", async () => {
    const result = await useCase.execute({
      workspaceId: WS,
      returnUrl: "https://app/return",
      refreshUrl: "https://app/refresh",
    });

    expect(result.onboarded).toBe(false);
    expect(result.url).toContain("connect.stripe.test");
    expect(gateway.createdAccounts).toHaveLength(1);

    const stored = await repository.findByWorkspaceId(WS);
    expect(stored?.status).toBe("PENDING_ONBOARDING");
    expect(stored?.externalAccountId).toBe("acct_1");
  });

  it("reutiliza la cuenta existente en un segundo intento (no crea duplicados)", async () => {
    await useCase.execute({ workspaceId: WS, returnUrl: "r", refreshUrl: "f" });
    await useCase.execute({ workspaceId: WS, returnUrl: "r", refreshUrl: "f" });
    expect(gateway.createdAccounts).toHaveLength(1);
  });
});

// El diff de reconciliación vive aquí también para mantener los casos de
// dinero real agrupados (los tests puros están en reconciliation.test.ts).
describe("reconcilePayments — sanity adicional", () => {
  it("múltiples balance txns del mismo pago son excepción explícita", () => {
    const exceptions = reconcilePayments([], [
      { externalPaymentId: "pi_x", balanceTransactionId: "txn_a", amountCents: 100, feeCents: 4, currency: "USD" },
      { externalPaymentId: "pi_x", balanceTransactionId: "txn_b", amountCents: 100, feeCents: 4, currency: "USD" },
    ]);
    expect(exceptions[0]?.kind).toBe("AMOUNT_MISMATCH");
  });
});

// re-export para que tree-shaking no elimine el import del comparador en este archivo
void reconcilePayments;


