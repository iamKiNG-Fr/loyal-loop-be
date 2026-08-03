import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ActivityEventType, Prisma } from "../../generated/prisma/client";
import type { PlatformAuthContext } from "../../common/request-context";
import { FoundingCircleService } from "../founding-circle/founding-circle.service";
import type {
  CreateFoundingCohortDto,
  CreateFoundingInvitationDto,
  CreateResearchInterviewDto,
  CompleteLegacyFoundingApplicationDto,
} from "../founding-circle/dto/founding-circle.dto";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeE164 } from "../messaging/twilio-whatsapp.provider";
import type {
  GrantPlatformAdminDto,
  AdminListQueryDto,
  ReactivateBusinessDto,
  ReviewPlatformAdminDto,
  ReviewCustomerReportDto,
  RevokePlatformSessionDto,
  SuspendBusinessDto,
  UpdatePlatformAdminDto,
} from "./dto/platform-admin.dto";
import { discoverySource } from "../shops/discovery-attribution";

const MEANINGFUL_BUSINESS_ACTIONS = [
  "CUSTOMER_ADDED",
  "CUSTOMER_NOTE_ADDED",
  "PRODUCT_ADDED",
  "PRODUCT_UPDATED",
  "SALE_LOGGED",
  "PAYMENT_UPDATED",
  "RECEIPT_CREATED",
  "RECEIPT_SENT",
  "DELIVERY_STATUS_UPDATED",
  "DELIVERY_CONFIRMED",
  "ISSUE_RESOLVED",
  "FOLLOW_UP_SENT",
  "REQUEST_PAYMENT_UPDATED",
] satisfies ActivityEventType[];

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly founding: FoundingCircleService,
  ) {}

  async overview(includeDemo = false) {
    const businessWhere = includeDemo ? {} : { isDemo: false };
    const [
      businesses,
      activeBusinesses,
      customers,
      customerAccounts,
      products,
      orderRequests,
      sales,
      saleValue,
      receipts,
      deliveries,
      pendingApplications,
      issuedInvitations,
      pendingMediaReviews,
      pendingCustomerReports,
      enrollments,
      discoveryEvents,
      retentionBusinesses,
      trustLedgerEntries,
      pwaSummaryRows,
      pwaSegmentRows,
    ] = await Promise.all([
      this.prisma.business.count({ where: businessWhere }),
      this.prisma.business.count({
        where: {
          ...businessWhere,
          platformStatus: "ACTIVE",
          activityEvents: {
            some: {
              createdAt: { gte: daysAgo(7) },
              type: { in: MEANINGFUL_BUSINESS_ACTIONS },
            },
          },
        },
      }),
      this.prisma.customer.count({ where: { business: businessWhere } }),
      this.prisma.customerAccount.count(),
      this.prisma.product.count({ where: { business: businessWhere } }),
      this.prisma.orderRequest.count({ where: { business: businessWhere } }),
      this.prisma.sale.count({ where: { business: businessWhere } }),
      this.prisma.sale.aggregate({
        where: { business: businessWhere },
        _sum: { total: true },
      }),
      this.prisma.receipt.count({ where: { business: businessWhere } }),
      this.prisma.delivery.count({ where: { business: businessWhere } }),
      this.prisma.foundingAccessApplication.count({ where: { status: "PENDING" } }),
      this.prisma.onboardingInvitation.count({
        where: { status: "ISSUED", expiresAt: { gt: new Date() } },
      }),
      this.prisma.mediaAsset.count({
        where: {
          business: businessWhere,
          deletedAt: null,
          moderationStatus: { in: ["PENDING", "REVIEW_REQUIRED"] },
          status: "ACTIVE",
        },
      }),
      this.prisma.customerReport.count({
        where: {
          business: businessWhere,
          status: { in: ["OPEN", "IN_REVIEW"] },
        },
      }),
      this.memberJourneys(includeDemo),
      this.prisma.commerceEvent.findMany({
        where: {
          business: businessWhere,
          type: { in: ["SHOP_VIEWED", "PRODUCT_VIEWED"] },
          createdAt: { gte: daysAgo(30) },
        },
        select: {
          businessId: true,
          metadata: true,
          productId: true,
          business: { select: { name: true, slug: true } },
          product: { select: { name: true, slug: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10000,
      }),
      this.prisma.business.findMany({
        where: businessWhere,
        select: {
          id: true,
          activityEvents: {
            where: {
              createdAt: { gte: daysAgo(14) },
              type: { in: MEANINGFUL_BUSINESS_ACTIONS },
            },
            select: { createdAt: true },
          },
        },
      }),
      this.prisma.trustLedgerEntry.findMany({
        where: { business: businessWhere },
        select: {
          businessId: true,
          points: true,
          business: { select: { name: true, slug: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10000,
      }),
      this.prisma.$queryRaw<Array<{
        activeInstallations7d: bigint;
        activeInstallations30d: bigint;
        knownInstallations: bigint;
        newInstallations30d: bigint;
        promptedDevices30d: bigint;
      }>>`
        WITH installation_signals AS (
          SELECT visitor_hash, MIN(created_at) AS first_known_at
          FROM discovery_telemetry
          WHERE visitor_hash IS NOT NULL
            AND type IN ('PWA_INSTALLED', 'PWA_STANDALONE_LAUNCH')
          GROUP BY visitor_hash
        )
        SELECT
          COUNT(*)::bigint AS "knownInstallations",
          COUNT(*) FILTER (
            WHERE first_known_at >= NOW() - INTERVAL '30 days'
          )::bigint AS "newInstallations30d",
          (
            SELECT COUNT(DISTINCT visitor_hash)
            FROM discovery_telemetry
            WHERE visitor_hash IS NOT NULL
              AND type = 'PWA_STANDALONE_LAUNCH'
              AND created_at >= NOW() - INTERVAL '7 days'
          )::bigint AS "activeInstallations7d",
          (
            SELECT COUNT(DISTINCT visitor_hash)
            FROM discovery_telemetry
            WHERE visitor_hash IS NOT NULL
              AND type = 'PWA_STANDALONE_LAUNCH'
              AND created_at >= NOW() - INTERVAL '30 days'
          )::bigint AS "activeInstallations30d",
          (
            SELECT COUNT(DISTINCT visitor_hash)
            FROM discovery_telemetry
            WHERE visitor_hash IS NOT NULL
              AND type = 'PWA_PROMPT_SHOWN'
              AND created_at >= NOW() - INTERVAL '30 days'
          )::bigint AS "promptedDevices30d"
        FROM installation_signals
      `,
      this.prisma.$queryRaw<Array<{
        audience: string;
        count: bigint;
        platform: string;
      }>>`
        WITH latest_install_signal AS (
          SELECT
            visitor_hash,
            COALESCE(metadata ->> 'platform', 'OTHER') AS platform,
            COALESCE(metadata ->> 'audience', 'PUBLIC') AS audience,
            ROW_NUMBER() OVER (
              PARTITION BY visitor_hash
              ORDER BY created_at DESC
            ) AS position
          FROM discovery_telemetry
          WHERE visitor_hash IS NOT NULL
            AND type IN ('PWA_INSTALLED', 'PWA_STANDALONE_LAUNCH')
        )
        SELECT platform, audience, COUNT(*)::bigint AS count
        FROM latest_install_signal
        WHERE position = 1
        GROUP BY platform, audience
        ORDER BY count DESC
      `,
    ]);
    const activated = enrollments.filter((item) => item.activation.activated).length;
    const weekOneRetained = enrollments.filter((item) => item.retention.weekOne).length;
    const weekFourRetained = enrollments.filter((item) => item.retention.weekFour).length;
    const discoverySources = new Map<string, number>();
    const businessTraffic = new Map<string, { id: string; name: string; slug: string; views: number }>();
    const productTraffic = new Map<string, { id: string; name: string; slug: string; views: number }>();
    for (const event of discoveryEvents) {
      const source = discoverySource(event.metadata);
      if (source) discoverySources.set(source, (discoverySources.get(source) ?? 0) + 1);
      const business = businessTraffic.get(event.businessId) ?? {
        id: event.businessId,
        name: event.business.name,
        slug: event.business.slug,
        views: 0,
      };
      business.views += 1;
      businessTraffic.set(event.businessId, business);
      if (event.productId && event.product) {
        const product = productTraffic.get(event.productId) ?? {
          id: event.productId,
          name: event.product.name,
          slug: event.product.slug,
          views: 0,
        };
        product.views += 1;
        productTraffic.set(event.productId, product);
      }
    }
    const trustBusinesses = new Map<string, { id: string; name: string; points: number; slug: string }>();
    for (const entry of trustLedgerEntries) {
      const business = trustBusinesses.get(entry.businessId) ?? {
        id: entry.businessId,
        name: entry.business.name,
        points: 0,
        slug: entry.business.slug,
      };
      business.points += entry.points;
      trustBusinesses.set(entry.businessId, business);
    }
    const attributedPublicViews = [...discoverySources.values()].reduce((sum, value) => sum + value, 0);
    const currentWeekStart = daysAgo(7).getTime();
    const previousWeekStart = daysAgo(14).getTime();
    const retentionRows = retentionBusinesses.map((business) => {
      const times = business.activityEvents.map((event) => event.createdAt.getTime());
      return {
        currentWeek: times.some((time) => time >= currentWeekStart),
        previousWeek: times.some((time) => time >= previousWeekStart && time < currentWeekStart),
      };
    });
    const activeThisWeek = retentionRows.filter((item) => item.currentWeek).length;
    const previousWeekActive = retentionRows.filter((item) => item.previousWeek).length;
    const retainedThisWeek = retentionRows.filter((item) => item.currentWeek && item.previousWeek).length;
    const pwaSummary = pwaSummaryRows[0];
    const platformCounts = new Map<string, number>();
    const audienceCounts = new Map<string, number>();
    for (const row of pwaSegmentRows) {
      const count = Number(row.count);
      platformCounts.set(row.platform, (platformCounts.get(row.platform) ?? 0) + count);
      audienceCounts.set(row.audience, (audienceCounts.get(row.audience) ?? 0) + count);
    }
    return {
      totals: {
        businesses,
        activeBusinesses,
        businessCustomers: customers,
        customerAccounts,
        products,
        orderRequests,
        recordedSales: sales,
        recordedSalesValue: saleValue._sum.total?.toString() ?? "0",
        receipts,
        deliveries,
      },
      foundingCircle: {
        members: enrollments.length,
        pendingApplications,
        issuedInvitations,
        activated,
        activationRate: percentage(activated, enrollments.length),
        weekOneRetained,
        weekOneRetentionRate: percentage(weekOneRetained, activated),
        weekFourRetained,
        weekFourRetentionRate: percentage(weekFourRetained, activated),
      },
      alerts: {
        pendingMediaReviews,
        pendingCustomerReports,
        suspendedBusinesses: await this.prisma.business.count({
          where: { platformStatus: "SUSPENDED" },
        }),
        failedInvitations: await this.prisma.messageOutbox.count({
          where: {
            templateKey: "founding_access",
            status: { in: ["FAILED", "DEAD_LETTER", "SUPPRESSED"] },
          },
        }),
      },
      traffic: {
        attributedViews: attributedPublicViews,
        topBusinesses: [...businessTraffic.values()]
          .sort((left, right) => right.views - left.views || left.name.localeCompare(right.name))
          .slice(0, 8),
        topProducts: [...productTraffic.values()]
          .sort((left, right) => right.views - left.views || left.name.localeCompare(right.name))
          .slice(0, 8),
        sourceBreakdown: [...discoverySources.entries()]
          .map(([source, views]) => ({ source, views }))
          .sort((left, right) => right.views - left.views)
          .slice(0, 8),
        totalPublicViews: discoveryEvents.length,
        windowDays: 30,
      },
      trust: {
        topBusinesses: [...trustBusinesses.values()]
          .sort((left, right) => right.points - left.points || left.name.localeCompare(right.name))
          .slice(0, 8),
      },
      retention: {
        activeThisWeek,
        previousWeekActive,
        retainedThisWeek,
        weeklyRetentionRate: percentage(retainedThisWeek, previousWeekActive),
      },
      pwa: {
        knownInstallations: Number(pwaSummary?.knownInstallations ?? 0),
        newInstallations30d: Number(pwaSummary?.newInstallations30d ?? 0),
        activeInstallations7d: Number(pwaSummary?.activeInstallations7d ?? 0),
        activeInstallations30d: Number(pwaSummary?.activeInstallations30d ?? 0),
        promptedDevices30d: Number(pwaSummary?.promptedDevices30d ?? 0),
        platformBreakdown: [...platformCounts.entries()]
          .map(([platform, installations]) => ({ platform, installations }))
          .sort((left, right) => right.installations - left.installations),
        audienceBreakdown: [...audienceCounts.entries()]
          .map(([audience, installations]) => ({ audience, installations }))
          .sort((left, right) => right.installations - left.installations),
      },
      memberJourneys: enrollments,
    };
  }

  async customerReports(query: AdminListQueryDto) {
    const allowedStatuses = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] as const;
    if (query.status && !allowedStatuses.includes(query.status as typeof allowedStatuses[number])) {
      throw new BadRequestException("Unknown report status");
    }
    const { page, pageSize, skip } = paging(query);
    const where: Prisma.CustomerReportWhereInput = {
      ...(query.status ? { status: query.status as typeof allowedStatuses[number] } : {}),
      ...(query.search
        ? {
            OR: [
              { subjectLabelSnapshot: { contains: query.search, mode: "insensitive" } },
              { details: { contains: query.search, mode: "insensitive" } },
              { business: { name: { contains: query.search, mode: "insensitive" } } },
              { reporter: { name: { contains: query.search, mode: "insensitive" } } },
              { reporter: { phone: { contains: query.search } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.customerReport.findMany({
        where,
        include: {
          business: { select: { id: true, name: true, slug: true, platformStatus: true } },
          reporter: { select: { id: true, name: true, phone: true } },
          reviewedBy: { select: { id: true, user: { select: { name: true } } } },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip,
        take: pageSize,
      }),
      this.prisma.customerReport.count({ where }),
    ]);
    return pageResult(items, total, page, pageSize);
  }

  async reviewCustomerReport(
    auth: PlatformAuthContext,
    reportId: string,
    dto: ReviewCustomerReportDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.customerReport.findUnique({ where: { id: reportId } });
      if (!before) throw new NotFoundException("Customer report not found");
      const report = await tx.customerReport.update({
        where: { id: reportId },
        data: {
          status: dto.status,
          reviewNotes: dto.notes?.trim(),
          reviewedAt: dto.status === "OPEN" ? null : new Date(),
          reviewedByAdminId: dto.status === "OPEN" ? null : auth.platformAdminId,
        },
        include: {
          business: { select: { id: true, name: true, slug: true, platformStatus: true } },
          reporter: { select: { id: true, name: true, phone: true } },
          reviewedBy: { select: { id: true, user: { select: { name: true } } } },
        },
      });
      await this.audit(auth, "CUSTOMER_REPORT_REVIEWED", "CustomerReport", report.id, dto.notes, before, report, tx);
      return report;
    });
  }

  async applications(query: AdminListQueryDto) {
    const { page, pageSize, skip } = paging(query);
    const where: Prisma.FoundingAccessApplicationWhereInput = {
      status: query.status as Prisma.EnumFoundingApplicationStatusFilter | undefined,
      ...(query.search
        ? {
            OR: [
              { ownerName: { contains: query.search, mode: "insensitive" } },
              { businessName: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search, mode: "insensitive" } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.foundingAccessApplication.findMany({
        where,
        include: { invitation: { include: { messageOutbox: true, cohort: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      this.prisma.foundingAccessApplication.count({ where }),
    ]);
    return pageResult(items, total, page, pageSize);
  }

  async declineApplication(
    auth: PlatformAuthContext,
    applicationId: string,
    notes?: string,
  ) {
    const before = await this.prisma.foundingAccessApplication.findUnique({
      where: { id: applicationId },
    });
    if (!before) throw new NotFoundException("Founding Circle application not found");
    const application = await this.prisma.foundingAccessApplication.update({
      where: { id: applicationId },
      data: {
        status: "DECLINED",
        reviewNotes: notes,
        reviewedAt: new Date(),
        reviewedByAdminId: auth.platformAdminId,
      },
    });
    await this.audit(auth, "FOUNDING_APPLICATION_DECLINED", "FoundingAccessApplication", application.id, notes, before, application);
    return application;
  }

  async completeLegacyApplication(
    auth: PlatformAuthContext,
    applicationId: string,
    dto: CompleteLegacyFoundingApplicationDto,
  ) {
    if (!dto.consentAttested) {
      throw new BadRequestException(
        "Confirm that the applicant requested Founding Circle updates on WhatsApp",
      );
    }
    const before = await this.prisma.foundingAccessApplication.findUnique({
      where: { id: applicationId },
    });
    if (!before) throw new NotFoundException("Founding Circle application not found");
    const phone = normalizeE164(dto.phone);
    const application = await this.prisma.foundingAccessApplication.update({
      where: { id: applicationId },
      data: {
        phone,
        whatTheySell: dto.whatTheySell,
        primarySellingChannel: dto.primarySellingChannel,
        whatsappConsentAt: new Date(),
        whatsappConsentSource: "admin-attested-request",
      },
    });
    await this.founding.grantApplicationConsent(phone, "admin-attested-request");
    await this.audit(
      auth,
      "FOUNDING_APPLICATION_CONTACT_COMPLETED",
      "FoundingAccessApplication",
      application.id,
      "Administrator attested recipient request",
      before,
      application,
    );
    return application;
  }

  async createInvitation(auth: PlatformAuthContext, dto: CreateFoundingInvitationDto) {
    const result = await this.founding.createInvitation(auth.platformAdminId, dto);
    await this.audit(auth, "FOUNDING_INVITATION_CREATED", "OnboardingInvitation", String(result.invitation.id), undefined, undefined, result.invitation);
    return result;
  }

  async approveApplication(
    auth: PlatformAuthContext,
    applicationId: string,
    input: { cohortId?: string; expiresInDays?: number; sendWhatsapp?: boolean },
  ) {
    const application = await this.prisma.foundingAccessApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) throw new NotFoundException("Founding Circle application not found");
    if (!application.phone) {
      throw new BadRequestException("Add a WhatsApp number before inviting this legacy application");
    }
    return this.createInvitation(auth, {
      recipientName: application.ownerName,
      businessName: application.businessName,
      phone: application.phone,
      email: application.email,
      applicationId: application.id,
      cohortId: input.cohortId,
      consentAttested: Boolean(application.whatsappConsentAt),
      sendWhatsapp: input.sendWhatsapp ?? true,
      expiresInDays: input.expiresInDays,
    });
  }

  async invitations(query: AdminListQueryDto) {
    const { page, pageSize, skip } = paging(query);
    const where: Prisma.OnboardingInvitationWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? {
            OR: [
              { recipientName: { contains: query.search, mode: "insensitive" } },
              { businessName: { contains: query.search, mode: "insensitive" } },
              { phone: { contains: query.search } },
              { email: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [records, total] = await Promise.all([
      this.prisma.onboardingInvitation.findMany({
        where,
        include: { cohort: true, messageOutbox: true, enrollment: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      this.prisma.onboardingInvitation.count({ where }),
    ]);
    return pageResult(records.map((item) => this.founding.safeInvitation(item)), total, page, pageSize);
  }

  async revokeInvitation(auth: PlatformAuthContext, id: string, reason: string) {
    const before = await this.prisma.onboardingInvitation.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Invitation not found");
    if (before.status !== "ISSUED") throw new BadRequestException("Only an active invitation can be revoked");
    const invitation = await this.prisma.onboardingInvitation.update({
      where: { id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedByAdminId: auth.platformAdminId,
        revokeReason: reason,
        encryptedToken: null,
      },
    });
    if (before.messageOutboxId) {
      await this.prisma.messageOutbox.updateMany({
        where: {
          id: before.messageOutboxId,
          status: { in: ["PENDING", "FAILED"] },
        },
        data: {
          status: "SUPPRESSED",
          lastError: "Founding Circle invitation was revoked",
        },
      });
    }
    await this.audit(auth, "FOUNDING_INVITATION_REVOKED", "OnboardingInvitation", id, reason, before, invitation);
    return this.founding.safeInvitation(invitation);
  }

  async replaceInvitation(auth: PlatformAuthContext, id: string, sendWhatsapp = true) {
    const existing = await this.prisma.onboardingInvitation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Invitation not found");
    if (existing.status === "REDEEMED") throw new BadRequestException("A redeemed invitation cannot be replaced");
    if (existing.status === "ISSUED") {
      await this.revokeInvitation(auth, id, "Replaced by platform administrator");
    }
    if (existing.messageOutboxId) {
      await this.prisma.messageOutbox.updateMany({
        where: {
          id: existing.messageOutboxId,
          status: { in: ["PENDING", "FAILED"] },
        },
        data: {
          status: "SUPPRESSED",
          lastError: "Founding Circle invitation was replaced",
        },
      });
    }
    if (existing.applicationId) {
      await this.prisma.onboardingInvitation.update({
        where: { id },
        data: { applicationId: null, encryptedToken: null },
      });
    } else if (existing.encryptedToken) {
      await this.prisma.onboardingInvitation.update({
        where: { id },
        data: { encryptedToken: null },
      });
    }
    return this.createInvitation(auth, {
      recipientName: existing.recipientName,
      businessName: existing.businessName,
      phone: existing.phone,
      email: existing.email ?? undefined,
      cohortId: existing.cohortId ?? undefined,
      applicationId: existing.applicationId ?? undefined,
      consentAttested: true,
      sendWhatsapp,
      expiresInDays: 7,
    });
  }

  async cohorts() {
    return this.prisma.foundingCohort.findMany({
      include: { _count: { select: { invitations: true, enrollments: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async createCohort(auth: PlatformAuthContext, dto: CreateFoundingCohortDto) {
    const cohort = await this.prisma.foundingCohort.create({
      data: { ...dto, createdByAdminId: auth.platformAdminId },
    });
    await this.audit(auth, "FOUNDING_COHORT_CREATED", "FoundingCohort", cohort.id, undefined, undefined, cohort);
    return cohort;
  }

  async archiveCohort(auth: PlatformAuthContext, id: string) {
    const before = await this.prisma.foundingCohort.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Founding Circle cohort not found");
    const cohort = await this.prisma.foundingCohort.update({
      where: { id },
      data: { status: "ARCHIVED" },
    });
    await this.audit(auth, "FOUNDING_COHORT_ARCHIVED", "FoundingCohort", id, undefined, before, cohort);
    return cohort;
  }

  async members(includeDemo = false) {
    return this.memberJourneys(includeDemo);
  }

  async createInterview(
    auth: PlatformAuthContext,
    enrollmentId: string,
    dto: CreateResearchInterviewDto,
  ) {
    const interview = await this.prisma.foundingResearchInterview.create({
      data: {
        enrollmentId,
        interviewerAdminId: auth.platformAdminId,
        stage: dto.stage,
        mostValuableOutcome: dto.mostValuableOutcome,
        primaryBlocker: dto.primaryBlocker,
        paidPilotInterest: dto.paidPilotInterest,
        reasonToPayOrNot: dto.reasonToPayOrNot,
        volunteeredPriceAmount: dto.volunteeredPriceAmount,
        volunteeredPriceCurrency: dto.volunteeredPriceCurrency?.toUpperCase(),
        notes: dto.notes,
      },
    });
    await this.audit(auth, "FOUNDING_RESEARCH_RECORDED", "FoundingResearchInterview", interview.id, undefined, undefined, interview);
    return interview;
  }

  async businesses(query: AdminListQueryDto) {
    const { page, pageSize, skip } = paging(query);
    const where: Prisma.BusinessWhereInput = {
      ...(query.includeDemo ? {} : { isDemo: false }),
      ...(query.status ? { platformStatus: query.status as never } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { slug: { contains: query.search, mode: "insensitive" } },
              { owner: { email: { contains: query.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.business.findMany({
        where,
        include: {
          owner: { select: { id: true, name: true, email: true, phone: true } },
          foundingEnrollment: { include: { cohort: true } },
          _count: { select: { members: true, customers: true, products: true, orderRequests: true, sales: true, receipts: true, deliveries: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      this.prisma.business.count({ where }),
    ]);
    return pageResult(items, total, page, pageSize);
  }

  async business(id: string) {
    const business = await this.prisma.business.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true, phone: true } },
        members: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } },
        foundingEnrollment: { include: { cohort: true, interviews: { orderBy: { occurredAt: "desc" } } } },
        supportRequests: { orderBy: { createdAt: "desc" }, take: 20 },
        activityEvents: { orderBy: { createdAt: "desc" }, take: 30 },
        _count: { select: { customers: true, products: true, orderRequests: true, sales: true, receipts: true, deliveries: true } },
      },
    });
    if (!business) throw new NotFoundException("Business not found");
    const sales = await this.prisma.sale.aggregate({
      where: { businessId: id },
      _sum: { total: true },
    });
    return {
      ...business,
      recordedSalesValue: sales._sum.total?.toString() ?? "0",
    };
  }

  async suspendBusiness(auth: PlatformAuthContext, id: string, dto: SuspendBusinessDto) {
    this.requireSuperadmin(auth);
    this.requireRecentStepUp(auth);
    return this.prisma.$transaction(async (tx) => {
      const business = await tx.business.findUnique({ where: { id } });
      if (!business) throw new NotFoundException("Business not found");
      if (dto.confirmation.trim().toLowerCase() !== business.name.trim().toLowerCase()) {
        throw new BadRequestException("Enter the business name exactly to confirm suspension");
      }
      const updated = await tx.business.update({
        where: { id },
        data: {
          platformStatus: "SUSPENDED",
          platformSuspendedAt: new Date(),
          platformSuspensionReason: dto.reason,
          platformSuspendedByAdminId: auth.platformAdminId,
        },
      });
      await this.audit(auth, "BUSINESS_SUSPENDED", "Business", id, dto.reason, business, updated, tx);
      return updated;
    });
  }

  async reactivateBusiness(auth: PlatformAuthContext, id: string, dto: ReactivateBusinessDto) {
    this.requireSuperadmin(auth);
    this.requireRecentStepUp(auth);
    return this.prisma.$transaction(async (tx) => {
      const business = await tx.business.findUnique({ where: { id } });
      if (!business) throw new NotFoundException("Business not found");
      if (dto.confirmation.trim().toLowerCase() !== business.name.trim().toLowerCase()) {
        throw new BadRequestException("Enter the business name exactly to confirm reactivation");
      }
      const updated = await tx.business.update({
        where: { id },
        data: {
          platformStatus: "ACTIVE",
          platformSuspendedAt: null,
          platformSuspensionReason: null,
          platformSuspendedByAdminId: null,
        },
      });
      await this.audit(auth, "BUSINESS_REACTIVATED", "Business", id, dto.reason, business, updated, tx);
      return updated;
    });
  }

  async auditLogs(query: AdminListQueryDto) {
    const { page, pageSize, skip } = paging(query);
    const [items, total] = await Promise.all([
      this.prisma.platformAdminAuditLog.findMany({
        include: { actor: { include: { user: { select: { name: true, email: true } } } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      this.prisma.platformAdminAuditLog.count(),
    ]);
    return pageResult(items, total, page, pageSize);
  }

  async platformAdmins(query: AdminListQueryDto) {
    const { page, pageSize, skip } = paging(query);
    const where: Prisma.PlatformAdminWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? {
            user: {
              OR: [
                { name: { contains: query.search, mode: "insensitive" } },
                { email: { contains: query.search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.platformAdmin.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, name: true, phone: true } },
          _count: { select: { passkeys: true, recoveryCodes: true, sessions: true } },
          sessions: {
            where: { revokedAt: null, expiresAt: { gt: new Date() } },
            select: { id: true },
          },
        },
        orderBy: [{ status: "asc" }, { role: "asc" }, { createdAt: "asc" }],
        skip,
        take: pageSize,
      }),
      this.prisma.platformAdmin.count({ where }),
    ]);
    return pageResult(items, total, page, pageSize);
  }

  async grantPlatformAdmin(
    auth: PlatformAuthContext,
    dto: GrantPlatformAdminDto,
  ) {
    this.requireSuperadmin(auth);
    this.requireRecentStepUp(auth);
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      include: { platformAdmin: true },
    });
    if (!user) throw new NotFoundException("User account not found");
    if (user.platformAdmin) {
      throw new BadRequestException("This user already has platform access");
    }
    return this.prisma.$transaction(async (tx) => {
      const admin = await tx.platformAdmin.create({
        data: { userId: user.id, role: dto.role, lastReviewedAt: new Date() },
        include: { user: { select: { id: true, email: true, name: true, phone: true } } },
      });
      await this.audit(
        auth,
        "PLATFORM_ADMIN_GRANTED",
        "PlatformAdmin",
        admin.id,
        `Granted ${dto.role} access`,
        undefined,
        admin,
        tx,
      );
      return admin;
    });
  }

  async updatePlatformAdmin(
    auth: PlatformAuthContext,
    id: string,
    dto: UpdatePlatformAdminDto,
  ) {
    this.requireSuperadmin(auth);
    this.requireRecentStepUp(auth);
    const before = await this.prisma.platformAdmin.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true, name: true, phone: true } } },
    });
    if (!before) throw new NotFoundException("Platform administrator not found");
    if (dto.confirmation.trim().toLowerCase() !== before.user.email.toLowerCase()) {
      throw new BadRequestException("Enter the administrator email exactly to confirm");
    }
    const nextRole = dto.role ?? before.role;
    const nextStatus = dto.status ?? before.status;
    if (nextRole === before.role && nextStatus === before.status) {
      throw new BadRequestException("Choose a role or status change");
    }
    if (
      before.id === auth.platformAdminId &&
      (nextRole !== "SUPERADMIN" || nextStatus !== "ACTIVE")
    ) {
      throw new BadRequestException("You cannot remove your own SUPERADMIN access");
    }
    if (
      before.role === "SUPERADMIN" &&
      before.status === "ACTIVE" &&
      (nextRole !== "SUPERADMIN" || nextStatus !== "ACTIVE")
    ) {
      const activeSuperadmins = await this.prisma.platformAdmin.count({
        where: { role: "SUPERADMIN", status: "ACTIVE" },
      });
      if (activeSuperadmins <= 1) {
        throw new BadRequestException("At least one active SUPERADMIN is required");
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.platformAdmin.update({
        where: { id },
        data: { role: nextRole, status: nextStatus },
        include: { user: { select: { id: true, email: true, name: true, phone: true } } },
      });
      if (nextStatus === "SUSPENDED") {
        await tx.platformAdminSession.updateMany({
          where: { platformAdminId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit(
        auth,
        "PLATFORM_ADMIN_ACCESS_UPDATED",
        "PlatformAdmin",
        id,
        dto.reason,
        before,
        updated,
        tx,
      );
      return updated;
    });
  }

  async reviewPlatformAdmin(
    auth: PlatformAuthContext,
    id: string,
    dto: ReviewPlatformAdminDto,
  ) {
    this.requireSuperadmin(auth);
    const before = await this.prisma.platformAdmin.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Platform administrator not found");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.platformAdmin.update({
        where: { id },
        data: { lastReviewedAt: new Date() },
        include: { user: { select: { id: true, email: true, name: true } } },
      });
      await this.audit(
        auth,
        "PLATFORM_ADMIN_ACCESS_REVIEWED",
        "PlatformAdmin",
        id,
        dto.notes,
        before,
        updated,
        tx,
      );
      return updated;
    });
  }

  async platformAdminSessions(id: string) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id }, select: { id: true } });
    if (!admin) throw new NotFoundException("Platform administrator not found");
    return this.prisma.platformAdminSession.findMany({
      where: { platformAdminId: id },
      select: {
        id: true,
        authenticationMethod: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        userAgent: true,
        ipHash: true,
        passkey: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async revokePlatformAdminSession(
    auth: PlatformAuthContext,
    adminId: string,
    sessionId: string,
    dto: RevokePlatformSessionDto,
  ) {
    this.requireSuperadmin(auth);
    this.requireRecentStepUp(auth);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.platformAdminSession.findFirst({
        where: { id: sessionId, platformAdminId: adminId },
      });
      if (!existing) throw new NotFoundException("Platform session not found");
      const updated = await tx.platformAdminSession.update({
        where: { id: sessionId },
        data: { revokedAt: existing.revokedAt ?? new Date() },
      });
      await this.audit(
        auth,
        "PLATFORM_ADMIN_SESSION_REVOKED",
        "PlatformAdminSession",
        sessionId,
        dto.reason,
        existing,
        updated,
        tx,
      );
      return updated;
    });
  }

  private async memberJourneys(includeDemo: boolean) {
    const enrollments = await this.prisma.foundingProgramEnrollment.findMany({
      where: includeDemo ? {} : { business: { isDemo: false } },
      include: {
        cohort: true,
        invitation: { select: { codeSuffix: true, createdAt: true } },
        interviews: { orderBy: { occurredAt: "desc" }, take: 3 },
        business: {
          include: {
            owner: { select: { name: true, email: true, phone: true } },
            products: { select: { createdAt: true }, orderBy: { createdAt: "asc" }, take: 1 },
            customers: { select: { createdAt: true }, orderBy: { createdAt: "asc" }, take: 1 },
            orderRequests: { select: { createdAt: true }, orderBy: { createdAt: "asc" }, take: 1 },
            sales: { select: { createdAt: true }, orderBy: { createdAt: "asc" }, take: 1 },
            activityEvents: {
              where: {
                createdAt: { gte: daysAgo(120) },
                type: { in: MEANINGFUL_BUSINESS_ACTIONS },
              },
              select: { createdAt: true, type: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return enrollments.map((enrollment) => {
      const firstMeaningful = earliestDate([
        enrollment.business.customers[0]?.createdAt,
        enrollment.business.orderRequests[0]?.createdAt,
        enrollment.business.sales[0]?.createdAt,
      ]);
      const firstProduct = enrollment.business.products[0]?.createdAt;
      const activationDate =
        firstProduct && firstMeaningful && firstMeaningful.getTime() <= enrollment.onboardedAt.getTime() + 7 * 86_400_000
          ? new Date(Math.max(firstProduct.getTime(), firstMeaningful.getTime()))
          : null;
      return {
        id: enrollment.id,
        status: enrollment.status,
        cohort: enrollment.cohort,
        business: {
          id: enrollment.business.id,
          name: enrollment.business.name,
          slug: enrollment.business.slug,
          platformStatus: enrollment.business.platformStatus,
          owner: enrollment.business.owner,
        },
        invitedAt: enrollment.invitedAt,
        onboardedAt: enrollment.onboardedAt,
        activation: {
          activated: Boolean(activationDate),
          activatedAt: activationDate,
          firstProductAt: firstProduct ?? null,
          firstMeaningfulActionAt: firstMeaningful,
        },
        retention: {
          weekOne: activationDate ? hasEventInWindow(enrollment.business.activityEvents, activationDate, 7, 13) : false,
          weekFour: activationDate ? hasEventInWindow(enrollment.business.activityEvents, activationDate, 28, 34) : false,
        },
        interviews: enrollment.interviews,
      };
    });
  }

  private requireSuperadmin(auth: PlatformAuthContext) {
    if (auth.role !== "SUPERADMIN") throw new ForbiddenException("SUPERADMIN access required");
  }

  private requireRecentStepUp(auth: PlatformAuthContext) {
    if (Date.now() - auth.verifiedAt.getTime() > 10 * 60 * 1000) {
      throw new ForbiddenException("Verify WhatsApp again before changing business access");
    }
  }

  private audit(
    auth: PlatformAuthContext,
    action: string,
    targetType: string,
    targetId?: string,
    reason?: string,
    before?: unknown,
    after?: unknown,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return client.platformAdminAuditLog.create({
      data: {
        actorAdminId: auth.platformAdminId,
        action,
        targetType,
        targetId,
        reason,
        before: redactAudit(before) as Prisma.InputJsonValue | undefined,
        after: redactAudit(after) as Prisma.InputJsonValue | undefined,
        requestId: auth.requestId,
        ipHash: auth.ipHash,
        userAgent: auth.userAgent,
      },
    });
  }
}

function paging(query: AdminListQueryDto) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000);
}

function percentage(value: number, total: number) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}

function earliestDate(values: Array<Date | undefined>) {
  const dates = values.filter((value): value is Date => Boolean(value));
  return dates.length ? new Date(Math.min(...dates.map((value) => value.getTime()))) : null;
}

function hasEventInWindow(
  events: Array<{ createdAt: Date }>,
  activation: Date,
  startDay: number,
  endDay: number,
) {
  const start = activation.getTime() + startDay * 86_400_000;
  const end = activation.getTime() + (endDay + 1) * 86_400_000;
  return events.some((event) => event.createdAt.getTime() >= start && event.createdAt.getTime() < end);
}

function redactAudit(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(redactAudit);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = /(?:code|credential|encrypted|password|secret|token)hash|privatekey/i.test(key)
      ? "[REDACTED]"
      : redactAudit(child);
  }
  return result;
}
