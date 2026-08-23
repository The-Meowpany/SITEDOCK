import { NotFoundError, UserId } from "@sitedock/shared";
import { UserRepository } from "../domain/ports";

/**
 * System-level account suspension — the caller is ALWAYS an authenticated
 * PLATFORM_ADMIN route (apps/api/src/interfaces/admin.routes.ts). There is no
 * workspace scoping here on purpose: platform administration legitimately
 * crosses tenants. The authorization boundary lives entirely in the
 * requirePlatformAdmin middleware; never expose these use cases through any
 * tenant-scoped router.
 */
export class SuspendUserUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(params: { userId: string }) {
    const user = await this.users.findById(UserId(params.userId));
    if (!user) throw new NotFoundError("User", params.userId);

    user.suspend();
    await this.users.save(user);
    return { userId: user.id, suspendedAt: user.suspendedAt };
  }
}

export class ReinstateUserUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(params: { userId: string }) {
    const user = await this.users.findById(UserId(params.userId));
    if (!user) throw new NotFoundError("User", params.userId);

    user.reinstate();
    await this.users.save(user);
    return { userId: user.id, suspendedAt: user.suspendedAt };
  }
}
