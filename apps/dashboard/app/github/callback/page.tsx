"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";

export default function GitHubCallbackPage() {
  const router = useRouter();
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const installationId = query.get("installation_id");
    const state = query.get("state") ?? "";
    const [workspaceId, websiteId] = state.split(":");

    if (!installationId || !workspaceId || !websiteId) {
      setError(tRef.current("githubCallback.error"));
      return;
    }

    router.replace(
      `/workspaces/${workspaceId}/sitios/${websiteId}?installation_id=${encodeURIComponent(installationId)}`
    );
  }, [router]);

  return (
    <main style={{ padding: 32, fontFamily: "monospace" }}>
      {error ?? t("githubCallback.connecting")}
    </main>
  );
}
