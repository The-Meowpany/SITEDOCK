import { MockEmailProvider } from "./mock-email.provider";
import { ResendEmailProvider } from "./resend-email.provider";
import type { EmailProvider } from "../domain/ports";

/**
 * Fábrica del EmailProvider según entorno (ADR-003).
 *   EMAIL_PROVIDER=mock (default) → MockEmailProvider
 *   EMAIL_PROVIDER=resend         → ResendEmailProvider (RESEND_API_KEY + RESEND_FROM)
 *
 * Infraestructura puede leer el entorno; la app y el dominio nunca lo hacen.
 */
export function createEmailProviderFromEnv(env: NodeJS.ProcessEnv = process.env): { provider: EmailProvider } {
  const kind = env.EMAIL_PROVIDER ?? "mock";

  if (kind === "resend") {
    return {
      provider: new ResendEmailProvider({
        apiKey: env.RESEND_API_KEY ?? "",
        from: env.RESEND_FROM ?? "",
      }),
    };
  }

  return { provider: new MockEmailProvider() };
}
