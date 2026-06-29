import { Injectable } from "@nestjs/common";
import type { OwnerAuthContext } from "../../common/request-context";
import { ActivityService } from "../activity/activity.service";
import { PrismaService } from "../prisma/prisma.service";

const DISCLAIMER =
  "Trust levels reflect recorded Loyal Loop activity and are not business verification.";

@Injectable()
export class TrustService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async completeInventoryCheck(auth: OwnerAuthContext) {
    const preferences = await this.prisma.businessPreferences.findUnique({
      where: { businessId: auth.businessId },
    });
    const timezone = preferences?.timezone ?? "Africa/Lagos";
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const today = formatter.format(new Date());
    const recent = await this.prisma.activityEvent.findMany({
      where: {
        businessId: auth.businessId,
        type: "INVENTORY_CHECKED",
        createdAt: { gte: new Date(Date.now() - 36 * 60 * 60 * 1000) },
      },
    });
    if (recent.some((event) => formatter.format(event.createdAt) === today)) {
      return this.summary(auth.businessId);
    }
    await this.activity.record({
      businessId: auth.businessId,
      actorId: auth.userId,
      type: "INVENTORY_CHECKED",
      title: "Completed today's stock check",
    });

    const dates = await this.prisma.activityEvent.findMany({
      where: { businessId: auth.businessId },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const streak = currentStreak(
      uniqueBusinessDays(
        dates.map((entry) => entry.createdAt),
        timezone,
      ),
      businessDay(new Date(), timezone),
    );
    if (streak >= 7) {
      const existingAward = await this.prisma.activityEvent.findFirst({
        where: {
          businessId: auth.businessId,
          type: "STREAK_COMPLETED",
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      });
      if (!existingAward) {
        await this.activity.record({
          businessId: auth.businessId,
          actorId: auth.userId,
          type: "STREAK_COMPLETED",
          title: "Completed a seven-day care streak",
        });
      }
    }
    return this.summary(auth.businessId);
  }

  async summary(businessId: string, includePrivate = true) {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      business,
      points,
      sentReceipts,
      confirmedDeliveries,
      feedbackAggregate,
      staleIssues,
      repeatCustomerGroups,
      followUps,
      completedSales,
      customerCount,
      activityDates,
      notes,
    ] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        include: { preferences: true },
      }),
      this.prisma.trustLedgerEntry.aggregate({
        where: { businessId },
        _sum: { points: true },
      }),
      this.prisma.receipt.count({
        where: { businessId, status: { in: ["SENT", "VIEWED"] } },
      }),
      this.prisma.delivery.count({
        where: { businessId, status: "CONFIRMED" },
      }),
      this.prisma.customerFeedback.aggregate({
        where: { businessId },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      this.prisma.customerIssue.count({
        where: { businessId, status: "OPEN", openedAt: { lt: sevenDaysAgo } },
      }),
      this.prisma.sale.groupBy({
        by: ["customerId"],
        where: { businessId, status: "COMPLETED" },
        _count: { id: true },
        having: { id: { _count: { gte: 2 } } },
      }),
      this.prisma.followUpSuggestion.count({
        where: {
          businessId,
          status: "COMPLETED",
          completedAt: { gte: ninetyDaysAgo },
        },
      }),
      this.prisma.sale.count({
        where: { businessId, status: "COMPLETED" },
      }),
      this.prisma.customer.count({ where: { businessId } }),
      this.prisma.activityEvent.findMany({
        where: { businessId },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.customerNote.count({
        where: { customer: { businessId } },
      }),
    ]);

    const timezone = business.preferences?.timezone ?? "Africa/Lagos";
    const activeDays = uniqueBusinessDays(
      activityDates.map((entry) => entry.createdAt),
      timezone,
    );
    const streak = currentStreak(activeDays, businessDay(new Date(), timezone));
    const feedbackCount = feedbackAggregate._count.rating;
    const repeatCustomers = repeatCustomerGroups.length;
    const profileComplete = Boolean(
      business.name && business.category && business.location && business.pledgedAt,
    );
    const level = calculateTrustLevel({
      profileComplete,
      sentReceipts,
      confirmedDeliveries,
      feedbackCount,
      staleIssues,
      repeatCustomers,
      followUps,
      activeDays: activeDays.length,
    });

    const repeatRate =
      completedSales > 0 ? repeatCustomers / completedSales : 0;
    const loyaltyHealth = calculateLoyaltyHealth({
      completedSales,
      customerCount,
      repeatRate,
      staleIssues,
    });

    return {
      disclaimer: DISCLAIMER,
      level,
      levelName: [
        "Not started",
        "Owner started",
        "Building trust",
        "Trusted shop",
        "Reliable favourite",
        "Established loop",
      ][level],
      streakDays: streak,
      feedbackAverage: feedbackAggregate._avg.rating,
      feedbackCount,
      loyaltyHealth,
      badges: [
        { key: "clear-seller", unlocked: sentReceipts >= 5 },
        {
          key: "memory-keeper",
          unlocked: notes >= 5 && repeatCustomers >= 3,
        },
        { key: "community", unlocked: false },
      ],
      progress: {
        sentReceipts,
        confirmedDeliveries,
        feedbackCount,
        repeatCustomers,
        completedFollowUps90Days: followUps,
        activeDays: activeDays.length,
        staleIssues,
      },
      ...(includePrivate ? { points: points._sum.points ?? 0 } : {}),
    };
  }
}

export function uniqueBusinessDays(dates: Date[], timezone: string) {
  return [...new Set(dates.map((date) => businessDay(date, timezone)))].sort();
}

export function currentStreak(
  days: string[],
  today = new Date().toISOString().slice(0, 10),
) {
  if (!days.length) return 0;
  const latest = Date.parse(days[days.length - 1]);
  const todayValue = Date.parse(today);
  const age = todayValue - latest;
  if (age < 0 || age > 24 * 60 * 60 * 1000) return 0;
  let streak = 1;
  for (let index = days.length - 1; index > 0; index -= 1) {
    const current = Date.parse(days[index]);
    const previous = Date.parse(days[index - 1]);
    if (current - previous !== 24 * 60 * 60 * 1000) break;
    streak += 1;
  }
  return streak;
}

function businessDay(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function calculateTrustLevel(input: {
  profileComplete: boolean;
  sentReceipts: number;
  confirmedDeliveries: number;
  feedbackCount: number;
  staleIssues: number;
  repeatCustomers: number;
  followUps: number;
  activeDays: number;
}) {
  let level = input.profileComplete ? 1 : 0;
  if (level >= 1 && input.sentReceipts >= 5) level = 2;
  if (
    level >= 2 &&
    input.confirmedDeliveries >= 10 &&
    input.feedbackCount >= 5 &&
    input.staleIssues === 0
  ) {
    level = 3;
  }
  if (level >= 3 && input.repeatCustomers >= 5 && input.followUps >= 10) {
    level = 4;
  }
  if (
    level >= 4 &&
    input.activeDays >= 90 &&
    input.confirmedDeliveries >= 50 &&
    input.feedbackCount >= 25 &&
    input.staleIssues === 0
  ) {
    level = 5;
  }
  return level;
}

export function calculateLoyaltyHealth(input: {
  completedSales: number;
  customerCount: number;
  repeatRate: number;
  staleIssues: number;
}) {
  if (input.completedSales < 5 || input.customerCount < 3) return "BUILDING";
  return input.repeatRate >= 0.25 && input.staleIssues === 0
    ? "HEALTHY"
    : "NEEDS_ATTENTION";
}
