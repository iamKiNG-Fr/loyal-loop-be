import { Injectable, Logger } from "@nestjs/common";
import type { OwnerAuthContext } from "../../common/request-context";
import { AttentionService } from "../attention/attention.service";
import { PrismaService } from "../prisma/prisma.service";
import { discoverySource } from "../shops/discovery-attribution";

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attention: AttentionService,
  ) {}

  async get(auth: OwnerAuthContext) {
    const lowStockThreshold = await this.prisma.businessPreferences.findUnique({
      where: { businessId: auth.businessId },
      select: { lowStockThreshold: true },
    }).then((preferences) => Math.max(1, preferences?.lowStockThreshold || 5));
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
      attention,
    ] = await Promise.all([
      this.prisma.customer.count({ where: { businessId: auth.businessId } }),
      this.prisma.product.count({
        where: { businessId: auth.businessId, status: "ACTIVE" },
      }),
      this.prisma.product.findMany({
        where: {
          businessId: auth.businessId,
          status: "ACTIVE",
          stockCount: { lte: lowStockThreshold, not: null },
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
          dueAt: { not: null, lte: new Date() },
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
          ownerReadAt: null,
        },
      }),
      this.prisma.commerceEvent.findMany({
        where: {
          businessId: auth.businessId,
          type: { in: ["SHOP_IMPRESSION", "SHOP_VIEWED", "PRODUCT_IMPRESSION", "PRODUCT_VIEWED"] },
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        select: { createdAt: true, id: true, metadata: true, sessionKey: true, type: true },
      }).catch(() => {
        this.logger.warn("Dashboard discovery analytics are unavailable; returning core dashboard data.");
        return [];
      }),
      this.attention.get(auth),
    ]);

    const sourceCounts = new Map<string, number>();
    const searchSessions = new Set<string>();
    const searchTermSessions = new Map<string, Set<string>>();
    let productImpressions = 0;
    let productOpens = 0;
    let searchAppearances = 0;
    let searchOpens = 0;
    let shopImpressions = 0;
    for (const event of discoveryEvents) {
      const source = discoverySource(event.metadata);
      if (source) sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
      const context = commerceEventContext(event.metadata);
      if (event.type === "PRODUCT_IMPRESSION") productImpressions += 1;
      if (event.type === "SHOP_IMPRESSION") shopImpressions += 1;
      if (event.type === "PRODUCT_VIEWED" && context.surface?.startsWith("explore")) productOpens += 1;
      if (["PRODUCT_IMPRESSION", "SHOP_IMPRESSION"].includes(event.type) && context.surface === "explore_search") {
        searchAppearances += 1;
        const searchSession = `${event.sessionKey || event.id}:${context.query || "unknown"}`;
        searchSessions.add(searchSession);
        if (context.query) {
          const sessions = searchTermSessions.get(context.query) ?? new Set<string>();
          sessions.add(searchSession);
          searchTermSessions.set(context.query, sessions);
        }
      }
      if (["PRODUCT_VIEWED", "SHOP_VIEWED"].includes(event.type) && context.surface === "explore_search") searchOpens += 1;
    }
    const attributedViews = [...sourceCounts.values()].reduce((sum, value) => sum + value, 0);
    const reportingReady = attributedViews >= 5;
    const discoverySeries = new Map<string, { date: string; productImpressions: number; productOpens: number; productViews: number; shopViews: number }>();
    for (let offset = 29; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - offset);
      const key = date.toISOString().slice(0, 10);
      discoverySeries.set(key, { date: key, productImpressions: 0, productOpens: 0, productViews: 0, shopViews: 0 });
    }
    for (const event of discoveryEvents) {
      const day = discoverySeries.get(event.createdAt.toISOString().slice(0, 10));
      if (!day) continue;
      if (event.type === "PRODUCT_VIEWED") day.productViews += 1;
      if (event.type === "SHOP_VIEWED") day.shopViews += 1;
      if (event.type === "PRODUCT_IMPRESSION") day.productImpressions += 1;
      if (event.type === "PRODUCT_VIEWED" && commerceEventContext(event.metadata).surface?.startsWith("explore")) day.productOpens += 1;
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
      attention,
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
        impressions: productImpressions + shopImpressions,
        openRate: percentage(productOpens, productImpressions),
        productImpressions,
        productOpens,
        reportingReady,
        searchAppearances,
        searchOpenRate: percentage(searchOpens, searchAppearances),
        searchOpens,
        searchReportingReady: searchAppearances >= 5,
        searches: searchSessions.size,
        series: [...discoverySeries.values()],
        shopImpressions,
        topSources: reportingReady
          ? [...sourceCounts.entries()]
              .map(([source, views]) => ({ source, views }))
              .sort((a, b) => b.views - a.views)
              .slice(0, 4)
          : [],
        totalViews: discoveryEvents.filter((event) => ["PRODUCT_VIEWED", "SHOP_VIEWED"].includes(event.type)).length,
        topSearchTerms: [...searchTermSessions.entries()]
          .filter(([, sessions]) => sessions.size >= 5)
          .map(([term, sessions]) => ({ appearances: sessions.size, term }))
          .sort((left, right) => right.appearances - left.appearances || left.term.localeCompare(right.term))
          .slice(0, 5),
        windowDays: 30,
      },
    };
  }
}

function commerceEventContext(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {} as { query?: string; surface?: string };
  const context = (metadata as Record<string, unknown>).context;
  if (!context || typeof context !== "object" || Array.isArray(context)) return {} as { query?: string; surface?: string };
  const values = context as Record<string, unknown>;
  return {
    query: typeof values.query === "string" ? values.query : undefined,
    surface: typeof values.surface === "string" ? values.surface : undefined,
  };
}

function percentage(value: number, total: number) {
  return total ? Math.round(value / total * 1000) / 10 : 0;
}
