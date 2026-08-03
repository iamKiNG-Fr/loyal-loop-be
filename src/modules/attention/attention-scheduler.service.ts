import { ForbiddenException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import type { OwnerAuthContext } from "../../common/request-context";
import { MessagingService } from "../messaging/messaging.service";
import { PrismaService } from "../prisma/prisma.service";
import { AttentionService, businessDay } from "./attention.service";
import { WebPushService } from "./web-push.service";

@Injectable()
export class AttentionSchedulerService {
  private readonly logger = new Logger(AttentionSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly attention: AttentionService,
    private readonly messaging: MessagingService,
    private readonly push: WebPushService,
  ) {}

  assertSecret(candidate: string | undefined) {
    const expected = this.config.get<string>("REMINDER_SCHEDULER_SECRET");
    if (!expected) throw new ServiceUnavailableException("Reminder scheduler is not configured");
    const left = Buffer.from(candidate || "");
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new ForbiddenException("Reminder scheduler secret is invalid");
    }
  }

  async run(now = new Date()) {
    const preferences = await this.prisma.businessPreferences.findMany({
      where: {
        dailyDigestPausedAt: null,
        OR: [
          { dailyDigestWhatsapp: true },
          { pushNotificationsEnabled: true },
        ],
        business: { platformStatus: "ACTIVE" },
      },
      include: {
        business: {
          select: {
            id: true,
            name: true,
            ownerId: true,
            owner: { select: { name: true, phone: true } },
          },
        },
      },
      take: 500,
    });

    const result = {
      checked: preferences.length,
      digestsQueued: 0,
      pushSent: 0,
      skippedEmpty: 0,
      urgentPushSent: 0,
      failures: 0,
    };

    for (const preference of preferences) {
      try {
        const auth = {
          businessId: preference.businessId,
          userId: preference.business.ownerId,
        } as Pick<OwnerAuthContext, "businessId" | "userId">;
        const snapshot = await this.attention.get(auth, now);

        if (preference.pushNotificationsEnabled && withinOwnerPushWindow(preference.timezone, now)) {
          const urgent = snapshot.alerts.filter((item) => item.priority === "URGENT" && !item.seen);
          if (urgent.length) {
            const unpushed = await this.unpushed(auth, urgent.map((item) => item.key));
            if (unpushed.length) {
              const unpushedKeys = new Set(unpushed);
              const urgentToPush = urgent.filter((item) => unpushedKeys.has(item.key));
              try {
                const pushed = await this.push.sendToOwner(auth.businessId, auth.userId, {
                  title: urgentToPush.length === 1 ? urgentToPush[0]!.title : `${urgentToPush.length} things need attention`,
                  body: urgentToPush.length === 1 ? urgentToPush[0]!.detail : digestSummary(urgentToPush),
                  url: "/dashboard?today=1",
                  tag: `loyal-loop-urgent-${snapshot.businessDate}`,
                });
                result.urgentPushSent += pushed.sent;
                if (pushed.sent) await this.markPushed(auth, unpushed);
              } catch (error) {
                result.failures += 1;
                const message = error instanceof Error ? error.message : "unknown error";
                this.logger.warn(`Urgent push failed for business ${preference.businessId}: ${message}`);
              }
            }
          }
        }

        if (!digestDue(preference, now)) continue;
        if (!snapshot.tasks.length) {
          result.skippedEmpty += 1;
          await this.markDigestChecked(preference.businessId, now);
          continue;
        }

        const appUrl = this.config.get<string>("APP_URL", "https://www.useloyalloop.com").replace(/\/$/, "");
        const summary = digestSummary(snapshot.tasks);
        if (
          preference.dailyDigestWhatsapp
          && preference.dailyDigestConsentAt
          && preference.dailyDigestPhone
        ) {
          const queued = await this.messaging.enqueueOwnerDigest({
            businessId: preference.businessId,
            userId: preference.business.ownerId,
            phone: preference.dailyDigestPhone,
            ownerName: preference.business.owner.name,
            businessName: preference.business.name,
            summary: `${summary} ${snapshot.careGoal.message}`,
            url: `${appUrl}/dashboard?today=1`,
            businessDate: snapshot.businessDate,
          });
          if (["PENDING", "SENT", "DELIVERED"].includes(queued.status)) result.digestsQueued += 1;
        }
        if (preference.pushNotificationsEnabled) {
          const pushed = await this.push.sendToOwner(preference.businessId, preference.business.ownerId, {
            title: `Today's checklist · ${preference.business.name}`,
            body: summary,
            url: "/dashboard?today=1",
            tag: `loyal-loop-digest-${snapshot.businessDate}`,
          });
          result.pushSent += pushed.sent;
        }
        await this.markDigestChecked(preference.businessId, now);
      } catch (error) {
        result.failures += 1;
        const message = error instanceof Error ? error.message : "unknown error";
        this.logger.warn(`Reminder schedule failed for business ${preference.businessId}: ${message}`);
      }
    }
    return result;
  }

  async sendPushTest(auth: OwnerAuthContext) {
    return this.push.sendToOwner(auth.businessId, auth.userId, {
      title: "Loyal Loop notifications are ready",
      body: "Orders, customer issues and today's checklist can now reach this device.",
      url: "/dashboard?today=1",
      tag: "loyal-loop-push-test",
    });
  }

  private async unpushed(
    auth: Pick<OwnerAuthContext, "businessId" | "userId">,
    keys: string[],
  ) {
    const pushed = await this.prisma.ownerAttentionReceipt.findMany({
      where: {
        businessId: auth.businessId,
        userId: auth.userId,
        itemKey: { in: keys },
        pushedAt: { not: null },
      },
      select: { itemKey: true },
    });
    const pushedKeys = new Set(pushed.map((item) => item.itemKey));
    return keys.filter((key) => !pushedKeys.has(key));
  }

  private async markPushed(
    auth: Pick<OwnerAuthContext, "businessId" | "userId">,
    keys: string[],
  ) {
    const now = new Date();
    await this.prisma.$transaction(keys.map((itemKey) => this.prisma.ownerAttentionReceipt.upsert({
      where: { businessId_userId_itemKey: { businessId: auth.businessId, userId: auth.userId, itemKey } },
      create: { businessId: auth.businessId, userId: auth.userId, itemKey, pushedAt: now },
      update: { pushedAt: now },
    })));
  }

  private markDigestChecked(businessId: string, now: Date) {
    return this.prisma.businessPreferences.update({
      where: { businessId },
      data: { lastDailyDigestAt: now },
    });
  }
}

