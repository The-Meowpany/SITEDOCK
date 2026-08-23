import { describe, expect, it, vi } from "vitest";
import { DomainError } from "../errors";
import { RetryPolicy, runWithRetry } from "../retry-policy";

describe("RetryPolicy", () => {
  it("rejects maxAttempts less than 1", () => {
    expect(() => RetryPolicy.create({ maxAttempts: 0, backoffMs: [] })).toThrow(DomainError);
  });

  it("returns 0 delay for the first attempt", () => {
    const policy = RetryPolicy.create({ maxAttempts: 3, backoffMs: [1000, 5000] });
    expect(policy.delayBeforeAttempt(1)).toBe(0);
  });

  it("uses the backoff schedule for subsequent attempts", () => {
    const policy = RetryPolicy.create({ maxAttempts: 4, backoffMs: [1000, 5000, 9000] });
    expect(policy.delayBeforeAttempt(2)).toBe(1000);
    expect(policy.delayBeforeAttempt(3)).toBe(5000);
    expect(policy.delayBeforeAttempt(4)).toBe(9000);
  });

  it("holds at the last backoff value if attempts exceed the schedule length", () => {
    const policy = RetryPolicy.create({ maxAttempts: 10, backoffMs: [1000, 5000] });
    expect(policy.delayBeforeAttempt(5)).toBe(5000);
  });

  it("shouldRetry is false once maxAttempts is reached", () => {
    const policy = RetryPolicy.create({ maxAttempts: 3, backoffMs: [] });
    expect(policy.shouldRetry(1)).toBe(true);
    expect(policy.shouldRetry(2)).toBe(true);
    expect(policy.shouldRetry(3)).toBe(false);
  });

  it("default() never retries infinitely", () => {
    const policy = RetryPolicy.default();
    expect(policy.maxAttempts).toBe(4);
    expect(policy.shouldRetry(4)).toBe(false);
  });
});

describe("runWithRetry", () => {
  it("returns succeeded:true on the first try without any delay", async () => {
    const policy = RetryPolicy.create({ maxAttempts: 3, backoffMs: [1000] });
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await runWithRetry(fn, policy);

    expect(result).toEqual({ succeeded: true, attempts: 1, result: "ok" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    const policy = RetryPolicy.create({ maxAttempts: 3, backoffMs: [1] }); // 1ms so the test stays fast
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient failure");
      return "ok";
    });

    const result = await runWithRetry(fn, policy);

    expect(result.succeeded).toBe(true);
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after maxAttempts and reports the last error", async () => {
    const policy = RetryPolicy.create({ maxAttempts: 2, backoffMs: [1] });
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    const result = await runWithRetry(fn, policy);

    expect(result.succeeded).toBe(false);
    expect(result.attempts).toBe(2);
    expect((result.error as Error).message).toBe("always fails");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
