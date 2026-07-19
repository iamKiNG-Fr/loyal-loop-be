import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: required("DATABASE_URL") }),
});

async function main() {
  const email = argument("email")?.trim().toLowerCase();
  const phone = argument("phone")?.trim();
  if ((!email && !phone) || (email && phone)) {
    throw new Error(
      "Pass exactly one existing owner identity: --email=owner@example.com or --phone=+234...",
    );
  }

  const user = await prisma.user.findFirst({
    where: email ? { email } : { phone },
    select: { id: true, name: true, email: true, phone: true },
  });
  if (!user) {
    throw new Error("No existing Loyal Loop owner matches that identity");
  }

  const existingSuperadmin = await prisma.platformAdmin.findFirst({
    where: { role: "SUPERADMIN", userId: { not: user.id } },
    select: { id: true },
  });
  if (existingSuperadmin) {
    throw new Error(
      "A different SUPERADMIN already exists. Use an audited admin-management workflow for later role changes.",
    );
  }

  const admin = await prisma.$transaction(async (tx) => {
    const record = await tx.platformAdmin.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        role: "SUPERADMIN",
        status: "ACTIVE",
        lastReviewedAt: new Date(),
      },
      update: {
        role: "SUPERADMIN",
        status: "ACTIVE",
        lastReviewedAt: new Date(),
      },
    });
    await tx.platformAdminAuditLog.create({
      data: {
        actorAdminId: record.id,
        action: "SUPERADMIN_BOOTSTRAPPED",
        targetType: "PLATFORM_ADMIN",
        targetId: record.id,
        reason: "Audited deployment bootstrap against an existing owner identity",
        after: {
          userId: user.id,
          role: "SUPERADMIN",
          status: "ACTIVE",
          bootstrapIdentity: email ? "email" : "phone",
        },
      },
    });
    return record;
  });

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      platformAdminId: admin.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: admin.role,
    })}\n`,
  );
}

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
