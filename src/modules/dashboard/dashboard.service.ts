import { Injectable } from "@nestjs/common";
import type { OwnerAuthContext } from "../../common/request-context";
import { PrismaService } from "../prisma/prisma.service";
import { discoverySource } from "../shops/discovery-attribution";

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(auth: OwnerAuthContext) {
    const [
      customers,
      products,
      lowStockProducts,
      pendingDeliveries,
      openIssues,
      pendingPaymentProofs,
      followUps,
      recentSales,
      recentActivity,
      recentReceipts,
      pendingRequests,
      unreadOrderRequests,
      discoveryEvents,
    ] = await Promise.all([
      this.prisma.customer.count({ where: { businessId: auth.businessId } }),
      this.prisma.product.count({
        where: { businessId: auth.businessId, status: "ACTIVE" },
      }),
      this.prisma.product.findMany({
        where: {
          businessId: auth.businessId,
          status: "ACTIVE",
          stockCount: { lte: 5, not: null },
        },
        select: { id: true, name: true, stockCount: true, updatedAt: true },
        orderBy: [{ stockCount: "asc" }, { updatedAt: "desc" }],
        take: 5,
      }),
      this.prisma.delivery.count({
        where: {
          businessId: auth.businessId,
          status: {
            in: ["PREPARING", "READY_FOR_PICKUP", "IN_TRANSIT", "DELIVERED"],
          },
        },
      }),
      this.prisma.customerIssue.count({
        where: { businessId: auth.businessId, status: "OPEN" },
      }),
      this.prisma.paymentProof.count({
        where: { businessId: auth.businessId, status: "SUBMITTED" },
      }),
      this.prisma.followUpSuggestion.findMany({
        where: {
          businessId: auth.businessId,
          status: { in: ["SUGGESTED", "APPROVED"] },
        },
        include: { customer: true, template: true },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        take: 3,
      }),
      this.prisma.sale.findMany({
        where: { businessId: auth.businessId },
        include: { customer: true, items: true, receipt: true, delivery: true },
        orderBy: { soldAt: "desc" },
        take: 3,
      }),
      this.prisma.activityEvent.findMany({
        where: { businessId: auth.businessId },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      this.prisma.receipt.findMany({
        where: { businessId: auth.businessId },
        include: { customer: true },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      this.prisma.orderRequest.count({
        where: {
          businessId: auth.businessId,
          status: { in: ["SENT", "ACCEPTED", "NEEDS_CHANGES"] },
        },
      }),
      this.prisma.orderRequest.count({
        where: {
          businessId: auth.businessId,
          status: "SENT",
        },
      }),
      this.prisma.commerceEvent.findMany({
        where: {
          businessId: auth.businessId,
          type: { in: ["SHOP_VIEWED", "PRODUCT_VIEWED"] },
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        select: { createdAt: true, metadata: true, type: true },
        orderBy: { createdAt: "desc" },
        take: 2000,
      }),
    ]);

    const sourceCounts = new Map<string, number>();
    for (const event of discoveryEvents) {
      const source = discoverySource(event.metadata);
      if (source) sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
    const attributedViews = [...sourceCounts.values()].reduce((sum, value) => sum + value, 0);
    const reportingReady = attributedViews >= 5;
    const discoverySeries = new Map<string, { date: string; productViews: number; shopViews: number }>();
    for (let offset = 29; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - offset);
      const key = date.toISOString().slice(0, 10);
      discoverySeries.set(key, { date: key, productViews: 0, shopViews: 0 });
    }
    for (const event of discoveryEvents) {
      const day = discoverySeries.get(event.createdAt.toISOString().slice(0, 10));
      if (!day) continue;
      if (event.type === "PRODUCT_VIEWED") day.productViews += 1;
      if (event.type === "SHOP_VIEWED") day.shopViews += 1;
    }

    return {
      counts: {
        customers,
        products,
        lowStockProducts: lowStockProducts.length,
        pendingDeliveries,
        openIssues,
        pendingPaymentProofs,
        pendingRequests,
        unreadOrderRequests,
      },
      followUps,
      lowStockProducts,
      recentSales,
      recentActivity: recentActivity.map((entry) => ({
        ...entry,
        actorLabel:
          entry.actorId === auth.userId
            ? "You"
            : entry.actor?.name
              ? `@${entry.actor.name}`
              : "Loyal Loop",
      })),
      recentReceipts,
      discovery: {
        attributedViews,
        reportingReady,
        series: [...discoverySeries.values()],
        topSources: reportingReady
          ? [...sourceCounts.entries()]
              .map(([source, views]) => ({ source, views }))
              .sort((a, b) => b.views - a.views)
              .slice(0, 4)
          : [],
        totalViews: discoveryEvents.length,
        windowDays: 30,
      },
    };
  }
}
