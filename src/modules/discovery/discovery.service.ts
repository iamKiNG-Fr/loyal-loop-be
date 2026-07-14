import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request } from "express";
import type { OwnerAuthContext } from "../../common/request-context";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { IntelligenceService } from "../intelligence/intelligence.service";
import {
  CreateShowcaseDto,
  DiscoveryEventDto,
  ExploreDto,
  UpdateShowcaseDto,
} from "./dto/discovery.dto";

const productImages = {
  include: { asset: true },
  orderBy: { sortOrder: "asc" as const },
};

const discoveryBusinessInclude = {
  coverAsset: true,
  logoAsset: true,
};

const discoveryProductInclude = {
  business: { include: discoveryBusinessInclude },
  images: productImages,
  media: {
    include: { asset: true, posterAsset: true },
    orderBy: { sortOrder: "asc" as const },
  },
  variants: { where: { active: true }, orderBy: { sortOrder: "asc" as const } },
};

const discoveryShowcaseInclude = {
  asset: true,
  posterAsset: true,
  business: { include: discoveryBusinessInclude },
  hotspots: {
    include: { product: { include: { images: productImages } } },
    orderBy: { sortOrder: "asc" as const },
  },
};

type DiscoveryBusiness = Prisma.BusinessGetPayload<{
  include: typeof discoveryBusinessInclude;
}>;
type DiscoveryProduct = Prisma.ProductGetPayload<{
  include: typeof discoveryProductInclude;
}>;
type DiscoveryShowcase = Prisma.ShowcaseGetPayload<{
  include: typeof discoveryShowcaseInclude;
}>;

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intelligence: IntelligenceService,
  ) {}

  async explore(query: ExploreDto, customerAccountId?: string, visitorHash?: string) {
    const cursorOffset = decodeDiscoveryCursor(query.cursor);
    const start = cursorOffset ?? (query.page - 1) * query.pageSize;
    const page = Math.floor(start / query.pageSize) + 1;
    const normalized = query.query?.trim();
    const category = query.category?.trim();
    const plan = normalized
      ? await this.intelligence.parseDiscoveryQuery(normalized)
      : { expandedTerms: [], filters: [], mode: "fallback" as const, originalQuery: "" };
    const filterValue = (key: string) => plan.filters.find((filter) => filter.key === key)?.value;
    const minPrice = query.minPrice ?? numberFilter(filterValue("minPrice"));
    const maxPrice = query.maxPrice ?? numberFilter(filterValue("maxPrice"));
    const inStock = query.inStock ?? booleanFilter(filterValue("inStock"));
    const color = query.color ?? stringFilter(filterValue("color"));
    const size = query.size ?? stringFilter(filterValue("size"));
    const terms = [...new Set([normalized, ...plan.expandedTerms].filter(Boolean) as string[])].slice(0, 8);
    const take = Math.min(start + query.pageSize + 12, 100);
    const productWhere: Prisma.ProductWhereInput = {
      status: "ACTIVE",
      visibility: "PUBLIC",
      business: { storeStatus: "OPEN" },
      ...(category && category.toLowerCase() !== "all"
        ? { category: { equals: category, mode: "insensitive" } }
        : {}),
      ...(minPrice !== undefined || maxPrice !== undefined
        ? { price: { gte: minPrice, lte: maxPrice } }
        : {}),
      ...(inStock ? { stockCount: { gt: 0 } } : {}),
      ...(color
        ? { variants: { some: { active: true, optionValues: { path: ["color"], string_contains: color } } } }
        : {}),
      ...(size
        ? { variants: { some: { active: true, optionValues: { path: ["size"], string_contains: size } } } }
        : {}),
      ...(terms.length
        ? {
            OR: terms.flatMap((term) => [
              { name: { contains: term, mode: "insensitive" as const } },
              { category: { contains: term, mode: "insensitive" as const } },
              { description: { contains: term, mode: "insensitive" as const } },
              { business: { name: { contains: term, mode: "insensitive" as const } } },
            ]),
          }
        : {}),
    };
    const showcaseWhere: Prisma.ShowcaseWhereInput = {
      status: "PUBLISHED",
      business: { storeStatus: "OPEN" },
      ...(category && category.toLowerCase() !== "all"
        ? {
            hotspots: {
              some: {
                product: {
                  category: { equals: category, mode: "insensitive" },
                },
              },
            },
          }
        : {}),
      ...(terms.length
        ? {
            OR: terms.flatMap((term) => [
              { title: { contains: term, mode: "insensitive" as const } },
              { caption: { contains: term, mode: "insensitive" as const } },
              { business: { name: { contains: term, mode: "insensitive" as const } } },
              { hotspots: { some: { product: { name: { contains: term, mode: "insensitive" as const } } } } },
            ]),
          }
        : {}),
    };
    const [products, showcases, productCount, showcaseCount, categories, preference, productSignals, showcaseSignals] =
      await Promise.all([
        query.mode === "showcases" ? Promise.resolve([]) : this.prisma.product.findMany({
          where: productWhere,
          include: discoveryProductInclude,
          orderBy: [{ placement: "desc" }, { updatedAt: "desc" }],
          take,
        }),
        query.mode === "products" ? Promise.resolve([]) : this.prisma.showcase.findMany({
          where: showcaseWhere,
          include: discoveryShowcaseInclude,
          orderBy: [{ featured: "desc" }, { publishedAt: "desc" }, { updatedAt: "desc" }],
          take,
        }),
        query.mode === "showcases" ? Promise.resolve(0) : this.prisma.product.count({ where: productWhere }),
        query.mode === "products" ? Promise.resolve(0) : this.prisma.showcase.count({ where: showcaseWhere }),
        this.prisma.product.findMany({
          where: {
            status: "ACTIVE",
            visibility: "PUBLIC",
            category: { not: null },
            business: { storeStatus: "OPEN" },
          },
          distinct: ["category"],
          select: { category: true },
          orderBy: { category: "asc" },
          take: 24,
        }),
        customerAccountId
          ? this.prisma.discoveryPreference.findFirst({ where: { customerAccountId, businessId: null } })
          : Promise.resolve(null),
        this.prisma.commerceEvent.groupBy({
          by: ["productId", "type"],
          where: { productId: { not: null }, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
          _count: true,
        }),
        this.prisma.commerceEvent.groupBy({
          by: ["showcaseId", "type"],
          where: { showcaseId: { not: null }, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
          _count: true,
        }),
      ]);

    const combined = diverseDiscoveryOrder([
      ...products.map((product) => ({
        sortDate: product.updatedAt,
        score: signalScore(productSignals, "productId", product.id),
        businessId: product.businessId,
        value: productCard(product),
      })),
      ...showcases.map((showcase) => ({
        sortDate: showcase.publishedAt ?? showcase.updatedAt,
        score: signalScore(showcaseSignals, "showcaseId", showcase.id),
        businessId: showcase.businessId,
        value: showcaseCard(showcase),
      })),
    ], preference?.preferences);
    const total = productCount + showcaseCount;
    const items = combined.slice(start, start + query.pageSize).map((entry) => entry.value);
    void this.recordTelemetry("SEARCH_COMPLETED", {
      customerAccountId,
      visitorHash,
      metadata: {
        fallback: normalized ? plan.mode === "fallback" : false,
        mode: query.mode ?? "for-you",
        queryMode: normalized ? plan.mode : "standard",
        resultCount: items.length,
        total,
        zeroResult: total === 0,
      },
      value: items.length,
    });
    return {
      categories: categories.flatMap((entry) =>
        entry.category ? [entry.category] : [],
      ),
      hasMore: start + query.pageSize < total,
      items,
      page,
      pageSize: query.pageSize,
      nextCursor: start + query.pageSize < total ? encodeDiscoveryCursor(start + query.pageSize) : null,
      appliedFilters: visibleFilters(query, plan.filters),
      expandedTerms: plan.expandedTerms,
      queryMode: normalized ? plan.mode : "standard",
      fallback: normalized ? plan.mode === "fallback" : false,
      total,
    };
  }

  parseQuery(query: string) {
    return this.intelligence.parseDiscoveryQuery(query);
  }

  visitorHash(request: Request) {
    return createHash("sha256")
      .update(`${new Date().toISOString().slice(0, 10)}:${request.ip}:${request.header("user-agent") ?? ""}`)
      .digest("hex");
  }

  async savePreference(
    values: string[],
    customerAccountId?: string,
    visitorHash?: string,
  ) {
    const preferences = [...new Set(values.map((value) => value.trim().slice(0, 80)).filter(Boolean))].slice(0, 20);
    const existing = await this.prisma.discoveryPreference.findFirst({
      where: customerAccountId
        ? { customerAccountId, businessId: null }
        : { visitorHash, businessId: null },
    });
    if (existing) {
      return this.prisma.discoveryPreference.update({ where: { id: existing.id }, data: { preferences } });
    }
    return this.prisma.discoveryPreference.create({
      data: { customerAccountId, visitorHash, preferences },
    });
  }

  async recordEvent(
    dto: DiscoveryEventDto,
    customerAccountId?: string,
    visitorHash?: string,
  ) {
    if (!dto.productId && !dto.showcaseId) throw new BadRequestException("Choose a product or Showcase event target");
    const target = dto.productId
      ? await this.prisma.product.findFirst({ where: { id: dto.productId, status: "ACTIVE", visibility: "PUBLIC" }, select: { id: true, businessId: true } })
      : await this.prisma.showcase.findFirst({ where: { id: dto.showcaseId, status: "PUBLISHED" }, select: { id: true, businessId: true } });
    if (!target) throw new NotFoundException("Discovery target not found");
    const dedupeKey = dto.dedupeKey
      ? createHash("sha256").update(`${customerAccountId ?? visitorHash}:${dto.dedupeKey}`).digest("hex")
      : undefined;
    try {
      return await this.prisma.commerceEvent.create({
        data: {
          businessId: target.businessId,
          customerAccountId,
          visitorHash,
          productId: dto.productId,
          showcaseId: dto.showcaseId,
          sessionKey: dto.sessionKey,
          dedupeKey,
          type: dto.type,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && dedupeKey) {
        return this.prisma.commerceEvent.findUnique({ where: { dedupeKey } });
      }
      throw error;
    }
  }

  async clearRecommendationData(customerAccountId?: string, visitorHash?: string) {
    if (!customerAccountId && !visitorHash) throw new BadRequestException("Recommendation identity is required");
    const where = customerAccountId ? { customerAccountId } : { visitorHash };
    const [preferences, events, telemetry] = await this.prisma.$transaction([
      this.prisma.discoveryPreference.deleteMany({ where }),
      this.prisma.commerceEvent.updateMany({
        where,
        data: customerAccountId ? { customerAccountId: null } : { visitorHash: null },
      }),
      this.prisma.discoveryTelemetry.deleteMany({ where }),
    ]);
    return { disconnectedEvents: events.count, removedPreferences: preferences.count, removedTelemetry: telemetry.count };
  }

  recordTelemetry(
    type: string,
    input: { customerAccountId?: string; visitorHash?: string; value?: number; metadata?: Prisma.InputJsonValue },
  ) {
    return this.prisma.discoveryTelemetry.create({
      data: {
        customerAccountId: input.customerAccountId,
        visitorHash: input.visitorHash,
        type: type.slice(0, 60),
        value: input.value,
        metadata: input.metadata,
      },
    }).catch(() => null);
  }

  async publicShowcase(id: string) {
    const showcase = await this.prisma.showcase.findFirst({
      where: {
        id,
        status: "PUBLISHED",
        business: { storeStatus: "OPEN" },
      },
      include: discoveryShowcaseInclude,
    });
    if (!showcase) throw new NotFoundException("Showcase not found");
    return showcaseCard(showcase);
  }

  ownerShowcases(auth: OwnerAuthContext) {
    return this.prisma.showcase.findMany({
      where: { businessId: auth.businessId, status: { not: "ARCHIVED" } },
      include: discoveryShowcaseInclude,
      orderBy: [{ featured: "desc" }, { updatedAt: "desc" }],
    });
  }

  async createShowcase(auth: OwnerAuthContext, dto: CreateShowcaseDto) {
    const mediaKind = dto.mediaKind ?? "IMAGE";
    await this.validateShowcaseInput(auth.businessId, dto.assetId, mediaKind, dto.posterAssetId, dto.hotspots);
    const status = dto.status ?? "PUBLISHED";
    return this.prisma.showcase.create({
      data: {
        assetId: dto.assetId,
        posterAssetId: dto.posterAssetId,
        mediaKind,
        durationSeconds: mediaKind === "VIDEO" ? dto.durationSeconds : null,
        businessId: auth.businessId,
        caption: dto.caption?.trim(),
        featured: dto.featured ?? false,
        publishedAt: status === "PUBLISHED" ? new Date() : undefined,
        status,
        title: dto.title.trim(),
        hotspots: {
          create: uniqueHotspots(dto.hotspots).map((hotspot, index) => ({
            ...hotspot,
            sortOrder: index,
          })),
        },
      },
      include: discoveryShowcaseInclude,
    });
  }

  async updateShowcase(
    auth: OwnerAuthContext,
    id: string,
    dto: UpdateShowcaseDto,
  ) {
    const current = await this.prisma.showcase.findFirst({
      where: { id, businessId: auth.businessId, status: { not: "ARCHIVED" } },
    });
    if (!current) throw new NotFoundException("Showcase not found");
    await this.validateShowcaseInput(
      auth.businessId,
      dto.assetId ?? current.assetId,
      dto.mediaKind ?? current.mediaKind,
      dto.posterAssetId ?? current.posterAssetId ?? undefined,
      dto.hotspots,
    );
    return this.prisma.$transaction(async (tx) => {
      if (dto.hotspots) {
        await tx.showcaseHotspot.deleteMany({ where: { showcaseId: id } });
      }
      return tx.showcase.update({
        where: { id },
        data: {
          assetId: dto.assetId,
          posterAssetId: dto.posterAssetId,
          mediaKind: dto.mediaKind,
          durationSeconds: dto.mediaKind === "IMAGE" ? null : dto.durationSeconds,
          caption: dto.caption?.trim(),
          featured: dto.featured,
          publishedAt:
            dto.status === "PUBLISHED" && !current.publishedAt
              ? new Date()
              : undefined,
          status: dto.status,
          title: dto.title?.trim(),
          hotspots: dto.hotspots
            ? {
                create: uniqueHotspots(dto.hotspots).map((hotspot, index) => ({
                  ...hotspot,
                  sortOrder: index,
                })),
              }
            : undefined,
        },
        include: discoveryShowcaseInclude,
      });
    });
  }

  async archiveShowcase(auth: OwnerAuthContext, id: string) {
    const changed = await this.prisma.showcase.updateMany({
      where: { id, businessId: auth.businessId, status: { not: "ARCHIVED" } },
      data: { featured: false, status: "ARCHIVED" },
    });
    if (!changed.count) throw new NotFoundException("Showcase not found");
    return { id };
  }

  async myShops(customerAccountId: string) {
    const [follows, requests] = await Promise.all([
      this.prisma.shopFollow.findMany({
        where: { customerAccountId, business: { storeStatus: { not: "CLOSED" } } },
        include: { business: { include: discoveryBusinessInclude } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.orderRequest.findMany({
        where: { customerAccountId, business: { storeStatus: { not: "CLOSED" } } },
        distinct: ["businessId"],
        include: { business: { include: discoveryBusinessInclude } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const shops = new Map<string, ReturnType<typeof shopCard>>();
    for (const follow of follows) {
      shops.set(follow.businessId, shopCard(follow.business, "Following"));
    }
    for (const request of requests) {
      if (!shops.has(request.businessId)) {
        shops.set(request.businessId, shopCard(request.business, "Ordered from"));
      }
    }
    return [...shops.values()];
  }

  async saved(customerAccountId: string) {
    const [products, showcases] = await Promise.all([
      this.prisma.wishlistItem.findMany({
        where: {
          customerAccountId,
          product: { status: "ACTIVE", visibility: "PUBLIC" },
        },
        include: { product: { include: discoveryProductInclude } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.savedShowcase.findMany({
        where: { customerAccountId, showcase: { status: "PUBLISHED" } },
        include: { showcase: { include: discoveryShowcaseInclude } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      products: products.map((item) => productCard(item.product)),
      showcases: showcases.map((item) => showcaseCard(item.showcase)),
    };
  }

  async following(customerAccountId: string, businessId: string) {
    const count = await this.prisma.shopFollow.count({
      where: { customerAccountId, businessId },
    });
    return { following: count > 0 };
  }

  async follow(customerAccountId: string, businessId: string) {
    const business = await this.prisma.business.findFirst({
      where: { id: businessId, storeStatus: { not: "CLOSED" } },
      select: { id: true },
    });
    if (!business) throw new NotFoundException("Shop not found");
    return this.prisma.shopFollow.upsert({
      where: {
        customerAccountId_businessId: { customerAccountId, businessId },
      },
      create: { businessId, customerAccountId },
      update: {},
    });
  }

  unfollow(customerAccountId: string, businessId: string) {
    return this.prisma.shopFollow.deleteMany({
      where: { customerAccountId, businessId },
    });
  }

  async saveShowcase(customerAccountId: string, showcaseId: string) {
    const showcase = await this.prisma.showcase.findFirst({
      where: {
        id: showcaseId,
        status: "PUBLISHED",
        business: { storeStatus: { not: "CLOSED" } },
      },
      select: { businessId: true },
    });
    if (!showcase) throw new NotFoundException("Showcase not found");
    return this.prisma.savedShowcase.upsert({
      where: {
        customerAccountId_showcaseId: { customerAccountId, showcaseId },
      },
      create: {
        businessId: showcase.businessId,
        customerAccountId,
        showcaseId,
      },
      update: {},
    });
  }

  removeShowcase(customerAccountId: string, showcaseId: string) {
    return this.prisma.savedShowcase.deleteMany({
      where: { customerAccountId, showcaseId },
    });
  }

  private async validateShowcaseInput(
    businessId: string,
    assetId: string,
    mediaKind: "IMAGE" | "VIDEO",
    posterAssetId?: string,
    hotspots?: Array<{ productId: string; x: number; y: number }>,
  ) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        businessId,
        purpose: mediaKind === "VIDEO" ? "SHOWCASE_VIDEO" : "SHOWCASE_IMAGE",
        status: "ACTIVE",
      },
      select: { durationSeconds: true, id: true },
    });
    if (!asset) throw new BadRequestException(`Showcase ${mediaKind.toLowerCase()} is invalid`);
    if (mediaKind === "VIDEO") {
      if ((asset.durationSeconds ?? 0) > 30) throw new BadRequestException("Showcase videos must be 30 seconds or shorter");
      if (!posterAssetId) throw new BadRequestException("Showcase videos require a poster image");
      const poster = await this.prisma.mediaAsset.findFirst({
        where: { id: posterAssetId, businessId, purpose: "SHOWCASE_POSTER", status: "ACTIVE" },
        select: { id: true },
      });
      if (!poster) throw new BadRequestException("Showcase video poster is invalid");
    }
    if (!hotspots?.length) return;
    const productIds = [...new Set(hotspots.map((hotspot) => hotspot.productId))];
    const productCount = await this.prisma.product.count({
      where: { id: { in: productIds }, businessId, status: { not: "ARCHIVED" } },
    });
    if (productCount !== productIds.length) {
      throw new BadRequestException("One or more Showcase products are invalid");
    }
  }
}

function productCard(product: DiscoveryProduct) {
  return {
    business: shopIdentity(product.business),
    category: product.category,
    currency: product.currency,
    description: product.description,
    id: product.id,
    images: product.images.map((image) => ({
      height: image.asset.height,
      id: image.asset.id,
      url: image.asset.secureUrl,
      width: image.asset.width,
    })),
    media: product.media.map((media) => ({
      altText: media.altText,
      durationSeconds: media.durationSeconds,
      height: media.asset.height,
      id: media.id,
      kind: media.kind,
      posterUrl: media.posterAsset?.secureUrl ?? null,
      url: media.asset.secureUrl,
      width: media.asset.width,
    })),
    kind: "product" as const,
    name: product.name,
    placement: product.placement,
    price: product.price,
    slug: product.slug,
    stockCount: product.stockCount,
    variants: product.variants.map((variant) => ({
      active: variant.active,
      id: variant.id,
      name: variant.name,
      optionValues: variant.optionValues,
      priceOverride: variant.priceOverride,
      sku: variant.sku,
      stockCount: variant.stockCount,
    })),
  };
}

function showcaseCard(showcase: DiscoveryShowcase) {
  return {
    business: shopIdentity(showcase.business),
    caption: showcase.caption,
    featured: showcase.featured,
    hotspots: showcase.hotspots.map((hotspot) => ({
      id: hotspot.id,
      product: {
        currency: hotspot.product.currency,
        id: hotspot.product.id,
        image: hotspot.product.images[0]?.asset.secureUrl ?? null,
        name: hotspot.product.name,
        price: hotspot.product.price,
        slug: hotspot.product.slug,
        stockCount: hotspot.product.stockCount,
      },
      x: hotspot.x,
      y: hotspot.y,
    })),
    id: showcase.id,
    image: {
      height: showcase.asset.height,
      id: showcase.asset.id,
      url: showcase.asset.secureUrl,
      width: showcase.asset.width,
    },
    media: {
      durationSeconds: showcase.durationSeconds,
      kind: showcase.mediaKind,
      posterUrl: showcase.posterAsset?.secureUrl ?? null,
      url: showcase.asset.secureUrl,
    },
    kind: "showcase" as const,
    title: showcase.title,
  };
}

function shopIdentity(business: DiscoveryBusiness) {
  return {
    coverUrl: business.coverAsset?.secureUrl ?? null,
    id: business.id,
    logoUrl: business.logoAsset?.secureUrl ?? null,
    name: business.name,
    slug: business.slug,
  };
}

function shopCard(business: DiscoveryBusiness, relationship: string) {
  return {
    ...shopIdentity(business),
    category: business.category,
    description: business.description,
    location: business.location,
    relationship,
    storeStatus: business.storeStatus,
  };
}

function uniqueHotspots<T extends { productId: string }>(hotspots: T[]) {
  return hotspots.filter(
    (hotspot, index) =>
      hotspots.findIndex((entry) => entry.productId === hotspot.productId) === index,
  );
}

function numberFilter(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function booleanFilter(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function stringFilter(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 50) : undefined;
}

function visibleFilters(
  query: ExploreDto,
  parsed: Array<{ key: string; label: string; value: string | number | boolean }>,
) {
  const explicit = [
    query.category && query.category.toLowerCase() !== "all" ? { key: "category", label: query.category, value: query.category } : null,
    query.color ? { key: "color", label: `Colour: ${query.color}`, value: query.color } : null,
    query.size ? { key: "size", label: `Size: ${query.size}`, value: query.size } : null,
    query.minPrice !== undefined ? { key: "minPrice", label: `From ₦${query.minPrice.toLocaleString()}`, value: query.minPrice } : null,
    query.maxPrice !== undefined ? { key: "maxPrice", label: `Under ₦${query.maxPrice.toLocaleString()}`, value: query.maxPrice } : null,
    query.inStock ? { key: "inStock", label: "In stock", value: true } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: string | number | boolean }>;
  return [...new Map([...explicit, ...parsed].map((filter) => [filter.key, filter])).values()];
}

function diverseDiscoveryOrder<T extends {
  businessId: string;
  score?: number;
  sortDate: Date;
  value: unknown;
}>(items: T[], rawPreference: unknown) {
  const preferences = Array.isArray(rawPreference)
    ? new Set(rawPreference.filter((value): value is string => typeof value === "string").map((value) => value.toLowerCase()))
    : new Set<string>();
  const ranked = [...items].sort((left, right) => {
    const leftCategory = discoveryCategory(left.value);
    const rightCategory = discoveryCategory(right.value);
    const leftPreference = leftCategory && preferences.has(leftCategory.toLowerCase()) ? 1 : 0;
    const rightPreference = rightCategory && preferences.has(rightCategory.toLowerCase()) ? 1 : 0;
    return rightPreference - leftPreference
      || (right.score ?? 0) - (left.score ?? 0)
      || right.sortDate.getTime() - left.sortDate.getTime();
  });
  const result: T[] = [];
  const pending = [...ranked];
  while (pending.length) {
    const recentBusinesses = new Set(result.slice(-2).map((item) => item.businessId));
    const index = pending.findIndex((item) => !recentBusinesses.has(item.businessId));
    result.push(pending.splice(index >= 0 ? index : 0, 1)[0]!);
  }
  return result;
}

function signalScore<T extends { _count: number; type: string }>(
  rows: T[],
  idKey: "productId" | "showcaseId",
  id: string,
) {
  const weights: Record<string, number> = {
    PRODUCT_VIEWED: 1,
    SHOWCASE_VIEWED: 1,
    PRODUCT_SHARED: 2,
    SHOWCASE_SHARED: 2,
    PRODUCT_SAVED: 3,
    PRODUCT_WISHLISTED: 3,
    SHOWCASE_SAVED: 3,
    REQUEST_SUBMITTED: 5,
    PURCHASE_COMPLETED: 8,
  };
  return rows.reduce((total, row) => {
    const target = (row as T & Record<typeof idKey, string | null>)[idKey];
    return target === id ? total + row._count * (weights[row.type] ?? 0) : total;
  }, 0);
}

function discoveryCategory(value: unknown) {
  if (!value || typeof value !== "object" || !("category" in value)) return null;
  const category = (value as { category?: unknown }).category;
  return typeof category === "string" ? category : null;
}

function encodeDiscoveryCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeDiscoveryCursor(cursor?: string) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    return typeof value.offset === "number" && Number.isInteger(value.offset) && value.offset >= 0 && value.offset <= 10_000
      ? value.offset
      : null;
  } catch {
    return null;
  }
}
