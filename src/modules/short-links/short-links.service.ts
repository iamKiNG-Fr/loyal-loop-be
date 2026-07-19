import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createShortCode, hashToken } from "../../common/crypto.util";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateShortLinkDto } from "./dto/short-link.dto";

@Injectable()
export class ShortLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateShortLinkDto) {
    const target = await this.validateTarget(dto);
    const fingerprint = hashToken(JSON.stringify({
      businessId: target.businessId,
      campaign: dto.campaign,
      kind: dto.kind,
      productId: target.productId ?? null,
      receiptId: target.receiptId ?? null,
      source: dto.source,
    }));
    const existing = await this.prisma.shortLink.findUnique({ where: { fingerprint } });
    if (existing) {
      if (existing.revokedAt || existing.expiresAt) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          try {
            return await this.prisma.shortLink.update({
              where: { id: existing.id },
              data: { code: createShortCode(), expiresAt: null, revokedAt: null },
              select: { code: true },
            });
          }
          catch (error: unknown) {
            if ((error as { code?: string }).code !== "P2002") throw error;
          }
        }
        throw new ServiceUnavailableException("A short link could not be prepared");
      }
      return { code: existing.code };
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        return await this.prisma.shortLink.create({
          data: {
            ...target,
            campaign: dto.campaign,
            code: createShortCode(),
            fingerprint,
            kind: dto.kind,
            source: dto.source,
          },
          select: { code: true },
        });
      }
      catch (error: unknown) {
        if ((error as { code?: string }).code !== "P2002") throw error;
        const raced = await this.prisma.shortLink.findUnique({ where: { fingerprint } });
        if (raced) return { code: raced.code };
      }
    }
    throw new ServiceUnavailableException("A short link could not be prepared");
  }

  async resolve(code: string) {
    if (!/^[A-Za-z2-9]{8}$/.test(code)) throw new NotFoundException("Short link not found");
    const link = await this.prisma.shortLink.findUnique({
      where: { code },
      include: {
        business: { select: { publicCardId: true, slug: true } },
        product: { select: { id: true } },
      },
    });
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt <= new Date())) {
      throw new NotFoundException("Short link not found");
    }
    const path = link.kind === "SHOP"
      ? `/shop/${encodeURIComponent(link.business.slug)}`
      : link.kind === "PRODUCT" && link.product
        ? `/shop/${encodeURIComponent(link.business.slug)}?product=${encodeURIComponent(link.product.id)}`
        : link.kind === "RECEIPT" && link.receiptId
          ? `/receipt/${encodeURIComponent(link.code)}`
          : link.kind === "TRUST_CARD"
            ? `/c/${encodeURIComponent(link.business.publicCardId)}`
            : null;
    if (!path) throw new NotFoundException("Short link target not found");
    return { attribution: { campaign: link.campaign, medium: "social", source: link.source }, path };
  }

  private async validateTarget(dto: CreateShortLinkDto) {
    if (dto.kind === "SHOP" && dto.shopSlug) {
      const business = await this.prisma.business.findFirst({ where: { slug: dto.shopSlug, storeStatus: { not: "CLOSED" }, platformStatus: "ACTIVE" }, select: { id: true } });
      if (business) return { businessId: business.id };
    }
    if (dto.kind === "PRODUCT" && dto.shopSlug && dto.productKey) {
      const product = await this.prisma.product.findFirst({
        where: {
          business: { slug: dto.shopSlug, storeStatus: { not: "CLOSED" }, platformStatus: "ACTIVE" },
          status: "ACTIVE",
          visibility: "PUBLIC",
          OR: [{ id: dto.productKey }, { slug: dto.productKey }, { name: { equals: dto.productKey, mode: "insensitive" } }],
        },
        select: { businessId: true, id: true },
      });
      if (product) return { businessId: product.businessId, productId: product.id };
    }
    if (dto.kind === "RECEIPT" && dto.receiptToken) {
      const tokenHash = hashToken(dto.receiptToken);
      const direct = await this.prisma.receipt.findUnique({ where: { tokenHash }, select: { businessId: true, id: true, status: true } });
      const shared = direct ? null : await this.prisma.receiptShareToken.findUnique({ where: { tokenHash }, select: { revokedAt: true, receipt: { select: { businessId: true, id: true, status: true } } } });
      const receipt = direct ?? (!shared?.revokedAt ? shared?.receipt : null);
      if (receipt && receipt.status !== "VOID") return { businessId: receipt.businessId, receiptId: receipt.id };
    }
    if (dto.kind === "TRUST_CARD" && dto.cardId) {
      const business = await this.prisma.business.findFirst({ where: { publicCardId: dto.cardId.toUpperCase(), storeStatus: { not: "CLOSED" }, platformStatus: "ACTIVE" }, select: { id: true } });
      if (business) return { businessId: business.id };
    }
    throw new NotFoundException("Share target not found");
  }
}
