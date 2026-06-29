import { Injectable } from "@nestjs/common";
import type { OwnerAuthContext } from "../../common/request-context";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(auth: OwnerAuthContext) {
    const [
      customers,
      products,
      pendingDeliveries,
      openIssues,
      followUps,
      recentSales,
      recentActivity,
      recentReceipts,
      pendingRequests,
    ] = await Promise.all([
      this.prisma.customer.count({ where: { businessId: auth.businessId } }),
      this.prisma.product.count({
        where: { businessId: auth.businessId, status: "ACTIVE" },
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
      this.prisma.followUpSuggestion.findMany({
        where: {
          businessId: auth.businessId,
          status: { in: ["SUGGESTED", "APPROVED"] },
        },
        include: { customer: true, template: true },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        take: 5,
      }),
      this.prisma.sale.findMany({
        where: { businessId: auth.businessId },
        include: { customer: true, items: true, receipt: true, delivery: true },
        orderBy: { soldAt: "desc" },
        take: 5,
      }),
      this.prisma.activityEvent.findMany({
        where: { businessId: auth.businessId },
        orderBy: { createdAt: "desc" },
        take: 10,
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
    ]);

    return {
      counts: {
        customers,
        products,
        pendingDeliveries,
        openIssues,
        pendingRequests,
      },
      followUps,
      recentSales,
      recentActivity,
      recentReceipts,
    };
  }
}
