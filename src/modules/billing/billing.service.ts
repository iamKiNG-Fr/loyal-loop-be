import { Injectable } from "@nestjs/common";
import type { OwnerAuthContext } from "../../common/request-context";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async getPlan(auth: OwnerAuthContext) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: {
        plan: true,
        subscriptionStatus: true,
        trialStartedAt: true,
        trialEndsAt: true,
        customerLimit: true,
        receiptLimit: true,
        _count: { select: { customers: true, receipts: true } },
      },
    });
    return {
      ...business,
      usage: {
        customers: business._count.customers,
        receipts: business._count.receipts,
      },
      paymentCollectionEnabled: false,
    };
  }
}
