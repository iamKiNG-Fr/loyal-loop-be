import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createOpaqueToken, createReference } from "../../common/crypto.util";
import { assessDeliveryCoverage, customerFulfillmentMethods } from "../../common/delivery-eligibility";
import type { CustomerAuthContext } from "../../common/request-context";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PromotionsService } from "../promotions/promotions.service";
import { MessagingService } from "../messaging/messaging.service";
import {
  AddCartItemDto,
  SubmitCartDto,
  UpdateCartGroupDto,
} from "./dto/cart.dto";

const cartInclude = {
  groups: {
    include: {
      business: { select: { id: true, name: true, slug: true, platformStatus: true, preferences: true } },
      customerAddress: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
  items: {
    include: {
      business: { select: { id: true, name: true, slug: true, storeStatus: true, platformStatus: true, preferences: true } },
      product: {
        include: {
          images: { include: { asset: true }, orderBy: { sortOrder: "asc" as const }, take: 1 },
          promotions: { where: { status: "ACTIVE" as const }, orderBy: { createdAt: "desc" as const } },
        },
      },
      variant: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
};

type CartWithItems = Prisma.CustomerCartGetPayload<{ include: typeof cartInclude }>;

@Injectable()
export class CartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: PromotionsService,
    private readonly messaging: MessagingService,
  ) {}

  async deviceCart(deviceKey: string) {
    return this.read(await this.getOrCreateDeviceCart(this.validDeviceKey(deviceKey)));
  }

  async accountCart(auth: CustomerAuthContext) {
    return this.read(await this.getOrCreateAccountCart(auth.customerAccountId));
  }

  async addDeviceItem(deviceKey: string, dto: AddCartItemDto) {
    const cart = await this.getOrCreateDeviceCart(this.validDeviceKey(deviceKey));
    await this.addItem(cart.id, dto);
    return this.deviceCart(deviceKey);
  }

  async addAccountItem(auth: CustomerAuthContext, dto: AddCartItemDto) {
    const cart = await this.getOrCreateAccountCart(auth.customerAccountId);
    await this.addItem(cart.id, dto);
    return this.accountCart(auth);
  }

  async updateItem(cartId: string, itemId: string, quantity: number) {
    const changed = await this.prisma.customerCartItem.updateMany({
      where: { id: itemId, cartId },
      data: { quantity },
    });
    if (!changed.count) throw new NotFoundException("Cart item not found");
  }

  async removeItem(cartId: string, itemId: string) {
    const changed = await this.prisma.customerCartItem.deleteMany({ where: { id: itemId, cartId } });
    if (!changed.count) throw new NotFoundException("Cart item not found");
  }

  async updateAccountItem(auth: CustomerAuthContext, itemId: string, quantity: number) {
    const cart = await this.getOrCreateAccountCart(auth.customerAccountId);
    await this.updateItem(cart.id, itemId, quantity);
    return this.accountCart(auth);
  }

  async removeAccountItem(auth: CustomerAuthContext, itemId: string) {
    const cart = await this.getOrCreateAccountCart(auth.customerAccountId);
    await this.removeItem(cart.id, itemId);
    return this.accountCart(auth);
  }

  async updateDeviceItem(deviceKey: string, itemId: string, quantity: number) {
    const cart = await this.getOrCreateDeviceCart(this.validDeviceKey(deviceKey));
    await this.updateItem(cart.id, itemId, quantity);
    return this.deviceCart(deviceKey);
  }

  async removeDeviceItem(deviceKey: string, itemId: string) {
    const cart = await this.getOrCreateDeviceCart(this.validDeviceKey(deviceKey));
    await this.removeItem(cart.id, itemId);
    return this.deviceCart(deviceKey);
  }

  async updateGroup(auth: CustomerAuthContext, businessId: string, dto: UpdateCartGroupDto) {
    const cart = await this.getOrCreateAccountCart(auth.customerAccountId);
    const hasItems = await this.prisma.customerCartItem.count({ where: { cartId: cart.id, businessId } });
    if (!hasItems) throw new NotFoundException("Shop cart group not found");
    if (dto.customerAddressId) {
      const address = await this.prisma.customerAddress.findFirst({
        where: { id: dto.customerAddressId, customerAccountId: auth.customerAccountId },
      });
      if (!address) throw new BadRequestException("Saved address is not available");
    }
    const preferences = await this.prisma.businessPreferences.findUnique({ where: { businessId } });
    if (dto.paymentPreference && preferences && !preferences.allowedPaymentMethods.includes(dto.paymentPreference)) {
      throw new BadRequestException("That payment method is not accepted by this shop");
    }
    if (dto.fulfillment && preferences && !customerFulfillmentMethods(preferences.allowedFulfillmentMethods).includes(dto.fulfillment)) {
      throw new BadRequestException("That collection method is not offered by this shop");
    }
    await this.prisma.customerCartGroup.upsert({
      where: { cartId_businessId: { cartId: cart.id, businessId } },
      create: { cartId: cart.id, businessId, ...dto, note: dto.note?.trim() },
      update: { ...dto, note: dto.note?.trim() },
    });
    return this.accountCart(auth);
  }

  async merge(auth: CustomerAuthContext, deviceKey: string) {
    const key = this.validDeviceKey(deviceKey);
    const accountCart = await this.getOrCreateAccountCart(auth.customerAccountId);
    const deviceCart = await this.prisma.customerCart.findUnique({
      where: { deviceKey_status: { deviceKey: key, status: "ACTIVE" } },
      include: { items: true, groups: true },
    });
    if (!deviceCart || deviceCart.id === accountCart.id) return this.accountCart(auth);
    await this.prisma.$transaction(async (tx) => {
      for (const item of deviceCart.items) {
        const existing = await tx.customerCartItem.findUnique({
          where: { cartId_productId_variantKey: { cartId: accountCart.id, productId: item.productId, variantKey: item.variantKey } },
        });
        await tx.customerCartItem.upsert({
          where: {
            cartId_productId_variantKey: {
              cartId: accountCart.id,
              productId: item.productId,
              variantKey: item.variantKey,
            },
          },
          create: {
            cartId: accountCart.id,
            businessId: item.businessId,
            productId: item.productId,
            variantId: item.variantId,
            variantKey: item.variantKey,
            quantity: Math.min(item.quantity, 100),
            priceSnapshot: item.priceSnapshot,
            stockSnapshot: item.stockSnapshot,
          },
          update: { quantity: Math.min((existing?.quantity ?? 0) + item.quantity, 100) },
        });
      }
      for (const group of deviceCart.groups) {
        await tx.customerCartGroup.upsert({
          where: { cartId_businessId: { cartId: accountCart.id, businessId: group.businessId } },
          create: {
            cartId: accountCart.id,
            businessId: group.businessId,
            fulfillment: group.fulfillment,
            note: group.note,
            paymentPreference: group.paymentPreference,
            isGift: group.isGift,
            recipientName: group.recipientName,
            recipientPhone: group.recipientPhone,
            whatsappUpdatesConsent: group.whatsappUpdatesConsent,
          },
          update: {},
        });
      }
      await tx.customerCart.update({ where: { id: deviceCart.id }, data: { status: "ABANDONED" } });
    });
    return this.accountCart(auth);
  }

  async submit(auth: CustomerAuthContext, dto: SubmitCartDto) {
    const cart = await this.getOrCreateAccountCart(auth.customerAccountId);
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: auth.customerAccountId } });
    const hydrated = await this.read(cart);
    const requestedIds = dto.businessIds?.length ? dto.businessIds : hydrated.groups.map((group) => group.business.id);
    const selected = new Set(requestedIds);
    const results: Array<Record<string, unknown>> = [];

    for (const businessId of requestedIds.filter((id) => !hydrated.groups.some((group) => group.business.id === id))) {
      const existing = await this.prisma.orderRequest.findFirst({
        where: { customerAccountId: auth.customerAccountId, clientIdempotencyKey: `${dto.idempotencyKey}:${businessId}` },
        include: { items: true },
      });
      if (existing) results.push({ businessId, ok: true, request: existing, replayed: true });
    }

    for (const group of hydrated.groups.filter((entry) => selected.has(entry.business.id))) {
      const groupItems = hydrated.items.filter((item) => item.business.id === group.business.id);
      const groupKey = `${dto.idempotencyKey}:${group.business.id}`;
      try {
        if (!groupItems.length) continue;
        if (groupItems.some((item) => !item.available)) throw new BadRequestException("One or more items are unavailable");
        if (!dto.confirmedChanges && groupItems.some((item) => item.priceChanged || item.stockChanged)) {
          throw new BadRequestException("Confirm the latest price and availability before sending");
        }
        if (group.paymentPreference && group.business.preferences && !group.business.preferences.allowedPaymentMethods.includes(group.paymentPreference)) {
          throw new BadRequestException("The selected payment method is no longer accepted");
        }
        if (!group.paymentPreference) {
          throw new BadRequestException("Choose how you want to pay before sending this request");
        }
        if (!customerFulfillmentMethods(group.business.preferences?.allowedFulfillmentMethods).includes(group.fulfillment)) {
          throw new BadRequestException("Choose a collection method currently offered by this shop");
        }
        const existing = await this.prisma.orderRequest.findFirst({
          where: { customerAccountId: auth.customerAccountId, clientIdempotencyKey: groupKey },
          include: { items: true },
        });
        if (existing) {
          results.push({ businessId: group.business.id, ok: true, request: existing, replayed: true });
          continue;
        }
        const address = group.customerAddressId
          ? await this.prisma.customerAddress.findFirst({ where: { id: group.customerAddressId, customerAccountId: auth.customerAccountId } })
          : null;
        if (group.fulfillment === "DELIVERY" && !address) throw new BadRequestException("Choose a saved delivery address");
        const coverage = group.fulfillment === "DELIVERY" && address
          ? assessDeliveryCoverage({
              address: address.address,
              administrativeArea1: address.administrativeArea1,
              countryCode: address.countryCode,
              deliveryAreas: group.business.preferences?.deliveryAreas,
              deliveryStates: group.business.preferences?.deliveryStates,
            })
          : { administrativeArea1: undefined, status: "NOT_APPLICABLE" as const };
        if (coverage.status === "OUTSIDE_AREA") {
          const areas = group.business.preferences?.deliveryStates.length
            ? group.business.preferences.deliveryStates
            : group.business.preferences?.deliveryAreas ?? [];
          throw new BadRequestException(`${group.business.name} currently delivers to ${areas.join(", ")}`);
        }
        if (group.isGift && (group.fulfillment !== "DELIVERY" || !group.recipientName?.trim() || !group.recipientPhone?.trim())) {
          throw new BadRequestException("Gift delivery needs the recipient name and phone");
        }
        if (group.whatsappUpdatesConsent) {
          await this.messaging.grantPhoneConsent(account.phone, "DELIVERY", "order-request", auth.customerAccountId);
        }
        const token = createOpaqueToken();
        const request = await this.prisma.$transaction(async (tx) => {
          const customerKey = `account:${auth.customerAccountId}`;
          const quotedItems = [];
          for (const item of groupItems) {
            const quote = await this.promotions.quote(tx, { businessId: group.business.id, customerKey, productId: item.productId, quantity: item.quantity, variantId: item.variantId });
            quotedItems.push({ item, quote });
          }
          const created = await tx.orderRequest.create({
            data: {
              businessId: group.business.id,
              customerAccountId: auth.customerAccountId,
              clientIdempotencyKey: groupKey,
              referenceCode: createReference("REQ"),
              tokenHash: token.tokenHash,
              customerName: account.name?.trim() || "Loyal Loop customer",
              customerPhone: account.phone,
              channel: "OTHER",
              fulfillment: group.fulfillment,
              customerAddressId: address?.id,
              deliveryAddress: address?.address,
              deliveryPlaceId: address?.googlePlaceId,
              deliveryLatitude: address?.latitude,
               deliveryLongitude: address?.longitude,
               deliveryCountryCode: address?.countryCode,
               deliveryAdministrativeArea1: coverage.administrativeArea1 ?? address?.administrativeArea1,
               deliveryLocality: address?.locality,
               deliveryEligibility: coverage.status === "OUTSIDE_AREA" ? "NEEDS_REVIEW" : coverage.status,
              deliveryNotes: address?.deliveryNotes,
              note: group.note,
              requestedPaymentMethod: group.paymentPreference,
              isGift: group.isGift,
              recipientName: group.isGift ? group.recipientName?.trim() : undefined,
              recipientPhone: group.isGift ? group.recipientPhone?.trim() : undefined,
              items: {
                create: quotedItems.map(({ item, quote }) => ({
                  productId: item.productId,
                  variantId: item.variantId,
                  variantName: item.variant?.name,
                  variantSnapshot: item.variant
                    ? { name: item.variant.name, optionValues: item.variant.optionValues, sku: item.variant.sku }
                    : undefined,
                  name: item.product.name,
                  imageUrl: item.product.images[0]?.asset.secureUrl,
                  quantity: item.quantity,
                  originalUnitPrice: quote.promotionId ? quote.originalUnitPrice : undefined,
                  promotionId: quote.promotionId,
                  promotionSnapshot: quote.promotionSnapshot,
                  unitPrice: quote.unitPrice,
                  total: quote.unitPrice.mul(item.quantity),
                })),
              },
              events: { create: { businessId: group.business.id, customerAccountId: auth.customerAccountId, type: "REQUEST_SUBMITTED" } },
            },
            include: { items: true },
          });
          for (const { item, quote } of quotedItems) {
            await this.promotions.reserve(tx, { customerAccountId: auth.customerAccountId, customerKey, orderRequestId: created.id, quantity: item.quantity, quote });
          }
          await tx.customerCartItem.deleteMany({ where: { cartId: cart.id, businessId: group.business.id } });
          await tx.customerCartGroup.deleteMany({ where: { cartId: cart.id, businessId: group.business.id } });
          return created;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        await this.messaging.enqueueOrderRequestStatus(request.id, token.token).catch(() => undefined);
        results.push({ businessId: group.business.id, ok: true, request, token: token.token });
      } catch (error) {
        results.push({ businessId: group.business.id, ok: false, error: error instanceof Error ? error.message : "Request failed" });
      }
    }
    return { results, cart: await this.accountCart(auth) };
  }

  private async addItem(cartId: string, dto: AddCartItemDto) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,
        status: "ACTIVE",
        visibility: "PUBLIC",
        business: { storeStatus: "OPEN", platformStatus: "ACTIVE" },
      },
      include: {
        business: { select: { preferences: true } },
        variants: { where: { active: true } },
        promotions: { where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!product) throw new NotFoundException("Product is unavailable");
    const variant = dto.variantId
      ? product.variants.find((entry) => entry.id === dto.variantId)
      : product.variants.length === 1 ? product.variants[0] : undefined;
    if (dto.variantId && !variant) throw new BadRequestException("Product variant is unavailable");
    if (!dto.variantId && product.variants.length > 1) throw new BadRequestException("Choose a product variant");
    const price = displayPromotionPrice(product, variant?.id, variant?.priceOverride ?? product.price).price;
    const stock = variant?.stockCount ?? product.stockCount;
    if (stock !== null && stock < dto.quantity) throw new BadRequestException("Requested quantity is not in stock");
    const variantKey = variant?.id ?? "default";
    const existing = await this.prisma.customerCartItem.findUnique({
      where: { cartId_productId_variantKey: { cartId, productId: product.id, variantKey } },
    });
    const quantity = (existing?.quantity ?? 0) + dto.quantity;
    if (quantity > 100) throw new BadRequestException("Cart quantity cannot exceed 100");
    if (stock !== null && stock < quantity) throw new BadRequestException("Requested quantity is not in stock");
    await this.prisma.$transaction([
      this.prisma.customerCartItem.upsert({
        where: { cartId_productId_variantKey: { cartId, productId: product.id, variantKey } },
        create: {
          cartId,
          businessId: product.businessId,
          productId: product.id,
          variantId: variant?.id,
          variantKey,
          quantity: dto.quantity,
          priceSnapshot: price,
          stockSnapshot: stock,
        },
        update: { quantity },
      }),
      this.prisma.customerCartGroup.upsert({
        where: { cartId_businessId: { cartId, businessId: product.businessId } },
        create: {
          cartId,
          businessId: product.businessId,
          fulfillment: customerFulfillmentMethods(product.business.preferences?.allowedFulfillmentMethods)[0],
          paymentPreference: product.business.preferences?.defaultPaymentMethod
            ?? (product.business.preferences?.allowedPaymentMethods.length === 1
              ? product.business.preferences.allowedPaymentMethods[0]
              : undefined),
        },
        update: {},
      }),
    ]);
  }

  private async read(cart: { id: string }) {
    const full = await this.prisma.customerCart.findUniqueOrThrow({ where: { id: cart.id }, include: cartInclude });
    return cartPayload(full);
  }

  private getOrCreateAccountCart(customerAccountId: string) {
    return this.prisma.customerCart.upsert({
      where: { customerAccountId_status: { customerAccountId, status: "ACTIVE" } },
      create: { customerAccountId },
      update: {},
    });
  }

  private getOrCreateDeviceCart(deviceKey: string) {
    return this.prisma.customerCart.upsert({
      where: { deviceKey_status: { deviceKey, status: "ACTIVE" } },
      create: { deviceKey },
      update: {},
    });
  }

  private validDeviceKey(value: string) {
    const key = value?.trim();
    if (!key || key.length < 16 || key.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(key)) {
      throw new BadRequestException("A valid cart device key is required");
    }
    return key;
  }
}

