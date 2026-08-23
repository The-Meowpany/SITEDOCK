"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import styles from "./page.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface CheckoutInfo {
  description: string;
  amountDecimal: string;
  currency: string;
  alreadyPaid: boolean;
}

/**
 * PUBLIC demo checkout — where the client lands from the link their developer
 * copied. Only exists in demo mode; the server 404s it otherwise.
 */
export default function DemoCheckoutPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [info, setInfo] = useState<CheckoutInfo | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "paying" | "paid" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/v1/public/demo-checkout/${sessionId}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Este enlace de pago no existe o expiró.");
        return res.json();
      })
      .then((data: CheckoutInfo) => {
        if (cancelled) return;
        setInfo(data);
        setState(data.alreadyPaid ? "paid" : "ready");
      })
      .catch((err) => {
        if (!cancelled) {
          setState("error");
          setError(err instanceof Error ? err.message : "No pudimos abrir el checkout.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function pay() {
    setState("paying");
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/public/demo-checkout/${sessionId}/pay`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("El pago no pudo procesarse.");
      setState("paid");
    } catch (err) {
      setState("ready");
      setError(err instanceof Error ? err.message : "El pago no pudo procesarse.");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card} data-state={state}>
        <p className={styles.eyebrow}>SiteDock · Pago seguro</p>

        {state === "loading" && <p className={styles.loading}>Abriendo tu checkout…</p>}

        {state === "error" && (
          <>
            <h1 className={styles.title}>Enlace no válido</h1>
            <p className={styles.body}>{error}</p>
          </>
        )}

        {info && state !== "error" && (
          <>
            <h1 className={styles.title}>{state === "paid" ? "¡Pago recibido!" : info.description}</h1>
            <p className={styles.amount}>
              {info.currency === "USD" ? "$" : `${info.currency} `}
              {info.amountDecimal}
            </p>

            {state === "paid" ? (
              <p className={styles.success}>
                Gracias. Tu pago fue procesado y todo quedó activo — tu desarrollador ya lo ve de su lado.
              </p>
            ) : (
              <>
                <p className={styles.body}>
                  Estás por pagar la membresía de tu sitio. Sin sorpresas: es el importe acordado con tu
                  desarrollador.
                </p>
                <button className={styles.payButton} onClick={pay} disabled={state === "paying"}>
                  {state === "paying" ? "Procesando…" : `Pagar ${info.currency === "USD" ? "$" : ""}${info.amountDecimal}`}
                </button>
                {error && <p className={styles.error}>{error}</p>}
                <p className={styles.demoNote}>Modo demo — ningún cargo real se procesa.</p>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
