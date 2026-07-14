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
import {
  Prisma,
  type CustomerChannel,
  type FulfillmentType,
} from "../../generated/prisma/client";
import { ActivityService } from "../activity/activity.service";
import { BusinessesService } from "../businesses/businesses.service";
import { PrismaService } from "../prisma/prisma.service";
import { SalesService } from "../sales/sales.service";
import { TrustService } from "../trust/trust.service";
import {
  CreateOrderRequestDto,
  ConfirmOrderRequestDto,
  ProductInterestDto,
  UpdateOrderRequestStatusDto,
} from "./dto/shop.dto";
import type { DiscoveryQuery } from "./discovery-attribution";
import { discoverySource, toDiscoveryAttribution } from "./discovery-attribution";

const publicProductInclude = {
  images: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const },
  },
};

const publicShowcaseInclude = {
  asset: true,
  hotspots: {
    include: { product: { include: publicProductInclude } },
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
    private readonly businesses: BusinessesService,
  ) {}

  async getPublicShop(slug: string, visitor?: string, query?: DiscoveryQuery) {
    await this.businesses.reconcileScheduledLaunchBySlug(slug);
    const business = await this.prisma.business.findFirst({
      where: { slug, storeStatus: { not: "CLOSED" } },
      include: {
        coverAsset: true,
        logoAsset: true,
        launchProduct: { include: publicProductInclude },
        contacts: { orderBy: { sortOrder: "asc" } },
        preferences: true,
        products: {
          where: { status: "ACTIVE", visibility: "PUBLIC" },
          include: publicProductInclude,
          orderBy: [{ placement: "asc" }, { createdAt: "desc" }],
        },
        showcases: {
          where: { status: "PUBLISHED" },
          include: publicShowcaseInclude,
          orderBy: [{ featured: "desc" }, { publishedAt: "desc" }],
        },
      },
    });
    if (!business) throw new NotFoundException("Shop not found");
    await this.recordCommerceEvent(business.id, "SHOP_VIEWED", visitor, undefined, query);
    const open = business.storeStatus === "OPEN";
    return {
      business: sanitizeBusiness(business),
      canRequest: open,
      products: open ? business.products : [],
      showcases: open ? business.showcases : [],
      trust: await this.trust.summary(business.id, false),
    };
  }

  async getPublicProduct(slug: string, productSlug: string, visitor?: string, query?: DiscoveryQuery) {
    await this.businesses.reconcileScheduledLaunchBySlug(slug);
    const product = await this.prisma.product.findFirst({
      where: {
        slug: productSlug,
        status: "ACTIVE",
        visibility: "PUBLIC",
        business: { slug, storeStatus: "OPEN" },
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
      query,
    );
    return product;
  }

  async createRequest(
    slug: string,
    dto: CreateOrderRequestDto,
    rawCustomerSession?: string,
  ) {
    await this.businesses.reconcileScheduledLaunchBySlug(slug);
    const business = await this.prisma.business.findFirst({
      where: { slug, storeStatus: "OPEN" },
      select: { id: true, preferences: true },
    });
    if (!business) throw new NotFoundException("Shop is not accepting requests");
    if (
      dto.requestedPaymentMethod &&
      !business.preferences?.allowedPaymentMethods.includes(dto.requestedPaymentMethod)
    ) {
      throw new BadRequestException("That payment method is not accepted by this shop");
    }
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
    if (dto.sourceShowcaseId) {
      const source = await this.prisma.showcase.findFirst({
        where: {
          id: dto.sourceShowcaseId,
          businessId: business.id,
          status: "PUBLISHED",
          hotspots: { some: { productId: { in: productIds } } },
        },
        select: { id: true },
      });
      if (!source) throw new BadRequestException("Showcase source is invalid");
    }
    const customerAccountId = rawCustomerSession
      ? await this.resolveCustomerAccount(rawCustomerSession)
      : undefined;
    const customerAccount = customerAccountId
      ? await this.prisma.customerAccount.findUnique({
          where: { id: customerAccountId },
        })
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
    if (
      dto.isGift &&
      (fulfillment !== "DELIVERY" ||
        !dto.recipientName?.trim() ||
        !dto.recipientPhone?.trim())
    ) {
      throw new BadRequestException(
        "Gift delivery requires the recipient name, phone, and delivery address",
      );
    }
    const customerName = customerAccount?.name?.trim() || dto.customerName.trim();
    const customerPhone = customerAccount?.phone || dto.customerPhone.trim();
    if (customerAccount && !customerAccount.name?.trim()) {
      await this.prisma.customerAccount.update({
        where: { id: customerAccount.id },
        data: { name: customerName },
      });
    }
    const generated = createOpaqueToken();
    const request = await this.prisma.orderRequest.create({
      data: {
        businessId: business.id,
        customerAccountId,
        referenceCode: createReference("REQ"),
        tokenHash: generated.tokenHash,
        customerName,
        customerPhone,
        channel: dto.channel,
        requestedPaymentMethod: dto.requestedPaymentMethod,
        fulfillment,
        customerAddressId: savedAddress?.id,
        sourceShowcaseId: dto.sourceShowcaseId,
        deliveryAddress,
        deliveryPlaceId:
          savedAddress?.googlePlaceId?.trim() || dto.deliveryPlaceId?.trim(),
        deliveryLatitude: savedAddress?.latitude ?? dto.deliveryLatitude,
        deliveryLongitude: savedAddress?.longitude ?? dto.deliveryLongitude,
        deliveryNotes:
          savedAddress?.deliveryNotes?.trim() || dto.deliveryNotes?.trim(),
        isGift: dto.isGift ?? false,
        recipientName: dto.isGift ? dto.recipientName?.trim() : undefined,
        recipientPhone: dto.isGift ? dto.recipientPhone?.trim() : undefined,
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

  async cancelRequestByToken(token: string) {
    const request = await this.prisma.orderRequest.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        business: { select: { name: true, slug: true } },
        items: true,
        convertedSale: { include: { receipt: true, delivery: true } },
      },
    });
    if (!request) throw new NotFoundException("Request not found");
    if (request.status === "CONVERTED" || request.convertedSale) {
      throw new BadRequestException("Confirmed orders cannot be canceled from the request link");
    }
    if (request.status === "CANCELED") {
      const { tokenHash: _tokenHash, ...safe } = request;
      return safe;
    }
    const canceled = await this.prisma.orderRequest.updateMany({
      where: {
        id: request.id,
        status: { in: ["SENT", "ACCEPTED", "NEEDS_CHANGES"] },
      },
      data: { status: "CANCELED" },
    });
    if (canceled.count !== 1) {
      throw new BadRequestException("This request can no longer be canceled from the request link");
    }
    const updated = await this.prisma.orderRequest.findUnique({
      where: { id: request.id },
      include: {
        business: { select: { name: true, slug: true } },
        items: true,
        convertedSale: { include: { receipt: true, delivery: true } },
      },
    });
    if (!updated) throw new NotFoundException("Request not found");
    const { tokenHash: _tokenHash, ...safe } = updated;
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

  async changeRequestedPaymentMethod(
    customerAccountId: string,
    requestId: string,
    paymentMethod: import("../../generated/prisma/client").PaymentMethod,
  ) {
    const request = await this.prisma.orderRequest.findFirst({
      where: { id: requestId, customerAccountId },
      include: { business: { include: { preferences: true } } },
    });
    if (!request) throw new NotFoundException("Request not found");
    if (request.status !== "NEEDS_CHANGES") {
      throw new BadRequestException("Payment preference is locked after submission");
    }
    if (!request.business.preferences?.allowedPaymentMethods.includes(paymentMethod)) {
      throw new BadRequestException("That payment method is not accepted by this shop");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.orderRequestPaymentChange.create({
        data: {
          orderRequestId: request.id,
          customerAccountId,
          previousMethod: request.requestedPaymentMethod,
          nextMethod: paymentMethod,
        },
      });
      const updated = await tx.orderRequest.update({
        where: { id: request.id },
        data: { requestedPaymentMethod: paymentMethod, status: "SENT" },
        include: { items: true, paymentChanges: true },
      });
      await tx.activityEvent.create({
        data: {
          businessId: request.businessId,
          type: "REQUEST_PAYMENT_UPDATED",
          title: `Payment preference updated for ${request.referenceCode}`,
          metadata: { orderRequestId: request.id, paymentMethod },
        },
      });
      return updated;
    });
  }

  async convertRequest(
    auth: OwnerAuthContext,
    requestId: string,
    dto: ConfirmOrderRequestDto,
    idempotencyKey?: string,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const request = await tx.orderRequest.findFirst({
            where: { id: requestId, businessId: auth.businessId },
            include: {
              items: true,
              convertedSale: {
                include: { receipt: true, delivery: true },
              },
            },
          });
          if (!request) throw new NotFoundException("Request not found");
          if (request.convertedSale) return { sale: request.convertedSale };
          if (request.status === "CANCELED") {
            throw new BadRequestException("Canceled requests cannot be converted");
          }

          let customer = await tx.customer.findFirst({
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
            customer = await tx.customer.create({
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
                customerId: customer.id,
                type: "CUSTOMER_ADDED",
                title: `Added ${customer.name} from request`,
              },
              tx,
            );
          }

          return this.sales.create(
            auth,
            {
              customerId: customer.id,
              sourceRequestId: request.id,
              amountPaid: dto.amountPaid,
              channel: "WEBSITE",
              deliveryFee: dto.deliveryFee,
              fulfillment: dto.fulfillment ?? request.fulfillment,
              deliveryAddress: request.deliveryAddress ?? undefined,
              deliveryPlaceId: request.deliveryPlaceId ?? undefined,
              deliveryLatitude: request.deliveryLatitude ?? undefined,
              deliveryLongitude: request.deliveryLongitude ?? undefined,
              deliveryNotes: request.deliveryNotes ?? undefined,
              isGift: request.isGift,
              recipientName: request.recipientName ?? undefined,
              recipientPhone: request.recipientPhone ?? undefined,
              notes: dto.notes,
              paymentAccountId: dto.paymentAccountId,
              paymentAccountName: dto.paymentAccountName,
              paymentAccountNumber: dto.paymentAccountNumber,
              paymentBankName: dto.paymentBankName,
              paymentInstructions: dto.paymentInstructions,
              paymentMethod: dto.paymentMethod,
              items: request.items.map((item) => ({
                productId: item.productId ?? undefined,
                name: item.name,
                imageUrl: item.imageUrl ?? undefined,
                quantity: item.quantity,
                unitPrice: item.unitPrice.toString(),
              })),
            },
            idempotencyKey ?? `request:${request.id}`,
            tx,
          );
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code)
      ) {
        const request = await this.prisma.orderRequest.findFirst({
          where: { id: requestId, businessId: auth.businessId },
          include: {
            convertedSale: {
              include: { receipt: true, delivery: true },
            },
          },
        });
        if (request?.convertedSale) return { sale: request.convertedSale };
      }
      throw error;
    }
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
    await this.businesses.reconcileScheduledLaunchBySlug(businessSlug);
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        business: { slug: businessSlug, storeStatus: "OPEN" },
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
    query?: DiscoveryQuery,
  ) {
    const attribution = toDiscoveryAttribution(query);
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
      if (recent) {
        if (attribution && !discoverySource(recent.metadata)) {
          await this.prisma.commerceEvent.update({
            where: { id: recent.id },
            data: { metadata: { attribution } },
          });
        }
        return;
      }
    }
    await this.prisma.commerceEvent.create({
      data: {
        businessId,
        type,
        visitorHash: visitor,
        productId,
        metadata: attribution ? { attribution } : undefined,
      },
    });
  }
}

