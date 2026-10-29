import { InfrastructureError } from "@sitedock/shared";

export interface BuildArtifact {
  tag: string;
  imageId: string;
  digest: string;
  buildLog: string;
}

export interface RunningContainer {
  id: string;
  name: string;
  hostPort: number;
  containerPort: number;
  reused: boolean;
}

export interface ContainerHealth {
  healthy: boolean;
  statusCode?: number;
  body?: string;
  reason?: string;
  elapsedMs?: number;
}

interface AgentErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * Client for the SiteDock trusted runtime agent.
 *
 * The worker/API never execute `podman` themselves and never mount a container
 * runtime socket. All build/run/inspect/stop operations go through the
 * authenticated, narrowly scoped agent (apps/runtime-agent/agent.mjs) that
 * runs as a dedicated non-root user on the container host.
 */
export class ContainerService {
  private readonly baseUrl: string;
  private readonly token: string | undefined;

  constructor(config?: { baseUrl?: string; token?: string }) {
    this.baseUrl = (config?.baseUrl ?? process.env.RUNTIME_AGENT_URL ?? "http://127.0.0.1:4010").replace(/\/$/, "");
    this.token = config?.token ?? process.env.RUNTIME_AGENT_TOKEN;
  }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<T> {
    if (!this.token) {
      throw new InfrastructureError(
        "RUNTIME_AGENT_TOKEN is not configured; the worker cannot reach the container runtime",
        "RUNTIME_AGENT_UNAVAILABLE"
      );
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new InfrastructureError(
        `Runtime agent unreachable at ${this.baseUrl}: ${(err as Error).message}`,
        "RUNTIME_AGENT_UNAVAILABLE"
      );
    }

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const agentError = (parsed as AgentErrorBody | null)?.error;
      throw new InfrastructureError(
        agentError?.message ?? `Runtime agent request failed with HTTP ${response.status}`,
        agentError?.code ?? "RUNTIME_AGENT_REQUEST_FAILED"
      );
    }
    return parsed as T;
  }

  async buildFromDockerfile(
    dockerfileContent: string,
    contextFiles: Record<string, Buffer>,
    tag: string
  ): Promise<BuildArtifact> {
    const files = Object.fromEntries(
      Object.entries(contextFiles).map(([name, content]) => [name, content.toString("base64")])
    );
    return this.request<BuildArtifact>(
      "POST",
      "/v1/images/build",
      { tag, dockerfile: dockerfileContent, files },
      330_000
    );
  }

  async runContainer(
    imageId: string,
    options: {
      name?: string;
      env?: Record<string, string>;
      ports?: Record<string, string>;
      memoryLimit?: string;
      cpuLimit?: string;
      pidsLimit?: number;
      command?: string[];
      readonlyRoot?: boolean;
      workdir?: string;
      labels?: Record<string, string>;
    }
  ): Promise<RunningContainer> {
    if (options.command && options.command.length > 0) {
      throw new InfrastructureError(
        "Custom container commands are not permitted by the runtime agent",
        "UNSUPPORTED_OPERATION"
      );
    }
    if (options.workdir) {
      throw new InfrastructureError("Custom workdir is not permitted by the runtime agent", "UNSUPPORTED_OPERATION");
    }

    const portEntries = Object.entries(options.ports ?? {});
    if (portEntries.length !== 1) {
      throw new InfrastructureError("Exactly one container port must be published", "INVALID_PORT_MAPPING");
    }
    const containerPort = Number(portEntries[0]![0]);
    if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
      throw new InfrastructureError("Invalid container port", "INVALID_PORT_MAPPING");
    }

    const result = await this.request<Omit<RunningContainer, "containerPort">>(
      "POST",
      "/v1/containers",
      {
        image: imageId,
        name: options.name,
        containerPort,
        env: options.env ?? {},
        memoryLimit: options.memoryLimit,
        cpuLimit: options.cpuLimit,
        pidsLimit: options.pidsLimit,
        readonlyRoot: options.readonlyRoot,
        labels: options.labels ?? {},
      },
      90_000
    );

    if (!result.hostPort) {
      throw new InfrastructureError("Runtime agent did not report a published host port", "PORT_NOT_ALLOCATED");
    }
    return { ...result, containerPort };
  }

  async stopContainer(containerId: string): Promise<void> {
    try {
      // Must exceed the agent's own removal budget (90s): stopping then deleting
      // a warm container is slow on rootless/slow-storage hosts.
      await this.request("DELETE", `/v1/containers/${encodeURIComponent(containerId)}`, undefined, 120_000);
    } catch (err) {
      // Cleanup is best-effort; a container that already disappeared is fine.
      if (err instanceof InfrastructureError && /not found|no such container/i.test(err.message)) return;
      throw err;
    }
  }

  async inspectContainer(containerId: string): Promise<Record<string, unknown>> {
    return this.request("GET", `/v1/containers/${encodeURIComponent(containerId)}`, undefined, 15_000);
  }

  async getContainerLogs(containerId: string): Promise<string> {
    const result = await this.request<{ logs: string }>(
      "GET",
      `/v1/containers/${encodeURIComponent(containerId)}/logs?tail=200`,
      undefined,
      15_000
    );
    return result.logs;
  }

  async checkHealth(
    containerId: string,
    path: string = "/health",
    timeoutMs: number = 2000
  ): Promise<ContainerHealth> {
    const query = new URLSearchParams({ path, timeoutMs: String(timeoutMs) });
    return this.request<ContainerHealth>(
      "GET",
      `/v1/containers/${encodeURIComponent(containerId)}/health?${query.toString()}`,
      undefined,
      timeoutMs + 5000
    );
  }

  async execInContainer(): Promise<never> {
    throw new InfrastructureError(
      "Arbitrary command execution is not exposed by the runtime agent",
      "UNSUPPORTED_OPERATION"
    );
  }

  async copyToContainer(): Promise<never> {
    throw new InfrastructureError(
      "Copying files into live tenant containers is not exposed by the runtime agent",
      "UNSUPPORTED_OPERATION"
    );
  }
}
