import { Injectable } from "@nestjs/common";
import {
  ActivityEventType,
  Prisma,
} from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const TRUST_POINTS = {
  CUSTOMER_ADDED: { key: "customer-added", points: 5 },
  PRODUCT_ADDED: { key: "product-added", points: 5 },
  SALE_LOGGED: { key: "sale-logged", points: 15 },
  RECEIPT_SENT: { key: "receipt-first-sent", points: 15 },
  DELIVERY_CONFIRMED: { key: "delivery-confirmed", points: 20 },
  FEEDBACK_SUBMITTED: { key: "feedback-submitted", points: 10 },
  ISSUE_RESOLVED: { key: "issue-resolved", points: 10 },
  FOLLOW_UP_SENT: { key: "follow-up-completed", points: 10 },
  INVENTORY_CHECKED: { key: "daily-inventory-check", points: 10 },
  STREAK_COMPLETED: { key: "seven-day-streak", points: 30 },
} as const satisfies Partial<
  Record<ActivityEventType, { key: string; points: number }>
>;

type ActivityInput = {
  businessId: string;
  actorId?: string;
  customerId?: string;
  saleId?: string;
  receiptId?: string;
  deliveryId?: string;
  type: ActivityEventType;
  title: string;
  description?: string;
  metadata?: Prisma.InputJsonValue;
  awardTrust?: boolean;
};

type ActivityClient = Pick<
  PrismaService,
  "activityEvent" | "customerInsightSummary" | "trustLedgerEntry"
>;

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: ActivityInput, client: ActivityClient = this.prisma) {
    const event = await client.activityEvent.create({
      data: {
        businessId: input.businessId,
        actorId: input.actorId,
        customerId: input.customerId,
        saleId: input.saleId,
        receiptId: input.receiptId,
        deliveryId: input.deliveryId,
        type: input.type,
        title: input.title,
        description: input.description,
        metadata: input.metadata,
      },
    });
    const rule = TRUST_POINTS[input.type as keyof typeof TRUST_POINTS];
    if (input.awardTrust !== false && rule) {
      await client.trustLedgerEntry.create({
        data: {
          businessId: input.businessId,
          activityEventId: event.id,
          ruleKey: rule.key,
          points: rule.points,
        },
      });
    }
    if (input.customerId) {
      await client.customerInsightSummary.updateMany({
        where: {
          businessId: input.businessId,
          customerId: input.customerId,
          status: "READY",
        },
        data: { status: "STALE", staleAt: new Date() },
      });
    }
    return event;
  }

  async list(
    businessId: string,
    currentUserId: string,
    options: { cursor?: string; customerId?: string; limit?: number } = {},
  ) {
    const take = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const entries = await this.prisma.activityEvent.findMany({
      where: { businessId, customerId: options.customerId },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      take: take + 1,
    });
    const hasMore = entries.length > take;
    const items = entries.slice(0, take).map((entry) => ({
      ...entry,
      actorLabel: entry.actorId === currentUserId
        ? "You"
        : entry.actor?.name
          ? `@${entry.actor.name}`
          : "Loyal Loop",
      targetUrl: activityTarget(entry),
    }));
    return {
      items,
      nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
    };
  }
}

export function activityTarget(entry: {
  customerId: string | null;
  saleId: string | null;
  receiptId: string | null;
  deliveryId: string | null;
  metadata: Prisma.JsonValue | null;
  type: ActivityEventType;
}) {
  if (entry.deliveryId) {
    return `/dashboard/deliveries?delivery=${encodeURIComponent(entry.deliveryId)}`;
  }
  if (entry.saleId) {
    return `/dashboard/sales/${encodeURIComponent(entry.saleId)}`;
  }
  const productId = metadataString(entry.metadata, "productId");
  if (productId) {
    return `/dashboard/products?product=${encodeURIComponent(productId)}`;
  }
  if (entry.customerId) {
    return `/dashboard/customers?customer=${encodeURIComponent(entry.customerId)}`;
  }
  if (["INVENTORY_CHECKED", "STREAK_COMPLETED"].includes(entry.type)) {
    return "/dashboard/trust-rewards";
  }
  return "/dashboard";
}

function metadataString(metadata: Prisma.JsonValue | null, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}
