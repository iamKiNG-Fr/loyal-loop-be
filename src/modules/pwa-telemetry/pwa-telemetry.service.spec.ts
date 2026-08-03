import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { PwaTelemetryService } from "./pwa-telemetry.service";

describe("PwaTelemetryService", () => {
  const dto = {
    audience: "OWNER" as const,
    event: "STANDALONE_LAUNCH" as const,
    installationId: "42ceca1c-f8e6-4f52-93eb-00cf4fd653ce",
    platform: "ANDROID" as const,
  };

  it("stores only a keyed installation hash and bounded device metadata", async () => {
    const create = vi.fn().mockResolvedValue({ id: "telemetry-1" });
    const prisma = {
      discoveryTelemetry: {
        create,
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new PwaTelemetryService(
      prisma as never,
      new ConfigService({ ANALYTICS_HMAC_SECRET: "a".repeat(32) }),
    );

    await expect(service.record(dto, new Date("2026-08-03T09:15:00.000Z")))
      .resolves.toEqual({ recorded: true });
    const data = create.mock.calls[0]![0].data;
    expect(data.type).toBe("PWA_STANDALONE_LAUNCH");
    expect(data.visitorHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.visitorHash).not.toContain(dto.installationId);
    expect(data.metadata).toEqual({ audience: "OWNER", platform: "ANDROID" });
  });

  it("deduplicates the same signal for an installation during a UTC day", async () => {
    const prisma = {
      discoveryTelemetry: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({ id: "existing" }),
      },
    };
    const service = new PwaTelemetryService(
      prisma as never,
      new ConfigService({ ANALYTICS_HMAC_SECRET: "b".repeat(32) }),
    );

    await expect(service.record(dto, new Date("2026-08-03T23:59:00.000Z")))
      .resolves.toEqual({ recorded: false });
    expect(prisma.discoveryTelemetry.create).not.toHaveBeenCalled();
    expect(prisma.discoveryTelemetry.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: { gte: new Date("2026-08-03T00:00:00.000Z") } }),
    }));
  });
});
