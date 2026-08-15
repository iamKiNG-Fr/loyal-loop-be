import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  FoundingPaymentBlocker,
  FoundingPaymentInterest,
  Prisma,
} from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { SubmitFoundingValueFeedbackDto } from "./dto/founding-value-feedback.dto";

type DatabaseClient = Prisma.TransactionClient | PrismaService;
type AdminFeedbackQuery = {
  includeDemo?: boolean;
  search?: string;
  status?: string;
};

const feedbackInclude = {
  business: {
    select: {
      id: true,
      name: true,
      slug: true,
      isDemo: true,
      owner: { select: { name: true, email: true, phone: true } },
    },
  },
  enrollment: { include: { cohort: true } },
  triggerSale: {
    select: {
      id: true,
      referenceCode: true,
      soldAt: true,
      total: true,
      currency: true,
    },
  },
} satisfies Prisma.FoundingValueFeedbackInclude;

@Injectable()
export class FoundingValueFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async captureIfQualified(
    client: DatabaseClient,
    businessId: string,
    saleId: string,
  ) {
    const business = await client.business.findFirst({
      where: {
        id: businessId,
        isDemo: false,
        platformStatus: "ACTIVE",
        OR: [
          { plan: "PRIVATE_TESTER" },
          {
            foundingEnrollment: {
              is: { status: { in: ["ONBOARDING", "ACTIVE"] } },
            },
          },
        ],
      },
      select: {
        id: true,
        foundingEnrollment: { select: { id: true } },
      },
    });
    if (!business) return null;

    const sale = await client.sale.findFirst({
      where: {
        id: saleId,
        businessId,
        status: "COMPLETED",
        paymentStatus: "PAID",
        items: { some: { productId: { not: null } } },
      },
      select: { id: true },
    });
    if (!sale) return null;

    const latest = await client.foundingValueFeedback.findFirst({
      where: { businessId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (latest?.status === "PENDING" || latest?.status === "SUBMITTED") {
      return latest;
    }
    if (latest?.triggerSaleId === saleId) return latest;
    if (latest?.rearmAt && latest.rearmAt.getTime() > Date.now()) return null;

    const triggerSaleSequence = await client.sale.count({
      where: {
        businessId,
        status: "COMPLETED",
        paymentStatus: "PAID",
        items: { some: { productId: { not: null } } },
      },
    });

    try {
      return await client.foundingValueFeedback.create({
        data: {
          businessId,
          enrollmentId: business.foundingEnrollment?.id,
          triggerSaleId: saleId,
          triggerSaleSequence,
          deferralCount: latest?.deferralCount ?? 0,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2002"
      ) {
        return client.foundingValueFeedback.findUnique({
          where: { triggerSaleId: saleId },
        });
      }
      throw error;
    }
  }

  async pending(businessId: string) {
    const latestSale = await this.prisma.sale.findFirst({
      where: {
        businessId,
        status: "COMPLETED",
        paymentStatus: "PAID",
        items: { some: { productId: { not: null } } },
      },
      select: { id: true },
      orderBy: [{ soldAt: "desc" }, { createdAt: "desc" }],
    });
    if (latestSale) {
      await this.captureIfQualified(this.prisma, businessId, latestSale.id);
    }

    const now = new Date();
    const feedback = await this.prisma.foundingValueFeedback.findFirst({
      where: {
        businessId,
        status: "PENDING",
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      },
      include: feedbackInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (!feedback) return null;
    if (feedback.promptedAt) return serializeFeedback(feedback);

    const prompted = await this.prisma.foundingValueFeedback.update({
      where: { id: feedback.id },
      data: { promptedAt: now },
      include: feedbackInclude,
    });
    return serializeFeedback(prompted);
  }

  async submit(
    businessId: string,
    feedbackId: string,
    dto: SubmitFoundingValueFeedbackDto,
  ) {
    const feedback = await this.pendingRecord(businessId, feedbackId);
    if (
      dto.paymentInterest === FoundingPaymentInterest.NOT_NOW
      && !dto.paymentBlocker
    ) {
      throw new BadRequestException("Choose the main reason for not paying right now");
    }
    if (
      dto.paymentInterest === FoundingPaymentInterest.NOT_NOW
      && dto.paymentBlocker === FoundingPaymentBlocker.OTHER
      && !dto.paymentBlockerDetail?.trim()
    ) {
      throw new BadRequestException("Tell us the other reason briefly");
    }

    const positive = dto.paymentInterest !== FoundingPaymentInterest.NOT_NOW;
    const updated = await this.prisma.foundingValueFeedback.update({
      where: { id: feedback.id },
      data: {
        status: "SUBMITTED",
        valueRating: dto.valueRating,
        paymentInterest: dto.paymentInterest,
        paymentBlocker: positive ? null : dto.paymentBlocker,
        paymentBlockerDetail:
          !positive && dto.paymentBlocker === FoundingPaymentBlocker.OTHER
            ? dto.paymentBlockerDetail?.trim()
            : null,
        valueNeeded: dto.valueNeeded?.trim() || null,
        volunteeredPriceAmount:
          dto.volunteeredPriceAmount === undefined
            ? null
            : new Prisma.Decimal(dto.volunteeredPriceAmount),
        snoozedUntil: null,
        submittedAt: new Date(),
      },
      include: feedbackInclude,
    });
    return serializeFeedback(updated);
  }

  async defer(businessId: string, feedbackId: string) {
    const feedback = await this.pendingRecord(businessId, feedbackId);
    const deferralCount = feedback.deferralCount + 1;
    const now = new Date();
    const rearmAt = deferralCount >= 2
      ? new Date(now.getTime() + 30 * 86_400_000)
      : now;
    return this.prisma.foundingValueFeedback.update({
      where: { id: feedback.id },
      data: {
        status: "DEFERRED",
        deferralCount,
        deferredAt: now,
        rearmAt,
        snoozedUntil: null,
      },
    });
  }

  async snooze(businessId: string, feedbackId: string) {
    const feedback = await this.pendingRecord(businessId, feedbackId);
    return this.prisma.foundingValueFeedback.update({
      where: { id: feedback.id },
      data: { snoozedUntil: new Date(Date.now() + 7 * 86_400_000) },
    });
  }

  async adminList(query: AdminFeedbackQuery) {
    const records = await this.prisma.foundingValueFeedback.findMany({
      where: query.includeDemo ? {} : { business: { isDemo: false } },
      include: feedbackInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const latestByBusiness = new Map<string, (typeof records)[number]>();
    for (const record of records) {
      if (!latestByBusiness.has(record.businessId)) {
        latestByBusiness.set(record.businessId, record);
      }
    }
    const search = query.search?.trim().toLowerCase();
    const requestedStatus = ["PENDING", "DEFERRED", "SUBMITTED"].includes(
      query.status ?? "",
    ) ? query.status : undefined;
    const latest = [...latestByBusiness.values()].filter((record) => {
      if (requestedStatus && record.status !== requestedStatus) return false;
      if (!search) return true;
      return [
        record.business.name,
        record.business.slug,
        record.business.owner.name,
        record.business.owner.email,
        record.triggerSale.referenceCode,
      ].some((value) => value.toLowerCase().includes(search));
    });

    const allLatest = [...latestByBusiness.values()];
    return {
      items: latest.map(serializeFeedback),
      summary: {
        total: allLatest.length,
        pending: allLatest.filter((item) => item.status === "PENDING").length,
        deferred: allLatest.filter((item) => item.status === "DEFERRED").length,
        responded: allLatest.filter((item) => item.status === "SUBMITTED").length,
        yes: allLatest.filter((item) => item.paymentInterest === "YES").length,
        maybe: allLatest.filter((item) => item.paymentInterest === "MAYBE").length,
        notNow: allLatest.filter((item) => item.paymentInterest === "NOT_NOW").length,
      },
    };
  }

  private async pendingRecord(businessId: string, feedbackId: string) {
    const feedback = await this.prisma.foundingValueFeedback.findFirst({
      where: { id: feedbackId, businessId },
    });
    if (!feedback) throw new NotFoundException("Feedback prompt not found");
    if (feedback.status !== "PENDING") {
      throw new ConflictException("This feedback prompt is no longer active");
    }
    return feedback;
  }
}

function serializeFeedback<T extends {
  volunteeredPriceAmount: Prisma.Decimal | null;
  triggerSale?: { total: Prisma.Decimal };
}>(feedback: T) {
  return {
    ...feedback,
    volunteeredPriceAmount: feedback.volunteeredPriceAmount?.toString() ?? null,
    ...(feedback.triggerSale
      ? {
          triggerSale: {
            ...feedback.triggerSale,
            total: feedback.triggerSale.total.toString(),
          },
        }
      : {}),
  };
}
