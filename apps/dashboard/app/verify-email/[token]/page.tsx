"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import styles from "../../page.module.css";

type State = "confirming" | "done" | "error";

/** Landing page of the link emailed to confirm an address. Public: the token is the credential. */
export default function VerifyEmailPage() {
  const params = useParams<{ token: string }>();
  const { t } = useI18n();
  const [state, setState] = useState<State>("confirming");
  // Guards against React strict-mode double effects: the token is single use.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .confirmEmailVerification(params.token)
      .then(() => setState("done"))
      .catch(() => setState("error"));
  }, [params.token]);

  return (
    <main className={styles.center}>
      {state === "confirming" && <p className={styles.loading}>{t("verify.confirming")}</p>}
      {state === "error" && <p className={styles.error}>{t("verify.error")}</p>}
      {state === "done" && (
        <p className={styles.loading} role="status">
          {t("verify.done")} <Link href="/">{t("verify.toConsole")}</Link>
        </p>
      )}
    </main>
  );
}
