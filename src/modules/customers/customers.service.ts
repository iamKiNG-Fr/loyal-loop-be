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

const CUSTOMER_BRIEF_CONTEXT_VERSION = "customer-brief-v2";

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
    const { cached, evidence, evidenceVersion } = await this.insightContext(
      auth.businessId,
      customerId,
    );
    return {
      cached,
      evidence,
      generated: Boolean(cached),
      needsRefresh: !isCurrentBrief(cached, evidenceVersion),
    };
  }

  async refreshInsight(auth: OwnerAuthContext, customerId: string) {
    const context = await this.insightContext(auth.businessId, customerId);
    if (isCurrentBrief(context.cached, context.evidenceVersion)) {
      return {
        cached: context.cached,
        evidence: context.evidence,
        generated: true,
        needsRefresh: false,
      };
    }

    try {
      const summary = await this.intelligence.summarizeCustomer({
        businessCategory: context.customer.business.category,
        businessName: context.customer.business.name,
        customerLabels: context.customer.tagAssignments.map(({ tag }) => tag.name),
        customerName: context.customer.name,
        evidence: context.evidence,
      });
      const providerFailed = Boolean(
        this.intelligence.model
        && context.evidence.length
        && summary.source === "fallback",
      );
      const cached = await this.prisma.customerInsightSummary.upsert({
        where: { customerId },
        create: {
          businessId: auth.businessId,
          customerId,
          status: providerFailed ? "FAILED" : "READY",
          summary,
          evidenceVersion: context.evidenceVersion,
          model: summary.source === "ai" ? this.intelligence.model : null,
          lastError: providerFailed
            ? "Gemini was unavailable; a deterministic customer brief was stored."
            : null,
        },
        update: {
          status: providerFailed ? "FAILED" : "READY",
          summary,
          evidenceVersion: context.evidenceVersion,
          model: summary.source === "ai" ? this.intelligence.model : null,
          generatedAt: new Date(),
          staleAt: null,
          lastError: providerFailed
            ? "Gemini was unavailable; a deterministic customer brief was stored."
            : null,
        },
      });
      return {
        cached,
        evidence: context.evidence,
        generated: true,
        needsRefresh: providerFailed,
      };
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
    const [activities, sales, deliveries, notes, issues, feedback] = await this.prisma.$transaction([
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
      this.prisma.customerIssue.findMany({
        where: { businessId, customerId },
        select: {
          id: true,
          description: true,
          status: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }),
      this.prisma.customerFeedback.findMany({
        where: { businessId, customerId },
        select: { id: true, rating: true, comment: true, createdAt: true },
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
      ...issues.map((issue) => ({
        id: `issue:${issue.id}`,
        kind: "issue" as const,
        occurredAt: issue.updatedAt.toISOString(),
        title: `${issue.status === "OPEN" ? "Open" : "Resolved"} customer issue: ${issue.description.slice(0, 180)}`,
      })),
      ...feedback.map((entry) => ({
        id: `feedback:${entry.id}`,
        kind: "feedback" as const,
        occurredAt: entry.createdAt.toISOString(),
        title: `Customer feedback: ${entry.rating}/5${entry.comment ? ` — ${entry.comment.slice(0, 160)}` : ""}`,
      })),
    ]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 80);
  }

  private async insightContext(businessId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, businessId },
      select: {
        id: true,
        name: true,
        channel: true,
        business: { select: { id: true, name: true, category: true } },
        tagAssignments: {
          select: { tag: { select: { name: true } } },
          orderBy: { tag: { name: "asc" } },
        },
      },
    });
    if (!customer) throw new NotFoundException("Customer not found");

    const [cached, evidence] = await Promise.all([
      this.prisma.customerInsightSummary.findFirst({
        where: { businessId, customerId },
      }),
      this.insightEvidence(businessId, customerId),
    ]);
    const evidenceVersion = createHash("sha256")
      .update(JSON.stringify({
        version: CUSTOMER_BRIEF_CONTEXT_VERSION,
        business: customer.business,
        customer: {
          channel: customer.channel,
          labels: customer.tagAssignments.map(({ tag }) => tag.name),
          name: customer.name,
        },
        evidence: evidence.map(({ id, kind, occurredAt, title }) => ({
          id,
          kind,
          occurredAt,
          title,
        })),
      }))
      .digest("hex");

    return { cached, customer, evidence, evidenceVersion };
  }
}

function isCurrentBrief(
  cached: { evidenceVersion: string; status: string } | null,
  evidenceVersion: string,
) {
  return cached?.status === "READY" && cached.evidenceVersion === evidenceVersion;
}
