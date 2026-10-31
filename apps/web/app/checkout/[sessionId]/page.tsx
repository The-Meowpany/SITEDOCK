"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import styles from "./page.module.css";
import { useI18n } from "@/lib/i18n";

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
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  const [info, setInfo] = useState<CheckoutInfo | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "paying" | "paid" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/v1/public/demo-checkout/${sessionId}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(tRef.current("checkout.notFound"));
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
          setError(err instanceof Error ? err.message : tRef.current("checkout.openError"));
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
      if (!res.ok) throw new Error(t("checkout.payError"));
      setState("paid");
    } catch (err) {
      setState("ready");
      setError(err instanceof Error ? err.message : t("checkout.payError"));
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card} data-state={state}>
        <p className={styles.eyebrow}>{t("checkout.eyebrow")}</p>

        {state === "loading" && <p className={styles.loading}>{t("checkout.opening")}</p>}

        {state === "error" && (
          <>
            <h1 className={styles.title}>{t("checkout.invalid")}</h1>
            <p className={styles.body}>{error}</p>
          </>
        )}

        {info && state !== "error" && (
          <>
            <h1 className={styles.title}>{state === "paid" ? t("checkout.received") : info.description}</h1>
            <p className={styles.amount}>
              {info.currency === "USD" ? "$" : `${info.currency} `}
              {info.amountDecimal}
            </p>

            {state === "paid" ? (
              <p className={styles.success}>
                {t("checkout.success")}
              </p>
            ) : (
              <>
                <p className={styles.body}>
                  {t("checkout.body")}
                </p>
                <button className={styles.payButton} onClick={pay} disabled={state === "paying"}>
                  {state === "paying" ? t("checkout.processing") : t("checkout.pay", { amount: `${info.currency === "USD" ? "$" : ""}${info.amountDecimal}` })}
                </button>
                {error && <p className={styles.error}>{error}</p>}
                <p className={styles.demoNote}>{t("checkout.demoNote")}</p>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
