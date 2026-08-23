import { createHmac, timingSafeEqual } from "node:crypto";

export interface StripeSignatureVerification {
  valid: boolean;
  reason?: "MISSING_HEADER" | "MALFORMED_HEADER" | "TIMESTAMP_OUT_OF_TOLERANCE" | "SIGNATURE_MISMATCH";
}

/**
 * Verifica la firma de un webhook de Stripe con el esquema REAL del proveedor:
 *   Stripe-Signature: t=<unix_ts>,v1=<hmac_sha256(`${t}.${payload}`)>
 *
 * Implementado localmente (sin SDK) para poder testearlo offline contra
 * payloads firmados con el mismo algoritmo — sandbox-first sin red.
 */
export function verifyStripeSignature(
  rawBody: Buffer,
  header: string,
  secret: string,
  options: { now?: Date; toleranceSeconds?: number } = {}
): StripeSignatureVerification {
  if (!header) return { valid: false, reason: "MISSING_HEADER" };

  const parts = new Map<string, string>();
  for (const segment of header.split(",")) {
    const [rawKey, rawValue] = segment.split("=");
    if (!rawKey || rawValue === undefined) continue;
    parts.set(rawKey.trim(), rawValue.trim());
  }

  const timestamp = parts.get("t");
  const signatures = [...parts.entries()].filter(([k]) => k === "v1").map(([, v]) => v);
  if (!timestamp || signatures.length === 0) {
    return { valid: false, reason: "MALFORMED_HEADER" };
  }

  const tolerance = (options.toleranceSeconds ?? 300) * 1000;
  const nowMs = (options.now ?? new Date()).getTime();
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > tolerance) {
    return { valid: false, reason: "TIMESTAMP_OUT_OF_TOLERANCE" };
  }

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");

  for (const candidate of signatures) {
    const candidateBuf = Buffer.from(candidate, "hex");
    if (
      candidateBuf.length === expectedBuf.length &&
      timingSafeEqual(candidateBuf, expectedBuf)
    ) {
      return { valid: true };
    }
  }

  return { valid: false, reason: "SIGNATURE_MISMATCH" };
}
