import { SessionRepository } from "../domain/ports";
import { hashToken } from "./login-user.use-case";

export class LogoutUserUseCase {
  constructor(private readonly sessions: SessionRepository) {}

  async execute(sessionToken: string): Promise<void> {
    await this.sessions.revokeByTokenHash(hashToken(sessionToken));
  }
}
