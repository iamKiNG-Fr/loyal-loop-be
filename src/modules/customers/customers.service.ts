import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { createOpaqueToken } from "../../common/crypto.util";
import { paginated } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { ActivityService } from "../activity/activity.service";
import { IntelligenceService } from "../intelligence/intelligence.service";
import type { CustomerEvidenceItem } from "../intelligence/intelligence.types";
import { PrismaService } from "../prisma/prisma.service";
import {
  AddCustomerNoteDto,
  AssignCustomerTagsDto,
  CreateCustomerDto,
  CreateCustomerTagDto,
  CustomerListDto,
  UpdateCustomerDto,
} from "./dto/customer.dto";

const customerInclude = {
  contacts: true,
  addresses: { orderBy: [{ isDefault: "desc" as const }, { updatedAt: "desc" as const }] },
  notes: {
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" as const },
    take: 20,
  },
  tagAssignments: { include: { tag: true } },
  _count: { select: { sales: true, receipts: true, deliveries: true } },
};

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly intelligence: IntelligenceService,
  ) {}

  async list(auth: OwnerAuthContext, query: CustomerListDto) {
    const where = {
      businessId: auth.businessId,
      ...(query.query
        ? {
            OR: [
              { name: { contains: query.query, mode: "insensitive" as const } },
              { phone: { contains: query.query } },
              {
                tagAssignments: {
                  some: {
                    tag: {
                      name: {
                        contains: query.query,
                        mode: "insensitive" as const,
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: customerInclude,
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return paginated(items, total, query.page, query.pageSize);
  }

  get(auth: OwnerAuthContext, id: string) {
    return this.prisma.customer.findFirstOrThrow({
      where: { id, businessId: auth.businessId },
      include: customerInclude,
    });
  }

  async create(auth: OwnerAuthContext, dto: CreateCustomerDto) {
    const publicAccess = createOpaqueToken();
    if (dto.tagIds?.length) {
      const validTagCount = await this.prisma.customerTag.count({
        where: {
          businessId: auth.businessId,
          id: { in: [...new Set(dto.tagIds)] },
        },
      });
      if (validTagCount !== new Set(dto.tagIds).size) {
        throw new BadRequestException("One or more customer tags are invalid");
      }
    }
    const customer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          businessId: auth.businessId,
          name: dto.name.trim(),
          phone: dto.phone?.trim(),
          email: dto.email?.trim().toLowerCase(),
          channel: dto.channel ?? "OTHER",
          publicTokenHash: publicAccess.tokenHash,
          contacts: dto.contacts?.length
            ? {
                create: dto.contacts.map((contact, index) => ({
                  platform: contact.platform,
                  value: contact.value.trim(),
                  isPrimary: index === 0,
                })),
              }
            : undefined,
          notes: dto.note
            ? { create: { content: dto.note.trim(), authorId: auth.userId } }
            : undefined,
          tagAssignments: dto.tagIds?.length
            ? {
                create: dto.tagIds.map((tagId) => ({
                  tag: {
                    connect: { id: tagId },
                  },
                })),
              }
            : undefined,
        },
        include: customerInclude,
      });
      await this.activity.record(
        {
          businessId: auth.businessId,
          actorId: auth.userId,
          customerId: created.id,
          type: "CUSTOMER_ADDED",
          title: `Added ${created.name}`,
        },
        tx,
      );
      return created;
    });
    return { customer, publicToken: publicAccess.token };
  }

  async update(
    auth: OwnerAuthContext,
    customerId: string,
    dto: UpdateCustomerDto,
  ) {
    await this.assertOwned(auth.businessId, customerId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.contacts) {
        await tx.customerContact.deleteMany({ where: { customerId } });
      }
      return tx.customer.update({
        where: { id: customerId },
        data: {
          name: dto.name?.trim(),
          phone: dto.phone?.trim(),
          email: dto.email?.trim().toLowerCase(),
          channel: dto.channel,
          contacts: dto.contacts
            ? {
                create: dto.contacts.map((contact, index) => ({
                  platform: contact.platform,
                  value: contact.value.trim(),
                  isPrimary: index === 0,
                })),
              }
            : undefined,
        },
        include: customerInclude,
      });
    });
  }

  async addNote(
    auth: OwnerAuthContext,
    customerId: string,
    dto: AddCustomerNoteDto,
  ) {
    const customer = await this.assertOwned(auth.businessId, customerId);
    return this.prisma.$transaction(async (tx) => {
      const note = await tx.customerNote.create({
        data: {
          customerId,
          authorId: auth.userId,
          content: dto.content.trim(),
        },
      });
      await this.activity.record(
        {
          businessId: auth.businessId,
          actorId: auth.userId,
          customerId,
          type: "CUSTOMER_NOTE_ADDED",
          title: `Added a note for ${customer.name}`,
          awardTrust: false,
        },
        tx,
      );
      return note;
    });
  }

  createTag(auth: OwnerAuthContext, dto: CreateCustomerTagDto) {
    return this.prisma.customerTag.create({
      data: {
        businessId: auth.businessId,
        name: dto.name.trim(),
        description: dto.description?.trim(),
        color: dto.color,
      },
    });
  }

  listTags(auth: OwnerAuthContext) {
    return this.prisma.customerTag.findMany({
      where: { businessId: auth.businessId },
      orderBy: { name: "asc" },
    });
  }

  async assignTags(
    auth: OwnerAuthContext,
    customerId: string,
    dto: AssignCustomerTagsDto,
  ) {
    await this.assertOwned(auth.businessId, customerId);
    const validTags = await this.prisma.customerTag.findMany({
      where: { businessId: auth.businessId, id: { in: dto.tagIds } },
      select: { id: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.customerTagAssignment.deleteMany({ where: { customerId } });
      if (validTags.length) {
        await tx.customerTagAssignment.createMany({
          data: validTags.map(({ id }) => ({ customerId, tagId: id })),
        });
      }
    });
    return this.get(auth, customerId);
  }

  timeline(auth: OwnerAuthContext, customerId: string) {
    return this.assertOwned(auth.businessId, customerId).then(() =>
      this.prisma.activityEvent.findMany({
        where: { businessId: auth.businessId, customerId },
        orderBy: { createdAt: "desc" },
      }),
    );
  }

  async insight(auth: OwnerAuthContext, customerId: string) {
    await this.assertOwned(auth.businessId, customerId);
    const [cached, evidence] = await Promise.all([
      this.prisma.customerInsightSummary.findUnique({ where: { customerId } }),
      this.insightEvidence(auth.businessId, customerId),
    ]);
    return {
      cached,
      evidence,
      generated: Boolean(cached),
    };
  }

  async refreshInsight(auth: OwnerAuthContext, customerId: string) {
    const customer = await this.assertOwned(auth.businessId, customerId);
    const evidence = await this.insightEvidence(auth.businessId, customerId);
    const evidenceVersion = createHash("sha256")
      .update(JSON.stringify(evidence.map(({ id, occurredAt, title }) => ({ id, occurredAt, title }))))
      .digest("hex");

    try {
      const summary = await this.intelligence.summarizeCustomer({
        customerName: customer.name,
        evidence,
      });
      const cached = await this.prisma.customerInsightSummary.upsert({
        where: { customerId },
        create: {
          businessId: auth.businessId,
          customerId,
          status: "READY",
          summary,
          evidenceVersion,
          model: this.intelligence.model,
        },
        update: {
          status: "READY",
          summary,
          evidenceVersion,
          model: this.intelligence.model,
          generatedAt: new Date(),
          staleAt: null,
          lastError: null,
        },
      });
      return { cached, evidence, generated: true };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 240) : "Summary generation failed";
      await this.prisma.customerInsightSummary.updateMany({
        where: { businessId: auth.businessId, customerId },
        data: { status: "FAILED", lastError: message },
      });
      throw error;
    }
  }

  async remove(auth: OwnerAuthContext, customerId: string) {
    await this.assertOwned(auth.businessId, customerId);
    return this.prisma.customer.delete({ where: { id: customerId } });
  }

  private async assertOwned(businessId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, businessId },
    });
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }

  private async insightEvidence(
    businessId: string,
    customerId: string,
  ): Promise<CustomerEvidenceItem[]> {
    const [activities, sales, deliveries, notes] = await this.prisma.$transaction([
      this.prisma.activityEvent.findMany({
        where: { businessId, customerId },
        select: { id: true, title: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      this.prisma.sale.findMany({
        where: { businessId, customerId },
        select: {
          id: true,
          referenceCode: true,
          status: true,
          paymentStatus: true,
          total: true,
          currency: true,
          soldAt: true,
        },
        orderBy: { soldAt: "desc" },
        take: 20,
      }),
      this.prisma.delivery.findMany({
        where: { businessId, customerId },
        select: { id: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.customerNote.findMany({
        where: { customerId, customer: { businessId } },
        select: { id: true, content: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    return [
      ...activities.map((entry) => ({
        id: `activity:${entry.id}`,
        kind: "activity" as const,
        occurredAt: entry.createdAt.toISOString(),
        title: entry.title.slice(0, 180),
      })),
      ...sales.map((sale) => ({
        id: `sale:${sale.id}`,
        kind: "sale" as const,
        occurredAt: sale.soldAt.toISOString(),
        title: `${sale.referenceCode}: ${sale.status.toLowerCase()}, ${sale.paymentStatus.toLowerCase()}, ${sale.currency} ${sale.total.toString()}`,
      })),
      ...deliveries.map((delivery) => ({
        id: `delivery:${delivery.id}`,
        kind: "delivery" as const,
        occurredAt: delivery.createdAt.toISOString(),
        title: `Delivery status: ${delivery.status.toLowerCase().replace(/_/g, " ")}`,
      })),
      ...notes.map((note) => ({
        id: `note:${note.id}`,
        kind: "note" as const,
        occurredAt: note.createdAt.toISOString(),
        title: `Team note: ${note.content.slice(0, 180)}`,
      })),
    ]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 80);
  }
}
