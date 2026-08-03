import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { hmacPrivateValue } from "../../common/crypto.util";
import { PrismaService } from "../prisma/prisma.service";
import type { PwaTelemetryDto } from "./dto/pwa-telemetry.dto";

const TYPE_PREFIX = "PWA_";

@Injectable()
export class PwaTelemetryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async record(dto: PwaTelemetryDto, now = new Date()) {
    const type = `${TYPE_PREFIX}${dto.event}`;
    const installationHash = hmacPrivateValue(
      `pwa-installation:${dto.installationId}`,
      this.config.getOrThrow<string>("ANALYTICS_HMAC_SECRET"),
    );
    const dedupeFrom = dto.event === "INSTALLED"
      ? new Date(0)
      : startOfUtcDay(now);
    const existing = await this.prisma.discoveryTelemetry.findFirst({
      where: {
        visitorHash: installationHash,
        type,
        createdAt: { gte: dedupeFrom },
      },
      select: { id: true },
    });
    if (existing) return { recorded: false };

    await this.prisma.discoveryTelemetry.create({
      data: {
        visitorHash: installationHash,
        type,
        metadata: {
          audience: dto.audience,
          platform: dto.platform,
        },
      },
      select: { id: true },
    });
    return { recorded: true };
  }
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}
