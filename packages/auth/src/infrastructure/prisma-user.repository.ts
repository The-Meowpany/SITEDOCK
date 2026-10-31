import { prisma } from "@sitedock/database";
import { EmailAddress, UserId } from "@sitedock/shared";
import { User } from "../domain/user.entity";
import { UserRepository } from "../domain/ports";

function toDomain(row: {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  platformRole: string;
  emailVerifiedAt: Date | null;
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): User {
  return User.hydrate({
    id: UserId(row.id),
    email: EmailAddress.create(row.email),
    passwordHash: row.passwordHash,
    fullName: row.fullName,
    platformRole: row.platformRole as User["platformRole"],
    emailVerifiedAt: row.emailVerifiedAt,
    suspendedAt: row.suspendedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class PrismaUserRepository implements UserRepository {
  async findById(id: UserId): Promise<User | null> {
    const row = await prisma.user.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByEmail(email: EmailAddress): Promise<User | null> {
    const row = await prisma.user.findUnique({ where: { email: email.value } });
    return row ? toDomain(row) : null;
  }

  async save(user: User): Promise<void> {
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email.value,
        passwordHash: user.passwordHash,
        fullName: user.fullName,
        platformRole: user.platformRole,
        emailVerifiedAt: user.emailVerifiedAt,
        suspendedAt: user.suspendedAt,
      },
      update: {
        email: user.email.value,
        passwordHash: user.passwordHash,
        fullName: user.fullName,
        emailVerifiedAt: user.emailVerifiedAt,
        suspendedAt: user.suspendedAt,
      },
    });
  }
}
