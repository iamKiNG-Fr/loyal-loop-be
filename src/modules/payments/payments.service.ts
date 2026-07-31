import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { hashToken } from "../../common/crypto.util";
import type { OwnerAuthContext } from "../../common/request-context";
import { Prisma } from "../../generated/prisma/client";
import { ActivityService } from "../activity/activity.service";
import {
  MediaService,
  type RegisteredUpload,
} from "../media/media.service";
import { MessagingService } from "../messaging/messaging.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  ReviewPaymentProofDto,
  SubmitPaymentProofDto,
  UpsertPaymentAccountDto,
} from "./dto/payment.dto";

const ownerProofInclude = {
  asset: true,
  sale: {
    include: {
      customer: true,
      delivery: true,
      items: true,
      paymentInstruction: true,
      receipt: true,
    },
  },
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly activity: ActivityService,
    private readonly messaging: MessagingService,
  ) {}

  paymentAccount(auth: OwnerAuthContext) {
    return this.prisma.businessPaymentAccount.findUnique({
      where: { businessId: auth.businessId },
    });
  }

  upsertPaymentAccount(
    auth: OwnerAuthContext,
    dto: UpsertPaymentAccountDto,
  ) {
    const data = {
      accountName: dto.accountName.trim(),
      accountNumber: dto.accountNumber.trim(),
      bankCode: dto.bankCode?.trim(),
      bankName: dto.bankName.trim(),
      instructions: dto.instructions?.trim(),
      isActive: true,
    };
    return this.prisma.businessPaymentAccount.upsert({
      where: { businessId: auth.businessId },
      create: { ...data, businessId: auth.businessId },
      update: data,
    });
  }

  async removePaymentAccount(auth: OwnerAuthContext) {
    const account = await this.paymentAccount(auth);
    if (!account) return null;
    return this.prisma.businessPaymentAccount.delete({
      where: { id: account.id },
    });
  }

  listProofs(auth: OwnerAuthContext, status?: string) {
    const normalized = ["REJECTED", "SUBMITTED", "VERIFIED"].includes(
      status ?? "",
    )
      ? (status as "REJECTED" | "SUBMITTED" | "VERIFIED")
      : undefined;
    return this.prisma.paymentProof.findMany({
      where: {
        businessId: auth.businessId,
        status: normalized,
      },
      include: ownerProofInclude,
      orderBy: { submittedAt: "desc" },
    });
  }

  async createUploadSignature(
    access: "delivery" | "receipt",
    customerAccountId: string,
    token: string,
  ) {
    const sale = await this.resolveSale(access, customerAccountId, token);
    this.assertBankTransferOpen(sale);
    return this.media.createPaymentProofUploadSignature(
      sale.businessId,
      sale.id,
    );
  }

  async submitProof(
    access: "delivery" | "receipt",
    customerAccountId: string,
    token: string,
    dto: SubmitPaymentProofDto,
  ) {
    const sale = await this.resolveSale(access, customerAccountId, token);
    this.assertBankTransferOpen(sale);
    const amount = new Prisma.Decimal(dto.amount);
    const balance = sale.total.sub(sale.amountPaid);
    const pending = sale.paymentProofs
      .filter((proof) => proof.status === "SUBMITTED")
      .reduce(
        (sum, proof) => sum.add(proof.amount),
        new Prisma.Decimal(0),
      );
    if (amount.lessThanOrEqualTo(0) || amount.greaterThan(balance.sub(pending))) {
      throw new BadRequestException(
        "Proof amount exceeds the unclaimed order balance",
      );
    }
    const asset = await this.media.registerPaymentProofAsset(
      sale.businessId,
      sale.id,
      this.uploadFromDto(dto),
    );
    return this.prisma.paymentProof.create({
      data: {
        amount,
        assetId: asset.id,
        businessId: sale.businessId,
        reference: dto.reference?.trim(),
        saleId: sale.id,
      },
      select: {
        amount: true,
        id: true,
        reference: true,
        status: true,
        submittedAt: true,
      },
    });
  }

  async reviewProof(
    auth: OwnerAuthContext,
    proofId: string,
    dto: ReviewPaymentProofDto,
  ) {
    const proof = await this.prisma.paymentProof.findFirst({
      where: { id: proofId, businessId: auth.businessId },
      include: { sale: true },
    });
    if (!proof) throw new NotFoundException("Payment proof not found");
    if (proof.status !== "SUBMITTED") {
      throw new BadRequestException("Payment proof was already reviewed");
    }
    if (dto.decision === "REJECTED") {
      return this.prisma.paymentProof.update({
        where: { id: proof.id },
        data: {
          reviewNote: dto.note?.trim(),
          reviewedAt: new Date(),
          reviewedById: auth.userId,
          status: "REJECTED",
        },
        include: ownerProofInclude,
      });
    }
    const nextPaid = proof.sale.amountPaid.add(proof.amount);
    if (nextPaid.greaterThan(proof.sale.total)) {
      throw new BadRequestException("Payment proof exceeds the remaining balance");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.paymentEntry.create({
        data: {
          amount: proof.amount,
          note: "Verified customer transfer proof",
          paymentProofId: proof.id,
          recordedById: auth.userId,
          reference: proof.reference,
          saleId: proof.saleId,
          type: "PAYMENT",
        },
      });
      await tx.sale.update({
        where: { id: proof.saleId },
        data: {
          amountPaid: nextPaid,
          paymentStatus: paymentStatus(nextPaid, proof.sale.total),
        },
      });
      const unlocked = await tx.delivery.updateMany({
        where: { saleId: proof.saleId, status: "AWAITING_PAYMENT" },
        data: { status: "PREPARING" },
      });
      if (unlocked.count) {
        const unlockedDelivery = await tx.delivery.findUniqueOrThrow({
          where: { saleId: proof.saleId },
          select: { id: true },
        });
        await tx.deliveryEvent.create({
          data: {
            actorId: auth.userId,
            deliveryId: unlockedDelivery.id,
            note: "Payment proof verified; fulfilment can begin",
            status: "PREPARING",
          },
        });
      }
      const updated = await tx.paymentProof.update({
        where: { id: proof.id },
        data: {
          reviewNote: dto.note?.trim(),
          reviewedAt: new Date(),
          reviewedById: auth.userId,
          status: "VERIFIED",
        },
        include: ownerProofInclude,
      });
      await this.activity.record(
        {
          businessId: auth.businessId,
          actorId: auth.userId,
          customerId: proof.sale.customerId,
          saleId: proof.saleId,
          type: "PAYMENT_UPDATED",
          title: `Verified transfer proof for ${proof.sale.referenceCode}`,
          awardTrust: false,
        },
        tx,
      );
      return updated;
    });
    const receiptId = updated.sale.receipt?.id;
    if (!receiptId) return { ...updated, receiptDelivery: null };
    try {
      const receiptDelivery = await this.messaging.enqueueReceipt(auth, receiptId, { awaitDelivery: true });
      return { ...updated, receiptDelivery };
    } catch (error) {
      return {
        ...updated,
        receiptDelivery: {
          error: error instanceof Error ? error.message : "Receipt delivery could not start",
          imageAttached: false,
          receiptId,
          status: "FAILED",
        },
      };
    }
  }

  private uploadFromDto(dto: SubmitPaymentProofDto): RegisteredUpload {
    return {
      bytes: dto.bytes,
      format: dto.format,
      height: dto.height,
      originalFilename: dto.originalFilename,
      publicId: dto.publicId,
      secureUrl: dto.secureUrl,
      signature: dto.signature,
      version: dto.version,
      width: dto.width,
    };
  }

  private async resolveSale(
    access: "delivery" | "receipt",
    customerAccountId: string,
    token: string,
  ) {
    const tokenHash = hashToken(token);
    if (access === "receipt") {
      const direct = await this.prisma.receipt.findFirst({
        where: { tokenHash, customer: { accountId: customerAccountId } },
        include: {
          sale: {
            include: { paymentInstruction: true, paymentProofs: true },
          },
        },
      });
      if (direct && direct.status !== "VOID") return direct.sale;
      const shared = await this.prisma.receiptShareToken.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          receipt: { customer: { accountId: customerAccountId } },
        },
        include: {
          receipt: {
            include: {
              sale: {
                include: { paymentInstruction: true, paymentProofs: true },
              },
            },
          },
        },
      });
      if (shared && shared.receipt.status !== "VOID") {
        return shared.receipt.sale;
      }
      if (/^[A-Za-z2-9]{8}$/.test(token)) {
        const shortLink = await this.prisma.shortLink.findFirst({
          where: {
            code: token,
            kind: "RECEIPT",
            receiptId: { not: null },
            receipt: { customer: { accountId: customerAccountId } },
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          include: {
            receipt: {
              include: {
                sale: {
                  include: { paymentInstruction: true, paymentProofs: true },
                },
              },
            },
          },
        });
        if (shortLink?.receipt && shortLink.receipt.status !== "VOID") {
          return shortLink.receipt.sale;
        }
      }
    } else {
      const direct = await this.prisma.delivery.findFirst({
        where: { tokenHash, customer: { accountId: customerAccountId } },
        include: {
          sale: {
            include: { paymentInstruction: true, paymentProofs: true },
          },
        },
      });
      if (direct) return direct.sale;
      const shared = await this.prisma.deliveryShareToken.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          delivery: { customer: { accountId: customerAccountId } },
        },
        include: {
          delivery: {
            include: {
              sale: {
                include: { paymentInstruction: true, paymentProofs: true },
              },
            },
          },
        },
      });
      if (shared) return shared.delivery.sale;
      const convertedRequest = await this.prisma.orderRequest.findFirst({
        where: { tokenHash, customerAccountId },
        include: {
          convertedSale: {
            include: { paymentInstruction: true, paymentProofs: true },
          },
        },
      });
      if (convertedRequest?.convertedSale) return convertedRequest.convertedSale;
    }
    throw new NotFoundException("Payment link not found");
  }

  private assertBankTransferOpen(sale: Awaited<ReturnType<PaymentsService["resolveSale"]>>) {
    if (sale.paymentInstruction?.method !== "BANK_TRANSFER") {
      throw new BadRequestException("This order does not use bank transfer");
    }
    if (sale.amountPaid.greaterThanOrEqualTo(sale.total)) {
      throw new BadRequestException("This order is already fully paid");
    }
  }
}

function paymentStatus(amountPaid: Prisma.Decimal, total: Prisma.Decimal) {
  if (amountPaid.lessThanOrEqualTo(0)) return "UNPAID" as const;
  if (amountPaid.greaterThanOrEqualTo(total)) return "PAID" as const;
  return "PARTIAL" as const;
}
