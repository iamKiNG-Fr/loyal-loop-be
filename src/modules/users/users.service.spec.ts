import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { UsersService } from "./users.service";

describe("UsersService phone security", () => {
  it("does not allow the verified WhatsApp identity to be bypassed through personal details", async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ phone: "+2348011111111" }),
        update: vi.fn(),
      },
    };
    const service = new UsersService(prisma as never);

    await expect(service.update({ userId: "user-1" } as never, {
      phone: "+2348022222222",
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("clears durable verification when an owner changes the email address", async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          email: "owner@example.com",
          phone: "+2348011111111",
        }),
        update: vi.fn().mockResolvedValue({ id: "user-1" }),
      },
    };
    const service = new UsersService(prisma as never);

    await service.update({ userId: "user-1" } as never, {
      email: " New@Example.com ",
    });

    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: "new@example.com",
        emailVerifiedAt: null,
      }),
    }));
  });
});
