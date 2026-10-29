"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function GitHubCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const installationId = query.get("installation_id");
    const state = query.get("state") ?? "";
    const [workspaceId, websiteId] = state.split(":");

    if (!installationId || !workspaceId || !websiteId) {
      setError("GitHub no devolvió una instalación válida. Volvé a intentar desde el sitio.");
      return;
    }

    router.replace(
      `/workspaces/${workspaceId}/sitios/${websiteId}?installation_id=${encodeURIComponent(installationId)}`
    );
  }, [router]);

  return (
    <main style={{ padding: 32, fontFamily: "monospace" }}>
      {error ?? "Conectando la instalación de GitHub…"}
    </main>
  );
}
