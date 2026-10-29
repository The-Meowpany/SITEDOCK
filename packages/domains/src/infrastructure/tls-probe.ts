import tls from "node:tls";
import { InfrastructureError } from "@sitedock/shared";

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export interface TlsCertificate {
  issuedAt: Date;
  expiresAt: Date;
  issuer: string;
  subject: string;
  authorized: boolean;
}

export interface CertificateProbe {
  probe(hostname: string): Promise<TlsCertificate>;
}

/**
 * Performs a real TLS handshake against the public hostname and reads the
 * certificate Caddy served. SiteDock does not mint certificates itself: Caddy
 * (or any ACME terminator) owns issuance/renewal. This probe is the
 * authoritative check that the certificate exists, is trusted by Node's CA
 * bundle and is currently valid for the hostname.
 */
export class NodeTlsCertificateProbe implements CertificateProbe {
  constructor(private readonly timeoutMs = 12_000) {}

  probe(hostname: string): Promise<TlsCertificate> {
    return new Promise<TlsCertificate>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const socket = tls.connect({
        host: hostname,
        servername: hostname,
        port: 443,
        rejectUnauthorized: false,
        timeout: this.timeoutMs,
      });

      socket.once("secureConnect", () => {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        const authError = socket.authorizationError;
        socket.end();

        if (!cert || !cert.valid_from || !cert.valid_to) {
          finish(() =>
            reject(
              new InfrastructureError(
                `TLS certificate for ${hostname} is missing validity dates`,
                "TLS_CERTIFICATE_INVALID"
              )
            )
          );
          return;
        }

        const issuedAt = new Date(cert.valid_from);
        const expiresAt = new Date(cert.valid_to);
        const now = Date.now();
        if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime())) {
          finish(() =>
            reject(
              new InfrastructureError(
                `TLS certificate for ${hostname} has unparseable dates`,
                "TLS_CERTIFICATE_INVALID"
              )
            )
          );
          return;
        }
        if (expiresAt.getTime() <= now) {
          finish(() =>
            reject(
              new InfrastructureError(
                `TLS certificate for ${hostname} expired at ${expiresAt.toISOString()}`,
                "TLS_CERTIFICATE_EXPIRED"
              )
            )
          );
          return;
        }
        if (!authorized) {
          finish(() =>
            reject(
              new InfrastructureError(
                `TLS certificate for ${hostname} is not trusted: ${String(authError)}`,
                "TLS_CERTIFICATE_UNTRUSTED"
              )
            )
          );
          return;
        }

        finish(() =>
          resolve({
            issuedAt,
            expiresAt,
            issuer: firstValue(cert.issuer?.O) ?? firstValue(cert.issuer?.CN) ?? "unknown",
            subject: firstValue(cert.subject?.CN) ?? hostname,
            authorized,
          })
        );
      });

      socket.once("timeout", () => {
        socket.destroy();
        finish(() =>
          reject(
            new InfrastructureError(
              `TLS handshake with ${hostname} timed out`,
              "TLS_HANDSHAKE_TIMEOUT"
            )
          )
        );
      });

      socket.once("error", (err) => {
        finish(() =>
          reject(
            new InfrastructureError(
              `TLS handshake with ${hostname} failed: ${err.message}`,
              "TLS_HANDSHAKE_FAILED"
            )
          )
        );
      });
    });
  }
}
