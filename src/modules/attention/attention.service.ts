import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import type { OwnerAuthContext } from "../../common/request-context";
import { MessagingService } from "../messaging/messaging.service";
import { normalizeE164 } from "../messaging/twilio-whatsapp.provider";
import { PrismaService } from "../prisma/prisma.service";
import type {
  MarkAttentionSeenDto,
  RemovePushSubscriptionDto,
  SavePushSubscriptionDto,
  SnoozeAttentionDto,
  UpdateOwnerNotificationPreferencesDto,
} from "./dto/attention.dto";
import type { AttentionItem, AttentionKind, AttentionPriority } from "./attention.types";

const DIGEST_CONSENT_VERSION = "owner-daily-digest-v1";
const CUSTOMER_MEMORY_CONSENT_VERSION = "customer-memory-prompt-v1";
const MEANINGFUL_CARE_TYPES = [
  "SALE_LOGGED",
  "PAYMENT_UPDATED",
  "RECEIPT_SENT",
  "DELIVERY_STATUS_UPDATED",
  "DELIVERY_CONFIRMED",
  "ISSUE_RESOLVED",
  "FOLLOW_UP_SENT",
  "ORDER_REQUEST_REVIEWED",
] as const;

@Injectable()
export class AttentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly messaging: MessagingService,
  ) {}

  async get(auth: Pick<OwnerAuthContext, "businessId" | "userId">, now = new Date()) {
    const preferences = await this.ensurePreferences(auth.businessId);
    const timezone = preferences.timezone || "Africa/Lagos";
    const today = businessDay(now, timezone);
    const threshold = Math.max(1, preferences.lowStockThreshold || 5);
    const broadFuture = new Date(now.getTime() + 40 * 60 * 60 * 1000);
    const recentBoundary = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const [
      issues,
      requests,
      paymentProofs,
      deliveries,
      followUps,
      lowStock,
      recentActivity,
      recentCareActivity,
    ] = await Promise.all([
      this.prisma.customerIssue.findMany({
        where: { businessId: auth.businessId, status: "OPEN" },
        include: {
          customer: { select: { name: true } },
          sale: { select: { referenceCode: true } },
        },
        orderBy: { openedAt: "asc" },
        take: 10,
      }),
      this.prisma.orderRequest.findMany({
        where: {
          businessId: auth.businessId,
          status: { in: ["SENT", "ACCEPTED", "NEEDS_CHANGES"] },
        },
        orderBy: { createdAt: "asc" },
        take: 12,
      }),
      this.prisma.paymentProof.findMany({
        where: { businessId: auth.businessId, status: "SUBMITTED" },
        include: {
          sale: {
            select: {
              referenceCode: true,
              customer: { select: { name: true } },
            },
          },
        },
        orderBy: { submittedAt: "asc" },
        take: 10,
      }),
      this.prisma.delivery.findMany({
        where: {
          businessId: auth.businessId,
          status: { in: ["PREPARING", "READY_FOR_PICKUP", "IN_TRANSIT", "DELIVERED"] },
        },
        include: {
          customer: { select: { name: true } },
          sale: { select: { referenceCode: true } },
        },
        orderBy: { updatedAt: "asc" },
        take: 12,
      }),
      this.prisma.followUpSuggestion.findMany({
        where: {
          businessId: auth.businessId,
          status: { in: ["SUGGESTED", "APPROVED"] },
          dueAt: { not: null, lte: broadFuture },
        },
        include: { customer: { select: { name: true } } },
        orderBy: { dueAt: "asc" },
        take: 10,
      }),
      this.prisma.product.findMany({
        where: {
          businessId: auth.businessId,
          status: "ACTIVE",
          stockCount: { not: null, lte: threshold },
        },
        select: { id: true, name: true, stockCount: true, updatedAt: true },
        orderBy: [{ stockCount: "asc" }, { updatedAt: "asc" }],
        take: 12,
      }),
      this.prisma.activityEvent.findMany({
        where: { businessId: auth.businessId },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      this.prisma.activityEvent.findMany({
        where: {
          businessId: auth.businessId,
          createdAt: { gte: recentBoundary },
          type: { in: [...MEANINGFUL_CARE_TYPES, "INVENTORY_CHECKED"] },
        },
        select: { createdAt: true, type: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const rawTasks: Omit<AttentionItem, "seen" | "snoozedUntil">[] = [];

    for (const issue of issues) {
      rawTasks.push(task({
        key: `issue:${issue.id}`,
        kind: "ISSUE",
        priority: "URGENT",
        title: `Reply to ${issue.customer?.name || "a customer"}`,
        detail: `${issue.sale.referenceCode} has an open issue · ${ageLabel(issue.openedAt, now)}.`,
        to: `/dashboard/issues?issue=${encodeURIComponent(issue.id)}`,
        createdAt: issue.openedAt,
      }));
    }

    for (const request of requests) {
      const unread = !request.ownerReadAt;
      const overdue = hoursOld(request.createdAt, now) >= 12;
      rawTasks.push(task({
        key: `order:${request.id}`,
        kind: "ORDER",
        priority: unread || overdue ? "URGENT" : "IMPORTANT",
        title: request.status === "NEEDS_CHANGES"
          ? `Continue ${request.customerName}'s request`
          : `Review ${request.customerName}'s order request`,
        detail: `${request.referenceCode} · ${unread ? "not opened" : request.status.toLowerCase().replace(/_/g, " ")} · ${ageLabel(request.createdAt, now)}.`,
        to: `/dashboard/orders?request=${encodeURIComponent(request.id)}`,
        createdAt: request.createdAt,
      }));
    }

    for (const proof of paymentProofs) {
      rawTasks.push(task({
        key: `payment:${proof.id}`,
        kind: "PAYMENT",
        priority: "URGENT",
        title: `Check ${proof.sale.customer.name}'s transfer proof`,
        detail: `${proof.sale.referenceCode} has waited ${ageLabel(proof.submittedAt, now)}.`,
        to: `/dashboard/sales/payments?proof=${encodeURIComponent(proof.id)}`,
        createdAt: proof.submittedAt,
      }));
    }

    for (const delivery of deliveries) {
      const stale = hoursOld(delivery.updatedAt, now) >= 24;
      const waitingForConfirmation = delivery.status === "DELIVERED";
      rawTasks.push(task({
        key: `delivery:${delivery.id}`,
        kind: "DELIVERY",
        priority: waitingForConfirmation || stale ? "IMPORTANT" : "ROUTINE",
        title: waitingForConfirmation
          ? `Get ${delivery.customer.name}'s delivery confirmed`
          : `Update ${delivery.customer.name}'s delivery`,
        detail: `${delivery.sale.referenceCode} is ${delivery.status.toLowerCase().replace(/_/g, " ")} · last changed ${ageLabel(delivery.updatedAt, now)}.`,
        to: `/dashboard/deliveries?delivery=${encodeURIComponent(delivery.id)}`,
        createdAt: delivery.updatedAt,
      }));
    }

    for (const followUp of followUps) {
      if (!followUp.dueAt || businessDay(followUp.dueAt, timezone) > today) continue;
      rawTasks.push(task({
        key: `follow-up:${followUp.id}`,
        kind: "FOLLOW_UP",
        priority: businessDay(followUp.dueAt, timezone) < today ? "IMPORTANT" : "ROUTINE",
        title: `Follow up with ${followUp.customer.name}`,
        detail: followUp.reason,
        to: `/dashboard/customers?focus=${encodeURIComponent(followUp.customer.name)}&followUp=${encodeURIComponent(followUp.id)}`,
        createdAt: followUp.createdAt,
        dueAt: followUp.dueAt,
      }));
    }

    if (lowStock.length) {
      const preview = lowStock.slice(0, 3).map((product) => `${product.name} (${product.stockCount ?? 0})`).join(", ");
      rawTasks.push(task({
        key: `low-stock:${today}`,
        kind: "LOW_STOCK",
        priority: lowStock.some((product) => (product.stockCount ?? 0) === 0) ? "IMPORTANT" : "ROUTINE",
        title: lowStock.some((product) => (product.stockCount ?? 0) === 0)
          ? "Restock unavailable products"
          : "Check low-stock products",
        detail: `${preview}${lowStock.length > 3 ? ` and ${lowStock.length - 3} more` : ""}.`,
        to: "/dashboard/products?filter=low-stock",
        createdAt: lowStock[0]?.updatedAt || now,
      }));
    }

    const todaysCare = recentCareActivity.filter((entry) => businessDay(entry.createdAt, timezone) === today);
    const inventoryComplete = todaysCare.some((entry) => entry.type === "INVENTORY_CHECKED");
    const customerCareCompleted = todaysCare.some((entry) => entry.type !== "INVENTORY_CHECKED");
    if (!inventoryComplete) {
      rawTasks.push(task({
        key: `inventory:${today}`,
        kind: "INVENTORY",
        priority: "ROUTINE",
        title: "Confirm today's visible inventory",
        detail: `Check that customer-facing stock is accurate. The low-stock threshold is ${threshold}.`,
        to: "/dashboard/trust-rewards?inventory=1",
        createdAt: now,
      }));
    }

    const relevantKeys = [
      ...rawTasks.map((item) => item.key),
      ...recentActivity.map((event) => `activity:${event.id}`),
    ];
    const receipts = relevantKeys.length
      ? await this.prisma.ownerAttentionReceipt.findMany({
          where: {
            businessId: auth.businessId,
            userId: auth.userId,
            itemKey: { in: relevantKeys },
          },
        })
      : [];
    const receiptByKey = new Map(receipts.map((entry) => [entry.itemKey, entry]));

    const tasks = rawTasks
      .map((item) => decorate(item, receiptByKey.get(item.key)))
      .filter((item) => !item.snoozedUntil || item.snoozedUntil <= now)
      .sort(compareAttention)
      .slice(0, 30);

    const taskKeys = new Set(tasks.map((item) => item.key));
    const activityAlerts = recentActivity.filter((event) => activityEnabled(event.type, preferences)).map((event) => decorate({
      key: `activity:${event.id}`,
      kind: "ACTIVITY" as const,
      priority: "ROUTINE" as const,
      title: event.title,
      detail: activityDescription(event.type),
      to: activityDestination(event),
      createdAt: event.createdAt,
      streakEligible: false,
    }, receiptByKey.get(`activity:${event.id}`)));
    const alerts = [
      ...tasks.filter((item) => taskAlertEnabled(item.kind, preferences)),
      ...activityAlerts.filter((item) => !taskKeys.has(item.key)),
    ]
      .filter((item) => !item.snoozedUntil || item.snoozedUntil <= now)
      .sort(compareAttention)
      .slice(0, 20);

    const hasCustomerWork = tasks.some((item) => item.streakEligible && item.kind !== "INVENTORY") || customerCareCompleted;
    const careTarget = hasCustomerWork ? 2 : 1;
    const careCompleted = Math.min(careTarget, Number(inventoryComplete) + Number(customerCareCompleted));

    return {
      generatedAt: now,
      businessDate: today,
      timezone,
      tasks,
      alerts,
      unseenCount: alerts.filter((item) => !item.seen).length,
      careGoal: {
        target: careTarget,
        completed: careCompleted,
        complete: careCompleted >= careTarget,
        inventoryComplete,
        customerCareComplete: customerCareCompleted,
        message: hasCustomerWork
          ? "Complete one customer-facing action and confirm inventory."
          : "Confirm inventory to complete today's care goal.",
      },
    };
  }

  async markSeen(auth: OwnerAuthContext, dto: MarkAttentionSeenDto) {
    const now = new Date();
    const keys = [...new Set(dto.keys.map((key) => key.trim()).filter(Boolean))];
    await this.prisma.$transaction(keys.map((itemKey) => this.prisma.ownerAttentionReceipt.upsert({
      where: { businessId_userId_itemKey: { businessId: auth.businessId, userId: auth.userId, itemKey } },
      create: { businessId: auth.businessId, userId: auth.userId, itemKey, seenAt: now },
      update: { seenAt: now },
    })));
    return { seenAt: now, keys };
  }

  async snooze(auth: OwnerAuthContext, dto: SnoozeAttentionDto) {
    const until = new Date(dto.until);
    if (until <= new Date() || until.getTime() > Date.now() + 30 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException("Snooze must end within the next 30 days");
    }
    return this.prisma.ownerAttentionReceipt.upsert({
      where: {
        businessId_userId_itemKey: {
          businessId: auth.businessId,
          userId: auth.userId,
          itemKey: dto.key.trim(),
        },
      },
      create: {
        businessId: auth.businessId,
        userId: auth.userId,
        itemKey: dto.key.trim(),
        seenAt: new Date(),
        snoozedUntil: until,
      },
      update: { seenAt: new Date(), snoozedUntil: until },
    });
  }

  async preferences(auth: OwnerAuthContext) {
    const [preferences, user, subscriptionCount] = await Promise.all([
      this.ensurePreferences(auth.businessId),
      this.prisma.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: { phone: true },
      }),
      this.prisma.ownerPushSubscription.count({
        where: { businessId: auth.businessId, userId: auth.userId },
      }),
    ]);
    const currentPhone = user.phone ? normalizeE164(user.phone) : null;
    return {
      whatsappDigestEnabled: preferences.dailyDigestWhatsapp,
      whatsappConsentGranted: Boolean(
        preferences.dailyDigestConsentAt
        && preferences.dailyDigestPhone
        && preferences.dailyDigestPhone === currentPhone,
      ),
      digestTime: preferences.dailyDigestTime,
      weekdays: preferences.dailyDigestWeekdays,
      paused: Boolean(preferences.dailyDigestPausedAt),
      phone: currentPhone,
      digestPhone: preferences.dailyDigestPhone,
      customerMemoryWhatsappEnabled: preferences.customerMemoryWhatsapp,
      customerMemoryConsentGranted: Boolean(
        preferences.customerMemoryConsentAt
        && preferences.customerMemoryPhone
        && preferences.customerMemoryPhone === currentPhone,
      ),
      customerMemoryPhone: preferences.customerMemoryPhone,
      pushEnabled: preferences.pushNotificationsEnabled,
      pushSubscriptionCount: subscriptionCount,
      vapidPublicKey: this.webPushConfigured()
        ? this.config.get<string>("WEB_PUSH_VAPID_PUBLIC_KEY") || null
        : null,
      lowStockThreshold: preferences.lowStockThreshold,
      followUpNotifications: preferences.notifyFollowUps,
      receiptViewNotifications: preferences.notifyReceiptViews,
      deliveryNotifications: preferences.notifyDeliveryUpdates,
      timezone: preferences.timezone,
    };
  }

  async updatePreferences(auth: OwnerAuthContext, dto: UpdateOwnerNotificationPreferencesDto) {
    const [business, current] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({
        where: { id: auth.businessId },
        select: { ownerId: true, owner: { select: { phone: true } } },
      }),
      this.ensurePreferences(auth.businessId),
    ]);
    if (business.ownerId !== auth.userId) {
      throw new ForbiddenException("Only the business owner can change owner reminder delivery");
    }
    const enablingWhatsapp = dto.whatsappDigestEnabled === true;
    const enablingCustomerMemory = dto.customerMemoryWhatsappEnabled === true;
    const phone = business.owner.phone ? normalizeE164(business.owner.phone) : null;
    const digestPhoneChanged = Boolean(
      enablingWhatsapp
      && current.dailyDigestPhone
      && current.dailyDigestPhone !== phone,
    );
    const customerMemoryPhoneChanged = Boolean(
      enablingCustomerMemory
      && current.customerMemoryPhone
      && current.customerMemoryPhone !== phone,
    );
    if (enablingWhatsapp && !phone) {
      throw new BadRequestException("Verify the owner WhatsApp number before enabling the digest");
    }
    if (
      enablingWhatsapp
      && (!current.dailyDigestConsentAt || digestPhoneChanged)
      && dto.whatsappConsentAccepted !== true
    ) {
      throw new BadRequestException("Accept the WhatsApp digest notice before enabling reminders");
    }
    if (enablingCustomerMemory && !phone) {
      throw new BadRequestException("Verify the owner WhatsApp number before enabling customer note prompts");
    }
    if (
      enablingCustomerMemory
      && (!current.customerMemoryConsentAt || customerMemoryPhoneChanged)
      && dto.customerMemoryConsentAccepted !== true
    ) {
      throw new BadRequestException("Accept the WhatsApp customer note notice before enabling prompts");
    }

    const weekdays = dto.weekdays
      ? [...new Set(dto.weekdays)].sort((left, right) => left - right)
      : undefined;
    const consentAt = enablingWhatsapp
      ? digestPhoneChanged ? new Date() : current.dailyDigestConsentAt || new Date()
      : dto.whatsappDigestEnabled === false
        ? null
        : undefined;
    const customerMemoryConsentAt = enablingCustomerMemory
      ? customerMemoryPhoneChanged ? new Date() : current.customerMemoryConsentAt || new Date()
      : dto.customerMemoryWhatsappEnabled === false
        ? null
        : undefined;
    const saved = await this.prisma.businessPreferences.update({
      where: { businessId: auth.businessId },
      data: {
        dailyDigestWhatsapp: dto.whatsappDigestEnabled,
        dailyDigestTime: dto.digestTime,
        dailyDigestWeekdays: weekdays,
        dailyDigestPhone: dto.whatsappDigestEnabled === false ? null : enablingWhatsapp ? phone : undefined,
        dailyDigestConsentAt: consentAt,
        dailyDigestConsentVersion: enablingWhatsapp ? DIGEST_CONSENT_VERSION : dto.whatsappDigestEnabled === false ? null : undefined,
        dailyDigestPausedAt: dto.paused === undefined ? undefined : dto.paused ? new Date() : null,
        customerMemoryWhatsapp: dto.customerMemoryWhatsappEnabled,
        customerMemoryPhone: dto.customerMemoryWhatsappEnabled === false
          ? null
          : enablingCustomerMemory ? phone : undefined,
        customerMemoryConsentAt,
        customerMemoryConsentVersion: enablingCustomerMemory
          ? CUSTOMER_MEMORY_CONSENT_VERSION
          : dto.customerMemoryWhatsappEnabled === false ? null : undefined,
        pushNotificationsEnabled: dto.pushEnabled,
        lowStockThreshold: dto.lowStockThreshold,
        notifyFollowUps: dto.followUpNotifications,
        notifyReceiptViews: dto.receiptViewNotifications,
        notifyDeliveryUpdates: dto.deliveryNotifications,
      },
    });

    if (dto.whatsappDigestEnabled === true && phone) {
      if (digestPhoneChanged && current.dailyDigestPhone) {
        await this.messaging.revokePhoneConsent(
          current.dailyDigestPhone,
          "OWNER_DIGEST",
          "owner-notification-settings-phone-change",
        );
      }
      await this.messaging.grantPhoneConsent(
        phone,
        "OWNER_DIGEST",
        "owner-notification-settings",
        undefined,
        auth.userId,
      );
    }
    if (dto.whatsappDigestEnabled === false && current.dailyDigestPhone) {
      await this.messaging.revokePhoneConsent(
        current.dailyDigestPhone,
        "OWNER_DIGEST",
        "owner-notification-settings",
      );
    }
    if (dto.customerMemoryWhatsappEnabled === true && phone) {
      if (customerMemoryPhoneChanged && current.customerMemoryPhone) {
        await this.messaging.revokePhoneConsent(
          current.customerMemoryPhone,
          "CUSTOMER_MEMORY",
          "owner-customer-memory-settings-phone-change",
        );
      }
      await this.messaging.grantPhoneConsent(
        phone,
        "CUSTOMER_MEMORY",
        "owner-customer-memory-settings",
        undefined,
        auth.userId,
      );
    }
    if (dto.customerMemoryWhatsappEnabled === false && current.customerMemoryPhone) {
      await this.messaging.revokePhoneConsent(
        current.customerMemoryPhone,
        "CUSTOMER_MEMORY",
        "owner-customer-memory-settings",
      );
    }
    return this.preferences(auth);
  }

  async savePushSubscription(auth: OwnerAuthContext, dto: SavePushSubscriptionDto, userAgent?: string) {
    if (!this.webPushConfigured()) {
      throw new ServiceUnavailableException("Web Push is not configured");
    }
    assertTrustedPushEndpoint(dto.endpoint);
    const endpointHash = createHash("sha256").update(dto.endpoint).digest("hex");
    await this.prisma.ownerPushSubscription.upsert({
      where: { endpointHash },
      create: {
        businessId: auth.businessId,
        userId: auth.userId,
        endpoint: dto.endpoint,
        endpointHash,
        p256dh: dto.p256dh,
        auth: dto.auth,
        userAgent: userAgent?.slice(0, 500),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      update: {
        businessId: auth.businessId,
        userId: auth.userId,
        p256dh: dto.p256dh,
        auth: dto.auth,
        userAgent: userAgent?.slice(0, 500),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        lastUsedAt: new Date(),
      },
    });
    await this.prisma.businessPreferences.update({
      where: { businessId: auth.businessId },
      data: { pushNotificationsEnabled: true },
    });
    return this.preferences(auth);
  }

  async removePushSubscription(auth: OwnerAuthContext, dto: RemovePushSubscriptionDto) {
    const endpointHash = createHash("sha256").update(dto.endpoint).digest("hex");
    await this.prisma.ownerPushSubscription.deleteMany({
      where: { endpointHash, businessId: auth.businessId, userId: auth.userId },
    });
    const remaining = await this.prisma.ownerPushSubscription.count({
      where: { businessId: auth.businessId, userId: auth.userId },
    });
    if (!remaining) {
      await this.prisma.businessPreferences.update({
        where: { businessId: auth.businessId },
        data: { pushNotificationsEnabled: false },
      });
    }
    return this.preferences(auth);
  }

  private async ensurePreferences(businessId: string) {
    return this.prisma.businessPreferences.upsert({
      where: { businessId },
      create: { businessId },
      update: {},
    });
  }

  private webPushConfigured() {
    return Boolean(
      this.config.get<string>("WEB_PUSH_VAPID_PUBLIC_KEY")
      && this.config.get<string>("WEB_PUSH_VAPID_PRIVATE_KEY")
      && this.config.get<string>("WEB_PUSH_SUBJECT"),
    );
  }
}

function task(input: {
  key: string;
  kind: Exclude<AttentionKind, "ACTIVITY">;
  priority: AttentionPriority;
  title: string;
  detail: string;
  to: string;
  createdAt: Date;
  dueAt?: Date;
}) {
  return { ...input, streakEligible: input.kind !== "LOW_STOCK" };
}

function decorate(
  item: Omit<AttentionItem, "seen" | "snoozedUntil">,
  receipt?: { seenAt: Date | null; snoozedUntil: Date | null; dismissedAt: Date | null },
): AttentionItem {
  return {
    ...item,
    seen: Boolean(receipt?.seenAt),
    ...(receipt?.snoozedUntil ? { snoozedUntil: receipt.snoozedUntil } : {}),
  };
}

function compareAttention(left: AttentionItem, right: AttentionItem) {
  const rank = { URGENT: 0, IMPORTANT: 1, ROUTINE: 2 };
  return rank[left.priority] - rank[right.priority]
    || (left.dueAt?.getTime() || left.createdAt.getTime()) - (right.dueAt?.getTime() || right.createdAt.getTime());
}

function hoursOld(value: Date, now: Date) {
  return Math.max(0, (now.getTime() - value.getTime()) / (60 * 60 * 1000));
}

function ageLabel(value: Date, now: Date) {
  const hours = hoursOld(value, now);
  if (hours < 1) return "less than an hour";
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function businessDay(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function activityDescription(type: string) {
  if (type === "DELIVERY_CONFIRMED") return "A customer confirmed that their delivery arrived.";
  if (type === "ISSUE_OPENED") return "A customer reported an order issue.";
  if (type === "PAYMENT_UPDATED") return "A payment record or transfer-proof review changed.";
  if (type.startsWith("DELIVERY_")) return "A delivery journey changed.";
  if (type.startsWith("RECEIPT_")) return "A receipt has new activity.";
  if (type.startsWith("PRODUCT_")) return "The product catalog changed.";
  if (type.startsWith("CUSTOMER_") || type === "FOLLOW_UP_SENT") return "Customer memory has a new update.";
  return "Your business record changed.";
}

function taskAlertEnabled(
  kind: AttentionKind,
  preferences: { notifyFollowUps: boolean; notifyDeliveryUpdates: boolean },
) {
  if (kind === "FOLLOW_UP") return preferences.notifyFollowUps;
  if (kind === "DELIVERY") return preferences.notifyDeliveryUpdates;
  return true;
}

function activityEnabled(
  type: string,
  preferences: {
    notifyFollowUps: boolean;
    notifyDeliveryUpdates: boolean;
    notifyReceiptViews: boolean;
  },
) {
  if (type === "FOLLOW_UP_SENT") return preferences.notifyFollowUps;
  if (type.startsWith("DELIVERY_")) return preferences.notifyDeliveryUpdates;
  if (type === "RECEIPT_VIEWED") return preferences.notifyReceiptViews;
  return true;
}

function activityDestination(event: {
  type: string;
  deliveryId: string | null;
  customerId: string | null;
  receiptId: string | null;
  saleId: string | null;
}) {
  if (event.type.startsWith("DELIVERY_")) {
    return event.deliveryId
      ? `/dashboard/deliveries?delivery=${encodeURIComponent(event.deliveryId)}`
      : "/dashboard/deliveries";
  }
  if (event.type === "ISSUE_OPENED" || event.type === "ISSUE_RESOLVED") return "/dashboard/issues";
  if (event.type === "PAYMENT_UPDATED" || event.type === "REQUEST_PAYMENT_UPDATED") return "/dashboard/sales/payments";
  if (event.type.startsWith("RECEIPT_") || event.saleId || event.receiptId) return "/dashboard/sales";
  if (event.type.startsWith("CUSTOMER_") || event.customerId) return "/dashboard/customers";
  return "/dashboard/activity";
}

export function assertTrustedPushEndpoint(value: string) {
  const hostname = new URL(value).hostname.toLowerCase();
  const trusted = hostname === "fcm.googleapis.com"
    || hostname.endsWith(".push.services.mozilla.com")
    || hostname.endsWith(".push.apple.com")
    || hostname.endsWith(".notify.windows.com");
  if (!trusted) throw new BadRequestException("Push subscription provider is not supported");
}
