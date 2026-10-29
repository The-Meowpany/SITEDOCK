import { ApplicationError, DomainError, SecretCipher } from "@sitedock/shared";
import { ServiceRepository } from "../domain/ports";

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_VARIABLES = 256;
const MAX_VALUE_BYTES = 64 * 1024;

export interface ServiceEnvironmentView {
  variables: Array<{ key: string; value: string }>;
  secrets: Array<{ key: string; configured: true }>;
}

export interface UpdateServiceEnvironmentInput {
  serviceId: string;
  variables?: Record<string, string | null>;
  secrets?: Record<string, string | null>;
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError(`${field} must be an object`, "INVALID_ENVIRONMENT");
  }
}

function validateKey(key: string): void {
  if (!ENV_KEY.test(key)) {
    throw new ApplicationError(
      `Invalid environment variable name '${key}'. Use letters, digits and underscores, starting with a letter or underscore.`,
      "INVALID_ENVIRONMENT_KEY"
    );
  }
}

function validateValue(key: string, value: string): void {
  if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) {
    throw new ApplicationError(
      `Environment variable '${key}' exceeds the 64 KiB limit`,
      "ENVIRONMENT_VALUE_TOO_LARGE"
    );
  }
}

function storedVariables(env: Record<string, unknown> | null): Record<string, string> {
  if (!env) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === null || value === undefined) continue;
    result[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return result;
}

function storedSecrets(secrets: Record<string, unknown> | null): Record<string, unknown> {
  return secrets ? { ...secrets } : {};
}

function view(env: Record<string, unknown> | null, secrets: Record<string, unknown> | null): ServiceEnvironmentView {
  const variables = Object.entries(storedVariables(env))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value }));
  const secretKeys = Object.keys(storedSecrets(secrets))
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({ key, configured: true as const }));
  return { variables, secrets: secretKeys };
}

/**
 * Reads and mutates service environment configuration. Non-secret variables
 * are stored as plain strings; secret values are encrypted with the platform
 * key and are never returned to API clients.
 */
export class ServiceEnvironmentUseCase {
  constructor(
    private readonly services: ServiceRepository,
    private readonly cipher: SecretCipher | null
  ) {}

  async get(serviceId: string): Promise<ServiceEnvironmentView> {
    const service = await this.services.findById(serviceId);
    if (!service) throw new ApplicationError(`Service ${serviceId} not found`, "SERVICE_NOT_FOUND");
    return view(service.env, service.secrets ?? null);
  }

  async update(input: UpdateServiceEnvironmentInput): Promise<ServiceEnvironmentView> {
    const service = await this.services.findById(input.serviceId);
    if (!service) throw new ApplicationError(`Service ${input.serviceId} not found`, "SERVICE_NOT_FOUND");

    assertRecord(input.variables, "variables");
    assertRecord(input.secrets, "secrets");
    if (input.variables === undefined && input.secrets === undefined) {
      throw new ApplicationError("variables or secrets is required", "EMPTY_ENVIRONMENT_UPDATE");
    }

    const nextVariables =
      input.variables === undefined ? storedVariables(service.env) : replaceVariables(input.variables);
    const nextSecrets =
      input.secrets === undefined
        ? storedSecrets(service.secrets ?? null)
        : updateSecrets(input.secrets, storedSecrets(service.secrets ?? null), this.cipher);

    if (Object.keys(nextVariables).length + Object.keys(nextSecrets).length > MAX_VARIABLES) {
      throw new ApplicationError(
        `A service can have at most ${MAX_VARIABLES} environment variables and secrets`,
        "TOO_MANY_ENVIRONMENT_VARIABLES"
      );
    }

    service.updateConfiguration({ env: nextVariables, secrets: nextSecrets });
    await this.services.save(service);
    return view(nextVariables, nextSecrets);
  }
}

function replaceVariables(input: Record<string, string | null>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    validateKey(key);
    if (value === null) continue;
    if (typeof value !== "string") {
      throw new ApplicationError(`Value for '${key}' must be a string or null`, "INVALID_ENVIRONMENT_VALUE");
    }
    validateValue(key, value);
    result[key] = value;
  }
  return result;
}

function updateSecrets(
  input: Record<string, string | null>,
  current: Record<string, unknown>,
  cipher: SecretCipher | null
): Record<string, unknown> {
  const result = { ...current };
  for (const [key, value] of Object.entries(input)) {
    validateKey(key);
    if (value === null) {
      delete result[key];
      continue;
    }
    if (typeof value !== "string") {
      throw new ApplicationError(`Secret '${key}' must be a string or null`, "INVALID_SECRET_VALUE");
    }
    if (!cipher) {
      throw new DomainError(
        "Secret storage is not configured. Set SITEDOCK_SECRETS_KEY before adding secrets.",
        "SECRETS_KEY_NOT_CONFIGURED"
      );
    }
    validateValue(key, value);
    result[key] = cipher.encrypt(value);
  }
  return result;
}
