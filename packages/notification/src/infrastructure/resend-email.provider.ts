import { InfrastructureError } from "@sitedock/shared";
import type { EmailProvider } from "../domain/ports";
import type { RenderedEmail } from "../domain/templates";

export interface ResendEmailProviderConfig {
  apiKey: string;
  /** Remitente verificado en Resend (ej: "SiteDock <notificaciones@tudominio.com>"). */
  from: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

interface ResendSendResponse {
  id?: string;
  message?: string;
}

/**
 * Provider REAL de email sobre Resend (ADR-003). Mismo port que el mock —
 * NotificationService no cambia una línea. HTTP inyectado para tests offline.
 */
export class ResendEmailProvider implements EmailProvider {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: ResendEmailProviderConfig) {
    if (!config.apiKey) {
      throw new InfrastructureError("RESEND_API_KEY es obligatorio", "RESEND_CONFIG_MISSING");
    }
    if (!config.from) {
      throw new InfrastructureError("RESEND_FROM es obligatorio", "RESEND_CONFIG_MISSING");
    }
    this.base = config.apiBase ?? "https://api.resend.com";
    this.doFetch = config.fetchImpl ?? fetch;
  }

  async send(email: RenderedEmail): Promise<void> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [email.to],
          subject: email.subject,
          text: email.body,
        }),
      });
    } catch (err) {
      throw new InfrastructureError(
        `No se pudo contactar Resend: ${(err as Error).message}`,
        "EMAIL_SEND_FAILED"
      );
    }

    const body = (await res.json().catch(() => null)) as ResendSendResponse | null;

    if (!res.ok) {
      throw new InfrastructureError(
        `Resend rechazó el envío (${res.status}): ${body?.message ?? "sin detalle"}`,
        "EMAIL_SEND_FAILED"
      );
    }
    void body;
  }
}
