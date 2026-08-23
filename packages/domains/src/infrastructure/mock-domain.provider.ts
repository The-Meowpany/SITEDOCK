import { randomBytes } from "node:crypto";
import { DomainProvider } from "../domain/ports";

/**
 * Demo/mock DomainProvider (docs/ARCHITECTURE.md §45 "Demo Mode"). Always
 * confirms ownership successfully after verification starts — a real
 * CloudflareDomainProvider/Route53DomainProvider would actually resolve DNS
 * TXT records and could legitimately return false.
 */
export class MockDomainProvider implements DomainProvider {
  async generateOwnershipProof(hostname: string): Promise<{ proofToken: string; recordName: string; recordValue: string }> {
    const proofToken = randomBytes(16).toString("hex");
    return {
      proofToken,
      recordName: `_sitedock-verify.${hostname}`,
      recordValue: `sitedock-verification=${proofToken}`,
    };
  }

  async checkOwnershipProof(_hostname: string, _proofToken: string): Promise<boolean> {
    return true; // demo mode: DNS is always "already propagated"
  }

  async issueCertificate(_hostname: string): Promise<{ issuedAt: Date; expiresAt: Date }> {
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 90 * 24 * 60 * 60 * 1000); // 90-day demo cert
    return { issuedAt, expiresAt };
  }
}