function cartPayload(cart: CartWithItems) {
  const items = cart.items.map((item) => {
    const priced = displayPromotionPrice(item.product, item.variantId, item.variant?.priceOverride ?? item.product.price);
    const currentPrice = priced.price.toString();
    const currentStock = item.variant?.stockCount ?? item.product.stockCount;
    const available = item.product.status === "ACTIVE"
      && item.product.visibility === "PUBLIC"
      && item.business.storeStatus === "OPEN"
      && item.business.platformStatus === "ACTIVE"
      && (currentStock === null || currentStock >= item.quantity);
    return {
      ...item,
      available,
      currentPrice,
      originalPrice: priced.promotion ? priced.originalPrice.toString() : null,
      promotion: priced.promotion,
      currentStock,
      priceChanged: !new Prisma.Decimal(currentPrice).equals(item.priceSnapshot),
      stockChanged: currentStock !== item.stockSnapshot,
    };
  });
  const groups = cart.groups.map((group) => ({
    ...group,
    items: items.filter((item) => item.businessId === group.businessId),
  }));
  return { id: cart.id, items, groups, status: cart.status, updatedAt: cart.updatedAt };
}

function displayPromotionPrice(
  product: { promotions: Array<{ endsAt: Date | null; id: string; name: string; percentage: number | null; promotionalPrice: Prisma.Decimal | null; startsAt: Date | null; type: string; variantId: string | null }> },
  variantId: string | null | undefined,
  originalPrice: Prisma.Decimal,
) {
  const now = new Date();
  const promotion = (product.promotions || []).find((item) => (!item.variantId || item.variantId === variantId) && (!item.startsAt || item.startsAt <= now) && (!item.endsAt || item.endsAt > now));
  const price = !promotion ? originalPrice : promotion.type === "PERCENTAGE"
    ? originalPrice.mul(100 - (promotion.percentage ?? 0)).div(100).toDecimalPlaces(2)
    : promotion.promotionalPrice!;
  return { originalPrice, price, promotion: promotion ? { endsAt: promotion.endsAt, id: promotion.id, name: promotion.name, percentage: promotion.percentage, type: promotion.type } : null };
}
