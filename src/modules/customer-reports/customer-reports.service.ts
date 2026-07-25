import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateCustomerReportDto } from "./dto/customer-report.dto";

@Injectable()
export class CustomerReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(customerAccountId: string, dto: CreateCustomerReportDto) {
    if (dto.reason === "OTHER" && !dto.details?.trim()) {
      throw new BadRequestException("Tell us what happened when choosing Other");
    }

    const target = await this.resolveTarget(customerAccountId, dto);
    const existing = await this.prisma.customerReport.findFirst({
      where: {
        reporterCustomerAccountId: customerAccountId,
        subjectType: dto.subjectType,
        status: { in: ["OPEN", "IN_REVIEW"] },
        ...target.where,
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return existing;

    return this.prisma.customerReport.create({
      data: {
        reporterCustomerAccountId: customerAccountId,
        businessId: target.businessId,
        subjectType: dto.subjectType,
        reason: dto.reason,
        subjectLabelSnapshot: target.label,
        details: dto.details?.trim(),
        ...target.data,
      },
    });
  }

  private async resolveTarget(
    customerAccountId: string,
    dto: CreateCustomerReportDto,
  ): Promise<{
    businessId: string;
    data: Pick<
      Prisma.CustomerReportUncheckedCreateInput,
      "orderRequestId" | "productId" | "saleId" | "showcaseId"
    >;
    label: string;
    where: Prisma.CustomerReportWhereInput;
  }> {
    if (dto.subjectType === "ORDER") {
      const sale = await this.prisma.sale.findFirst({
        where: {
          id: dto.subjectId,
          customer: { accountId: customerAccountId },
        },
        select: {
          businessId: true,
          referenceCode: true,
          business: { select: { name: true } },
        },
      });
      if (!sale) throw new NotFoundException("Order not found");
      return {
        businessId: sale.businessId,
        data: { saleId: dto.subjectId },
        label: `${sale.referenceCode} · ${sale.business.name}`,
        where: { saleId: dto.subjectId },
      };
    }

    if (dto.subjectType === "ORDER_REQUEST") {
      const request = await this.prisma.orderRequest.findFirst({
        where: { id: dto.subjectId, customerAccountId },
        select: {
          businessId: true,
          referenceCode: true,
          business: { select: { name: true } },
        },
      });
      if (!request) throw new NotFoundException("Order not found");
      return {
        businessId: request.businessId,
        data: { orderRequestId: dto.subjectId },
        label: `${request.referenceCode} · ${request.business.name}`,
        where: { orderRequestId: dto.subjectId },
      };
    }

    if (dto.subjectType === "PRODUCT") {
      const product = await this.prisma.product.findFirst({
        where: {
          id: dto.subjectId,
          status: "ACTIVE",
          visibility: "PUBLIC",
          business: { platformStatus: "ACTIVE" },
        },
        select: { businessId: true, name: true, business: { select: { name: true } } },
      });
      if (!product) throw new NotFoundException("Product not found");
      return {
        businessId: product.businessId,
        data: { productId: dto.subjectId },
        label: `${product.name} · ${product.business.name}`,
        where: { productId: dto.subjectId },
      };
    }

    if (dto.subjectType === "SHOWCASE") {
      const showcase = await this.prisma.showcase.findFirst({
        where: {
          id: dto.subjectId,
          status: "PUBLISHED",
          business: { platformStatus: "ACTIVE" },
        },
        select: { businessId: true, title: true, business: { select: { name: true } } },
      });
      if (!showcase) throw new NotFoundException("Showcase not found");
      return {
        businessId: showcase.businessId,
        data: { showcaseId: dto.subjectId },
        label: `${showcase.title} · ${showcase.business.name}`,
        where: { showcaseId: dto.subjectId },
      };
    }

    const business = await this.prisma.business.findFirst({
      where: { id: dto.subjectId, platformStatus: "ACTIVE" },
      select: { id: true, name: true },
    });
    if (!business) throw new NotFoundException("Shop not found");
    return {
      businessId: business.id,
      data: {},
      label: business.name,
      where: { businessId: business.id },
    };
  }
}
