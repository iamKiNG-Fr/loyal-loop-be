import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly media: MediaService,
  ) {}

  assertSecret(candidate: string | undefined) {
    const expected = this.config.get<string>('RETENTION_SCHEDULER_SECRET');
    if (!expected) throw new ServiceUnavailableException('Retention scheduler is not configured');
    const left = Buffer.from(candidate || '');
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new ForbiddenException('Retention scheduler secret is invalid');
    }
  }

  async run(now = new Date()) {
    const enabled = this.config.get<string>('RETENTION_CLEANUP_ENABLED') === 'true';
    const authCutoff = daysBefore(now, this.days('RETENTION_AUTH_GRACE_DAYS', 30));
    const telemetryCutoff = daysBefore(now, this.days('RETENTION_DISCOVERY_TELEMETRY_DAYS', 395));
    const mediaCutoff = daysBefore(now, this.days('RETENTION_SENSITIVE_MEDIA_DAYS', 180));
    const batchSize = this.days('RETENTION_MEDIA_BATCH_SIZE', 100, 500);

    const candidates = await this.candidateCounts(authCutoff, telemetryCutoff, mediaCutoff);
    if (!enabled) return { candidates, mode: 'report' as const, purged: null };

    const [ownerSessions, customerSessions, ownerOtpChallenges, customerOtpChallenges, onboardingEmailChallenges, passwordRecoveryTokens, discoveryTelemetry] = await this.prisma.$transaction([
      this.prisma.ownerSession.deleteMany({
        where: { OR: [{ expiresAt: { lte: authCutoff } }, { revokedAt: { lte: authCutoff } }] },
      }),
      this.prisma.customerAccountSession.deleteMany({
        where: { OR: [{ expiresAt: { lte: authCutoff } }, { revokedAt: { lte: authCutoff } }] },
      }),
      this.prisma.ownerOtpChallenge.deleteMany({ where: { expiresAt: { lte: authCutoff } } }),
      this.prisma.customerOtpChallenge.deleteMany({ where: { expiresAt: { lte: authCutoff } } }),
      this.prisma.onboardingEmailChallenge.deleteMany({ where: { expiresAt: { lte: authCutoff } } }),
      this.prisma.passwordRecoveryToken.deleteMany({ where: { expiresAt: { lte: authCutoff } } }),
      this.prisma.discoveryTelemetry.deleteMany({ where: { createdAt: { lte: telemetryCutoff } } }),
    ]);

    const assetIds = await this.sensitiveAssetIds(mediaCutoff, batchSize);
    let sensitiveMedia = 0;
    let mediaFailures = 0;
    for (const assetId of assetIds) {
      try {
        if (await this.media.purgeSensitiveAsset(assetId)) sensitiveMedia += 1;
      } catch {
        mediaFailures += 1;
      }
    }

    return {
      candidates,
      mode: 'enforce' as const,
      purged: {
        customerOtpChallenges: customerOtpChallenges.count,
        customerSessions: customerSessions.count,
        discoveryTelemetry: discoveryTelemetry.count,
        mediaFailures,
        onboardingEmailChallenges: onboardingEmailChallenges.count,
        ownerOtpChallenges: ownerOtpChallenges.count,
        ownerSessions: ownerSessions.count,
        passwordRecoveryTokens: passwordRecoveryTokens.count,
        sensitiveMedia,
      },
    };
  }

  private async candidateCounts(authCutoff: Date, telemetryCutoff: Date, mediaCutoff: Date) {
    const [ownerSessions, customerSessions, ownerOtpChallenges, customerOtpChallenges, onboardingEmailChallenges, passwordRecoveryTokens, discoveryTelemetry, sensitiveMedia] = await Promise.all([
      this.prisma.ownerSession.count({ where: { OR: [{ expiresAt: { lte: authCutoff } }, { revokedAt: { lte: authCutoff } }] } }),
      this.prisma.customerAccountSession.count({ where: { OR: [{ expiresAt: { lte: authCutoff } }, { revokedAt: { lte: authCutoff } }] } }),
      this.prisma.ownerOtpChallenge.count({ where: { expiresAt: { lte: authCutoff } } }),
      this.prisma.customerOtpChallenge.count({ where: { expiresAt: { lte: authCutoff } } }),
      this.prisma.onboardingEmailChallenge.count({ where: { expiresAt: { lte: authCutoff } } }),
      this.prisma.passwordRecoveryToken.count({ where: { expiresAt: { lte: authCutoff } } }),
      this.prisma.discoveryTelemetry.count({ where: { createdAt: { lte: telemetryCutoff } } }),
      this.sensitiveAssetIds(mediaCutoff, 500).then((ids) => ids.length),
    ]);
    return {
      customerOtpChallenges,
      customerSessions,
      discoveryTelemetry,
      onboardingEmailChallenges,
      ownerOtpChallenges,
      ownerSessions,
      passwordRecoveryTokens,
      sensitiveMedia,
    };
  }

  private async sensitiveAssetIds(cutoff: Date, take: number) {
    const [proofs, deliveries] = await Promise.all([
      this.prisma.paymentProof.findMany({
        where: {
          reviewedAt: { lte: cutoff },
          status: { in: ['REJECTED', 'VERIFIED'] },
          asset: { status: 'ACTIVE' },
          sale: { issues: { none: { status: 'OPEN' } } },
        },
        select: { assetId: true },
        take,
      }),
      this.prisma.delivery.findMany({
        where: {
          confirmedAt: { lte: cutoff },
          handoffAssetId: { not: null },
          handoffAsset: { status: 'ACTIVE' },
          sale: { issues: { none: { status: 'OPEN' } } },
        },
        select: { handoffAssetId: true },
        take,
      }),
    ]);
    return [...new Set([
      ...proofs.map((proof) => proof.assetId),
      ...deliveries.map((delivery) => delivery.handoffAssetId).filter((id): id is string => Boolean(id)),
    ])].slice(0, take);
  }

  private days(key: string, fallback: number, maximum = 3650) {
    const value = Number(this.config.get<string | number>(key));
    return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
  }
}

function daysBefore(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