export function digestDue(preference: {
  timezone: string;
  dailyDigestTime: string;
  dailyDigestWeekdays: number[];
  lastDailyDigestAt: Date | null;
}, now: Date) {
  const parts = localParts(now, preference.timezone);
  if (!preference.dailyDigestWeekdays.includes(parts.weekday)) return false;
  if (preference.lastDailyDigestAt && businessDay(preference.lastDailyDigestAt, preference.timezone) === parts.date) {
    return false;
  }
  const [hour, minute] = preference.dailyDigestTime.split(":").map(Number);
  const targetMinutes = (hour || 0) * 60 + (minute || 0);
  const currentMinutes = parts.hour * 60 + parts.minute;
  return currentMinutes >= targetMinutes && currentMinutes < targetMinutes + 180;
}

export function withinOwnerPushWindow(timezone: string, now: Date) {
  const { hour } = localParts(now, timezone);
  return hour >= 7 && hour < 21;
}

function localParts(date: Date, timezone: string) {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => formatted.find((part) => part.type === type)?.value || "";
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[value("weekday")] ?? 1;
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekday,
  };
}

function digestSummary(items: Array<{ kind: string; title: string }>) {
  const labels: Record<string, string> = {
    ISSUE: "customer issue",
    ORDER: "order request",
    PAYMENT: "payment proof",
    DELIVERY: "delivery",
    FOLLOW_UP: "follow-up",
    LOW_STOCK: "stock check",
    INVENTORY: "inventory check",
  };
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) || 0) + 1);
  const parts = [...counts.entries()].slice(0, 5).map(([kind, count]) => {
    const label = labels[kind] || "task";
    return `${count} ${label}${count === 1 ? "" : "s"}`;
  });
  return `${items.length} thing${items.length === 1 ? "" : "s"} need attention: ${parts.join(" · ")}.`;
}
