import { randomUUID } from "node:crypto";
import { ConflictError, EmailAddress, UserId } from "@sitedock/shared";
import { User } from "../domain/user.entity";
import { PasswordHasher, UserRepository } from "../domain/ports";

export interface RegisterUserCommand {
  email: string;
  password: string;
  fullName: string;
}

export interface RegisterUserResult {
  userId: string;
  email: string;
  fullName: string;
}

export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher
  ) {}

  async execute(command: RegisterUserCommand): Promise<RegisterUserResult> {
    const email = EmailAddress.create(command.email);

    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictError("An account with this email already exists");
    }

    if (command.password.length < 8) {
      throw new ConflictError("Password must be at least 8 characters long");
    }

    const passwordHash = await this.hasher.hash(command.password);
    const user = User.register({
      id: UserId(randomUUID()),
      email,
      passwordHash,
      fullName: command.fullName,
    });

    await this.users.save(user);

    return { userId: user.id, email: user.email.value, fullName: user.fullName };
  }
}
