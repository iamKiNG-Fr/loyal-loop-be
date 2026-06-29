import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createOpaqueToken,
  createReference,
  hashPrivateValue,
  hashToken,
} from "../../common/crypto.util";
import type { OwnerAuthContext } from "../../common/request-context";
import type {
  CustomerChannel,
  FulfillmentType,
} from "../../generated/prisma/client";
import { ActivityService } from "../activity/activity.service";
import { PrismaService } from "../prisma/prisma.service";
import { SalesService } from "../sales/sales.service";
import { TrustService } from "../trust/trust.service";
import {
  CreateOrderRequestDto,
  ProductInterestDto,
  UpdateOrderRequestStatusDto,
} from "./dto/shop.dto";

const publicProductInclude = {
  images: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const },
  },
};

@Injectable()
export class ShopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly activity: ActivityService,
    private readonly trust: TrustService,
    private readonly config: ConfigService,
  ) {}

  async getPublicShop(slug: string, visitor?: string) {
    const business = await this.prisma.business.findFirst({
      where: { slug, storeStatus: { not: "CLOSED" } },
      include: {
        logoAsset: true,
        contacts: { orderBy: { sortOrder: "asc" } },
        preferences: true,
        products: {
          where: { status: "ACTIVE", visibility: "PUBLIC" },
          include: publicProductInclude,
          orderBy: [{ placement: "asc" }, { createdAt: "desc" }],
        },
      },
    });
    if (!business) throw new NotFoundException("Shop not found");
    await this.recordCommerceEvent(business.id, "SHOP_VIEWED", visitor);
    return {
      business: sanitizeBusiness(business),
      products: business.products,
      trust: await this.trust.summary(business.id, false),
    };
  }

  async getPublicProduct(slug: string, productSlug: string, visitor?: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        slug: productSlug,
        status: "ACTIVE",
        visibility: "PUBLIC",
        business: { slug, storeStatus: { not: "CLOSED" } },
      },
      include: {
        ...publicProductInclude,
        business: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!product) throw new NotFoundException("Product not found");
    await this.recordCommerceEvent(
      product.businessId,
      "PRODUCT_VIEWED",
      visitor,
      product.id,
    );
    return product;
  }

  async createRequest(
    slug: string,
    dto: CreateOrderRequestDto,
    rawCustomerSession?: string,
  ) {
    const business = await this.prisma.business.findFirst({
      where: { slug, storeStatus: "OPEN" },
      select: { id: true },
    });
    if (!business) throw new NotFoundException("Shop is not accepting requests");
    const productIds = [...new Set(dto.items.map((item) => item.productId))];
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        businessId: business.id,
        status: "ACTIVE",
        visibility: "PUBLIC",
      },
      include: {
        images: {
          where: { isPrimary: true },
          include: { asset: true },
          take: 1,
        },
      },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException("One or more requested products are unavailable");
    }
    const customerAccountId = rawCustomerSession
      ? await this.resolveCustomerAccount(rawCustomerSession)
      : undefined;
    const fulfillment: FulfillmentType = dto.fulfillment ?? "ARRANGE_LATER";
    const savedAddress = dto.customerAddressId
      ? await this.resolveCustomerAddress(customerAccountId, dto.customerAddressId)
      : undefined;
    const deliveryAddress =
      savedAddress?.address.trim() || dto.deliveryAddress?.trim();
    if (fulfillment === "DELIVERY" && !deliveryAddress) {
      throw new BadRequestException("Delivery address is required for delivery requests");
    }
    const generated = createOpaqueToken();
    const request = await this.prisma.orderRequest.create({
      data: {
        businessId: business.id,
        customerAccountId,
        referenceCode: createReference("REQ"),
        tokenHash: generated.tokenHash,
        customerName: dto.customerName.trim(),
        customerPhone: dto.customerPhone.trim(),
        channel: dto.channel,
        fulfillment,
        customerAddressId: savedAddress?.id,
        deliveryAddress,
        deliveryPlaceId:
          savedAddress?.googlePlaceId?.trim() || dto.deliveryPlaceId?.trim(),
        deliveryLatitude: savedAddress?.latitude ?? dto.deliveryLatitude,
        deliveryLongitude: savedAddress?.longitude ?? dto.deliveryLongitude,
        deliveryNotes:
          savedAddress?.deliveryNotes?.trim() || dto.deliveryNotes?.trim(),
        note: dto.note?.trim(),
        items: {
          create: dto.items.map((item) => {
            const product = products.find(
              (entry) => entry.id === item.productId,
            )!;
            return {
              productId: product.id,
              name: product.name,
              imageUrl: product.images[0]?.asset.secureUrl,
              quantity: item.quantity,
              unitPrice: product.price,
              total: product.price.mul(item.quantity),
            };
          }),
        },
        events: {
          create: { businessId: business.id, type: "REQUEST_SUBMITTED" },
        },
      },
      include: { items: true },
    });
    return { request, token: generated.token };
  }

  async getRequestByToken(token: string) {
    const request = await this.prisma.orderRequest.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        business: { select: { name: true, slug: true } },
        items: true,
        convertedSale: { include: { receipt: true, delivery: true } },
      },
    });
    if (!request) throw new NotFoundException("Request not found");
    const { tokenHash: _tokenHash, ...safe } = request;
    return safe;
  }

  listRequests(auth: OwnerAuthContext) {
    return this.prisma.orderRequest.findMany({
      where: { businessId: auth.businessId },
      include: { items: true, convertedSale: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateRequest(
    auth: OwnerAuthContext,
    requestId: string,
    dto: UpdateOrderRequestStatusDto,
  ) {
    const request = await this.assertRequest(auth.businessId, requestId);
    if (request.status === "CONVERTED") {
      throw new BadRequestException("Converted requests cannot be changed");
    }
    return this.prisma.orderRequest.update({
      where: { id: requestId },
      data: { status: dto.status },
      include: { items: true },
    });
  }

  async convertRequest(
    auth: OwnerAuthContext,
    requestId: string,
    idempotencyKey?: string,
  ) {
    const request = await this.prisma.orderRequest.findFirst({
      where: { id: requestId, businessId: auth.businessId },
      include: { items: true, convertedSale: { include: { receipt: true, delivery: true } } },
    });
    if (!request) throw new NotFoundException("Request not found");
    if (request.convertedSale) return { sale: request.convertedSale };
    if (request.status === "CANCELED") {
      throw new BadRequestException("Canceled requests cannot be converted");
    }

    let customer = await this.prisma.customer.findFirst({
      where: {
        businessId: auth.businessId,
        OR: [
          { phone: request.customerPhone },
          ...(request.customerAccountId
            ? [{ accountId: request.customerAccountId }]
            : []),
        ],
      },
    });
    if (!customer) {
      const publicAccess = createOpaqueToken();
      customer = await this.prisma.$transaction(async (tx) => {
        const created = await tx.customer.create({
          data: {
            businessId: auth.businessId,
            accountId: request.customerAccountId,
            name: request.customerName,
            phone: request.customerPhone,
            channel: channelToCustomerChannel(request.channel),
            publicTokenHash: publicAccess.tokenHash,
          },
        });
        await this.activity.record(
          {
            businessId: auth.businessId,
            actorId: auth.userId,
            customerId: created.id,
            type: "CUSTOMER_ADDED",
            title: `Added ${created.name} from request`,
          },
          tx,
        );
        return created;
      });
    }
    return this.sales.create(
      auth,
      {
        customerId: customer.id,
        sourceRequestId: request.id,
        channel: request.channel,
        fulfillment: request.fulfillment,
        deliveryAddress: request.deliveryAddress ?? undefined,
        deliveryPlaceId: request.deliveryPlaceId ?? undefined,
        deliveryLatitude: request.deliveryLatitude ?? undefined,
        deliveryLongitude: request.deliveryLongitude ?? undefined,
        deliveryNotes: request.deliveryNotes ?? undefined,
        items: request.items.map((item) => ({
          productId: item.productId ?? undefined,
          name: item.name,
          imageUrl: item.imageUrl ?? undefined,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
        })),
      },
      idempotencyKey ?? `request:${request.id}`,
    );
  }

  async wishlist(customerAccountId: string, businessSlug: string) {
    return this.prisma.wishlistItem.findMany({
      where: {
        customerAccountId,
        business: { slug: businessSlug },
      },
      include: { product: { include: publicProductInclude } },
      orderBy: { createdAt: "desc" },
    });
  }

  async addWishlist(
    customerAccountId: string,
    businessSlug: string,
    productId: string,
  ) {
    const product = await this.publicProduct(businessSlug, productId);
    const item = await this.prisma.wishlistItem.upsert({
      where: {
        customerAccountId_productId: { customerAccountId, productId },
      },
      create: {
        customerAccountId,
        businessId: product.businessId,
        productId,
      },
      update: {},
    });
    await this.prisma.commerceEvent.create({
      data: {
        businessId: product.businessId,
        customerAccountId,
        productId,
        type: "PRODUCT_WISHLISTED",
      },
    });
    return item;
  }

  async removeWishlist(
    customerAccountId: string,
    businessSlug: string,
    productId: string,
  ) {
    await this.publicProduct(businessSlug, productId);
    await this.prisma.wishlistItem.deleteMany({
      where: { customerAccountId, productId },
    });
  }

  async interest(
    customerAccountId: string,
    businessSlug: string,
    dto: ProductInterestDto,
  ) {
    const product = await this.publicProduct(businessSlug, dto.productId);
    const interest = await this.prisma.productInterest.upsert({
      where: {
        customerAccountId_productId_type: {
          customerAccountId,
          productId: dto.productId,
          type: dto.type,
        },
      },
      create: {
        customerAccountId,
        businessId: product.businessId,
        productId: dto.productId,
        type: dto.type,
      },
      update: {},
    });
    await this.prisma.commerceEvent.create({
      data: {
        businessId: product.businessId,
        customerAccountId,
        productId: dto.productId,
        type:
          dto.type === "RESTOCK"
            ? "RESTOCK_INTERESTED"
            : "PRODUCT_WISHLISTED",
      },
    });
    return interest;
  }

  visitorHash(value: string) {
    return hashPrivateValue(
      `${new Date().toISOString().slice(0, 10)}:${value}`,
      this.config.get("SESSION_HASH_SECRET", ""),
    );
  }

  private async publicProduct(businessSlug: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        business: { slug: businessSlug, storeStatus: { not: "CLOSED" } },
        status: "ACTIVE",
        visibility: "PUBLIC",
      },
    });
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  private async assertRequest(businessId: string, requestId: string) {
    const request = await this.prisma.orderRequest.findFirst({
      where: { id: requestId, businessId },
    });
    if (!request) throw new NotFoundException("Request not found");
    return request;
  }

  private async resolveCustomerAccount(rawToken: string) {
    const session = await this.prisma.customerAccountSession.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      return undefined;
    }
    return session.customerAccountId;
  }

  private async resolveCustomerAddress(
    customerAccountId: string | undefined,
    addressId: string,
  ) {
    if (!customerAccountId) {
      throw new BadRequestException("Sign in before using a saved address");
    }
    const address = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerAccountId },
    });
    if (!address) throw new BadRequestException("Saved address is not available");
    return address;
  }

  private async recordCommerceEvent(
    businessId: string,
    type: "SHOP_VIEWED" | "PRODUCT_VIEWED",
    visitor?: string,
    productId?: string,
  ) {
    if (visitor) {
      const recent = await this.prisma.commerceEvent.findFirst({
        where: {
          businessId,
          type,
          visitorHash: visitor,
          productId,
          createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
        },
      });
      if (recent) return;
    }
    await this.prisma.commerceEvent.create({
      data: { businessId, type, visitorHash: visitor, productId },
    });
  }
}

function sanitizeBusiness(business: Record<string, unknown>) {
  const {
    ownerId: _ownerId,
    subscriptionStatus: _subscriptionStatus,
    customerLimit: _customerLimit,
    receiptLimit: _receiptLimit,
    ...safe
  } = business;
  return safe;
}

function channelToCustomerChannel(channel: string) {
  const mapping: Record<string, CustomerChannel> = {
    WHATSAPP: "WHATSAPP",
    INSTAGRAM: "INSTAGRAM",
    FACEBOOK: "FACEBOOK",
    TIKTOK: "TIKTOK",
    SNAPCHAT: "SNAPCHAT",
    WALK_IN: "WALK_IN",
    REFERRAL: "REFERRAL",
    WEBSITE: "WEBSITE",
    OTHER: "OTHER",
  };
  return mapping[channel] ?? "OTHER";
}