function sanitizeBusiness(business: Record<string, unknown>) {
  const source = business as {
    id: string;
    name: string;
    slug: string;
    publicCardId: string;
    category?: string | null;
    description?: string | null;
    location?: string | null;
    storeStatus: string;
    launchAt?: Date | null;
    launchTimezone?: string | null;
    launchTemplate?: string;
    launchMessage?: string | null;
    launchShareVersion?: number;
    launchedAt?: Date | null;
    logoAsset?: { secureUrl?: string } | null;
    coverAsset?: { secureUrl?: string } | null;
    contacts?: Array<{
      platform: string;
      value: string;
      label?: string | null;
      isPrimary: boolean;
      sortOrder: number;
    }>;
    preferences?: {
      theme?: string;
      shelfMode?: string;
      showRecommended?: boolean;
      showLatest?: boolean;
      tickerItems?: string[];
      feedbackResponseTime?: string;
      allowedPaymentMethods?: string[];
      defaultPaymentMethod?: string | null;
    } | null;
    launchProduct?: {
      id: string;
      slug: string;
      name: string;
      description?: string | null;
      price: unknown;
      currency: string;
      category?: string | null;
      status: string;
      visibility: string;
      stockCount?: number | null;
      images?: unknown[];
    } | null;
  };
  const teaser =
    source.launchProduct?.status === "ACTIVE" &&
    source.launchProduct.visibility === "PUBLIC"
      ? {
          id: source.launchProduct.id,
          slug: source.launchProduct.slug,
          name: source.launchProduct.name,
          description: source.launchProduct.description,
          price: source.launchProduct.price,
          currency: source.launchProduct.currency,
          category: source.launchProduct.category,
          stockCount: source.launchProduct.stockCount,
          images: source.launchProduct.images,
        }
      : null;
  return {
    id: source.id,
    name: source.name,
    slug: source.slug,
    publicCardId: source.publicCardId,
    category: source.category,
    description: source.description,
    location: source.location,
    storeStatus: source.storeStatus,
    logoAsset: source.logoAsset?.secureUrl
      ? { secureUrl: source.logoAsset.secureUrl }
      : null,
    coverAsset: source.coverAsset?.secureUrl
      ? { secureUrl: source.coverAsset.secureUrl }
      : null,
    contacts: source.contacts ?? [],
    preferences: source.preferences
      ? {
          theme: source.preferences.theme,
          shelfMode: source.preferences.shelfMode,
          showRecommended: source.preferences.showRecommended,
          showLatest: source.preferences.showLatest,
          tickerItems: source.preferences.tickerItems,
          feedbackResponseTime: source.preferences.feedbackResponseTime,
          allowedPaymentMethods: source.preferences.allowedPaymentMethods,
          defaultPaymentMethod: source.preferences.defaultPaymentMethod,
        }
      : null,
    launchAt: source.launchAt,
    launchTimezone: source.launchTimezone,
    launchTemplate: source.launchTemplate,
    launchMessage: source.launchMessage,
    launchShareVersion: source.launchShareVersion,
    launchedAt: source.launchedAt,
    launchDue:
      source.storeStatus === "SCHEDULED" &&
      Boolean(source.launchAt && source.launchAt.getTime() <= Date.now()),
    launchProduct: teaser,
  };
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
