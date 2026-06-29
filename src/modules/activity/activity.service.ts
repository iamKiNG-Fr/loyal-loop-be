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
  "activityEvent" | "trustLedgerEntry"
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
    return event;
  }

  list(businessId: string, customerId?: string) {
    return this.prisma.activityEvent.findMany({
      where: { businessId, customerId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
}
