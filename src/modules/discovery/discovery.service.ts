import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { hmacPrivateValue } from "../../common/crypto.util";
import type { OwnerAuthContext } from "../../common/request-context";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { IntelligenceService } from "../intelligence/intelligence.service";
import {
  discoverableProductWhere,
  discoverableShowcaseWhere,
  publicMediaAssetWhere,
} from "../media/public-media";
import {
  CreateShowcaseDto,
  DiscoveryEventDto,
  ExploreDto,
  UpdateShowcaseDto,
} from "./dto/discovery.dto";

const productImages = {
  where: { asset: { is: publicMediaAssetWhere } },
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
    where: { asset: { is: publicMediaAssetWhere } },
    include: { asset: true, posterAsset: true },
    orderBy: { sortOrder: "asc" as const },
  },
  variants: { where: { active: true }, orderBy: { sortOrder: "asc" as const } },
  promotions: { where: { status: "ACTIVE" as const }, orderBy: { createdAt: "desc" as const } },
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

type GlobalDiscoveryData = {
  categories: Array<{ category: string | null }>;
  productSignals: Array<{ _count: number; productId: string | null; type: string }>;
  showcaseSignals: Array<{ _count: number; showcaseId: string | null; type: string }>;
};

@Injectable()
export class DiscoveryService {
  private globalDiscoveryCache: { expiresAt: number; value: GlobalDiscoveryData } | null = null;
  private globalDiscoveryRequest: Promise<GlobalDiscoveryData> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly intelligence: IntelligenceService,
    private readonly config: ConfigService,
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
      ...discoverableProductWhere,
      business: { storeStatus: "OPEN", platformStatus: "ACTIVE", isDemo: false },
      AND: [
        ...(terms.length
          ? [{
              OR: terms.flatMap((term) => [
                { name: { contains: term, mode: "insensitive" as const } },
                { category: { contains: term, mode: "insensitive" as const } },
                { description: { contains: term, mode: "insensitive" as const } },
                { attributes: { path: ["searchTags"], string_contains: term.toLowerCase() } },
                { business: { name: { contains: term, mode: "insensitive" as const } } },
              ]),
            }]
          : []),
      ],
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
    };
    const showcaseWhere: Prisma.ShowcaseWhereInput = {
      ...discoverableShowcaseWhere,
      business: { storeStatus: "OPEN", platformStatus: "ACTIVE", isDemo: false },
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
    const shopWhere: Prisma.BusinessWhereInput = {
      storeStatus: "OPEN",
      platformStatus: "ACTIVE",
      isDemo: false,
      ...(category && category.toLowerCase() !== "all"
        ? { category: { equals: category, mode: "insensitive" } }
        : {}),
      ...(terms.length
        ? {
            OR: terms.flatMap((term) => [
              { name: { contains: term, mode: "insensitive" as const } },
              { category: { contains: term, mode: "insensitive" as const } },
              { categoryDetail: { contains: term, mode: "insensitive" as const } },
              { description: { contains: term, mode: "insensitive" as const } },
              { location: { contains: term, mode: "insensitive" as const } },
              {
                products: {
                  some: {
                    ...discoverableProductWhere,
                    OR: [
                      { name: { contains: term, mode: "insensitive" as const } },
                      { category: { contains: term, mode: "insensitive" as const } },
                      { attributes: { path: ["searchTags"], string_contains: term.toLowerCase() } },
                    ],
                  },
                },
              },
            ]),
          }
        : {}),
    };
    const recommendationIdentity = customerAccountId
      ? { customerAccountId }
      : query.personalized && visitorHash
        ? { visitorHash }
        : null;
    const [products, showcases, productCount, showcaseCount, preference, personalSignals, shops, globalDiscovery] =
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
        recommendationIdentity
          ? this.prisma.discoveryPreference.findFirst({ where: { ...recommendationIdentity, businessId: null } })
          : Promise.resolve(null),
        recommendationIdentity
          ? this.prisma.commerceEvent.findMany({
              where: {
                ...recommendationIdentity,
                createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
              },
              select: {
                business: { select: { category: true } },
                product: { select: { category: true } },
                showcase: {
                  select: {
                    hotspots: {
                      select: { product: { select: { category: true } } },
                    },
                  },
                },
                type: true,
              },
              orderBy: { createdAt: "desc" },
              take: 500,
            })
          : Promise.resolve([]),
        this.prisma.business.findMany({
          where: shopWhere,
          include: discoveryBusinessInclude,
          orderBy: [{ updatedAt: "desc" }],
          take: 24,
        }),
        this.globalDiscoveryData(),
      ]);

    const { categories, productSignals, showcaseSignals } = globalDiscovery;

    const [savedProducts, savedShowcases] = customerAccountId
      ? await Promise.all([
          this.prisma.wishlistItem.findMany({ where: { customerAccountId }, select: { productId: true } }),
          this.prisma.savedShowcase.findMany({ where: { customerAccountId }, select: { showcaseId: true } }),
        ])
      : [[], []];
    const savedProductIds = new Set(savedProducts.map((item) => item.productId));
    const savedShowcaseIds = new Set(savedShowcases.map((item) => item.showcaseId));

    const personalizedCategories = orderDiscoveryCategories(
      categories.flatMap((entry) => entry.category ? [entry.category] : []),
      preference?.preferences,
      personalSignals,
    );
    const combined = diverseDiscoveryOrder([
      ...products.map((product) => ({
        sortDate: product.updatedAt,
        score: signalScore(productSignals, "productId", product.id),
        businessId: product.businessId,
        value: productCard(product, savedProductIds.has(product.id)),
      })),
      ...showcases.map((showcase) => ({
        sortDate: showcase.publishedAt ?? showcase.updatedAt,
        score: signalScore(showcaseSignals, "showcaseId", showcase.id),
        businessId: showcase.businessId,
        value: showcaseCard(showcase, savedShowcaseIds.has(showcase.id)),
      })),
    ], preference?.preferences, personalSignals);
    const total = productCount + showcaseCount;
    const items = combined.slice(start, start + query.pageSize).map((entry) => ({
      ...entry.value,
      impressionToken: this.discoveryToken(
        entry.value.kind,
        entry.value.id,
        customerAccountId,
        visitorHash,
      ),
    }));
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
      categories: personalizedCategories,
      hasMore: start + query.pageSize < total,
      items,
      shops: orderDiscoveryShops(shops, preference?.preferences, personalSignals)
        .slice(0, 12)
        .map((shop) => ({
          ...shopCard(shop),
          impressionToken: this.discoveryToken(
            "shop",
            shop.id,
            customerAccountId,
            visitorHash,
          ),
        })),
      page,
      pageSize: query.pageSize,
      nextCursor: start + query.pageSize < total ? encodeDiscoveryCursor(start + query.pageSize) : null,
      appliedFilters: visibleFilters(query, plan.filters),
      expandedTerms: plan.expandedTerms,
      queryMode: normalized ? plan.mode : "standard",
      fallback: normalized ? plan.mode === "fallback" : false,
      personalized: Boolean(recommendationIdentity),
      total,
    };
  }

  private globalDiscoveryData() {
    const now = Date.now();
    if (this.globalDiscoveryCache && this.globalDiscoveryCache.expiresAt > now) {
      return Promise.resolve(this.globalDiscoveryCache.value);
    }
    if (this.globalDiscoveryRequest) return this.globalDiscoveryRequest;

    const since = new Date(now - 30 * 24 * 60 * 60 * 1000);
    this.globalDiscoveryRequest = Promise.all([
      this.prisma.product.findMany({
        where: {
          ...discoverableProductWhere,
          category: { not: null },
          business: { storeStatus: "OPEN", platformStatus: "ACTIVE" },
        },
        distinct: ["category"],
        select: { category: true },
        orderBy: { category: "asc" },
        take: 24,
      }),
      this.prisma.commerceEvent.groupBy({
        by: ["productId", "type"],
        where: { productId: { not: null }, createdAt: { gte: since } },
        _count: true,
      }),
      this.prisma.commerceEvent.groupBy({
        by: ["showcaseId", "type"],
        where: { showcaseId: { not: null }, createdAt: { gte: since } },
        _count: true,
      }),
    ]).then(([categories, productSignals, showcaseSignals]) => ({
      categories,
      productSignals,
      showcaseSignals,
    })).then((value) => {
      this.globalDiscoveryCache = { expiresAt: Date.now() + 30_000, value };
      return value;
    }).finally(() => {
      this.globalDiscoveryRequest = null;
    });

    return this.globalDiscoveryRequest;
  }

  parseQuery(query: string) {
    return this.intelligence.parseDiscoveryQuery(query);
  }

  async sitemapEntries() {
    const [shops, products] = await Promise.all([
      this.prisma.business.findMany({
        where: {
          isDemo: false,
          platformStatus: "ACTIVE",
          storeStatus: "OPEN",
          products: { some: discoverableProductWhere },
        },
        orderBy: { updatedAt: "desc" },
        select: { slug: true, updatedAt: true },
        take: 5_000,
      }),
      this.prisma.product.findMany({
        where: {
          ...discoverableProductWhere,
          business: { isDemo: false, platformStatus: "ACTIVE", storeStatus: "OPEN" },
        },
        orderBy: { updatedAt: "desc" },
        select: { business: { select: { slug: true } }, slug: true, updatedAt: true },
        take: 10_000,
      }),
    ]);
    return { products, shops };
  }

  visitorHash(request: Request) {
    return hmacPrivateValue(
      `${new Date().toISOString().slice(0, 10)}:${request.ip}:${request.header("user-agent") ?? ""}`,
      this.analyticsSecret(),
    );
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
    const targetCount = [dto.businessId, dto.productId, dto.showcaseId].filter(Boolean).length;
    if (targetCount !== 1) throw new BadRequestException("Choose one shop, product, or Showcase event target");
    const targetKind = dto.productId ? "product" : dto.showcaseId ? "showcase" : "shop";
    const targetId = dto.productId ?? dto.showcaseId ?? dto.businessId!;
    const signedResult = dto.impressionToken
      ? this.verifyDiscoveryToken(
          dto.impressionToken,
          targetKind,
          targetId,
          customerAccountId,
          visitorHash,
        )
      : null;
    if (this.signedEventsRequired() && !signedResult) {
      throw new BadRequestException("A valid discovery result token is required");
    }
    const target = dto.productId
      ? await this.prisma.product.findFirst({ where: { id: dto.productId, status: "ACTIVE", visibility: "PUBLIC" }, select: { id: true, businessId: true } })
      : dto.showcaseId
        ? await this.prisma.showcase.findFirst({ where: { id: dto.showcaseId, status: "PUBLISHED" }, select: { id: true, businessId: true } })
        : await this.prisma.business.findFirst({ where: { id: dto.businessId, platformStatus: "ACTIVE", storeStatus: "OPEN" }, select: { id: true } }).then((business) => business ? { id: business.id, businessId: business.id } : null);
    if (!target) throw new NotFoundException("Discovery target not found");
    if (dto.businessId && !dto.type.startsWith("SHOP_")) throw new BadRequestException("Shop targets require a shop event");
    if (dto.productId && !dto.type.startsWith("PRODUCT_")) throw new BadRequestException("Product targets require a product event");
    if (dto.showcaseId && !dto.type.startsWith("SHOWCASE_")) throw new BadRequestException("Showcase targets require a Showcase event");
    const dedupeInput = signedResult
      ? `${signedResult.n}:${dto.type}`
      : dto.dedupeKey;
    const dedupeKey = dedupeInput
      ? hmacPrivateValue(
          `${customerAccountId ?? visitorHash}:${dedupeInput}`,
          this.analyticsSecret(),
        )
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
          metadata: {
            context: {
              filter: dto.filter,
              position: dto.position,
              query: dto.searchQuery?.trim().toLowerCase(),
              surface: dto.surface ?? "explore",
            },
            trustedResult: Boolean(signedResult),
          },
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

  private discoveryToken(
    kind: "product" | "showcase" | "shop",
    id: string,
    customerAccountId?: string,
    visitorHash?: string,
  ) {
    const audience = customerAccountId
      ? `customer:${customerAccountId}`
      : `visitor:${visitorHash ?? "unknown"}`;
    const encoded = Buffer.from(JSON.stringify({
      a: audience,
      exp: Date.now() + 30 * 60 * 1000,
      id,
      k: kind,
      n: randomBytes(12).toString("base64url"),
      v: 1,
    }), "utf8").toString("base64url");
    return `${encoded}.${hmacPrivateValue(encoded, this.analyticsSecret())}`;
  }

  private verifyDiscoveryToken(
    token: string,
    kind: "product" | "showcase" | "shop",
    id: string,
    customerAccountId?: string,
    visitorHash?: string,
  ) {
    try {
      const [encoded, signature, extra] = token.split(".");
      if (!encoded || !signature || extra) return null;
      const expected = hmacPrivateValue(encoded, this.analyticsSecret());
      const providedBuffer = Buffer.from(signature, "hex");
      const expectedBuffer = Buffer.from(expected, "hex");
      if (
        providedBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(providedBuffer, expectedBuffer)
      ) return null;
      const value = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as { a?: unknown; exp?: unknown; id?: unknown; k?: unknown; n?: unknown; v?: unknown };
      const audience = customerAccountId
        ? `customer:${customerAccountId}`
        : `visitor:${visitorHash ?? "unknown"}`;
      if (
        value.v !== 1 ||
        value.k !== kind ||
        value.id !== id ||
        value.a !== audience ||
        typeof value.n !== "string" ||
        typeof value.exp !== "number" ||
        value.exp <= Date.now()
      ) return null;
      return value as { a: string; exp: number; id: string; k: string; n: string; v: 1 };
    } catch {
      return null;
    }
  }

  private signedEventsRequired() {
    const configured = this.config.get<string>("DISCOVERY_SIGNED_EVENTS_REQUIRED");
    return configured === "true" ||
      (configured === undefined && this.config.get("NODE_ENV") === "production");
  }

  private analyticsSecret() {
    return this.config.get<string>("ANALYTICS_HMAC_SECRET") ||
      this.config.get<string>("SESSION_HASH_SECRET") ||
      "development-analytics-secret";
  }

  async publicShowcase(id: string) {
    const showcase = await this.prisma.showcase.findFirst({
      where: {
        id,
        status: "PUBLISHED",
          business: { storeStatus: "OPEN", platformStatus: "ACTIVE", isDemo: false },
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
    const contentRating = await this.validateShowcaseInput(auth.businessId, dto.assetId, mediaKind, dto.posterAssetId, dto.hotspots);
    const status = dto.status ?? "PUBLISHED";
    return this.prisma.showcase.create({
      data: {
        assetId: dto.assetId,
        posterAssetId: dto.posterAssetId,
        mediaKind,
        durationSeconds: mediaKind === "VIDEO" ? dto.durationSeconds : null,
        businessId: auth.businessId,
        contentRating,
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
    const contentRating = await this.validateShowcaseInput(
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
          contentRating,
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
        where: {
          customerAccountId,
          business: { storeStatus: { not: "CLOSED" }, platformStatus: "ACTIVE" },
        },
        include: { business: { include: discoveryBusinessInclude } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.orderRequest.findMany({
        where: {
          customerAccountId,
          business: { storeStatus: { not: "CLOSED" }, platformStatus: "ACTIVE" },
        },
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
          product: {
            status: "ACTIVE",
            visibility: "PUBLIC",
            business: { platformStatus: "ACTIVE" },
          },
        },
        include: { product: { include: discoveryProductInclude } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.savedShowcase.findMany({
        where: {
          customerAccountId,
          showcase: {
            status: "PUBLISHED",
            business: { platformStatus: "ACTIVE" },
          },
        },
        include: { showcase: { include: discoveryShowcaseInclude } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      products: products.map((item) => productCard(item.product, true)),
      showcases: showcases.map((item) => showcaseCard(item.showcase, true)),
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
      where: {
        id: businessId,
        storeStatus: { not: "CLOSED" },
        platformStatus: "ACTIVE",
      },
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
        business: {
          storeStatus: { not: "CLOSED" },
          platformStatus: "ACTIVE",
        },
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
        qualityStatus: { not: "FAIL" },
        moderationStatus: { in: ["AUTO_APPROVED", "MANUALLY_APPROVED"] },
        contentRating: { not: "PROHIBITED" },
      },
      select: { contentRating: true, durationSeconds: true, id: true },
    });
    if (!asset) throw new BadRequestException(`Showcase ${mediaKind.toLowerCase()} is invalid`);
    if (mediaKind === "VIDEO") {
      if ((asset.durationSeconds ?? 0) > 30) throw new BadRequestException("Showcase videos must be 30 seconds or shorter");
      if (!posterAssetId) throw new BadRequestException("Showcase videos require a poster image");
      const poster = await this.prisma.mediaAsset.findFirst({
        where: {
          id: posterAssetId,
          businessId,
          purpose: "SHOWCASE_POSTER",
          status: "ACTIVE",
          qualityStatus: { not: "FAIL" },
          moderationStatus: { in: ["AUTO_APPROVED", "MANUALLY_APPROVED"] },
          contentRating: { not: "PROHIBITED" },
        },
        select: { id: true },
      });
      if (!poster) throw new BadRequestException("Showcase video poster is invalid");
    }
    if (!hotspots?.length) return asset.contentRating === "SENSITIVE_18" ? "SENSITIVE_18" : "GENERAL";
    const productIds = [...new Set(hotspots.map((hotspot) => hotspot.productId))];
    const productCount = await this.prisma.product.count({
      where: { id: { in: productIds }, businessId, status: { not: "ARCHIVED" } },
    });
    if (productCount !== productIds.length) {
      throw new BadRequestException("One or more Showcase products are invalid");
    }
    const sensitiveProducts = await this.prisma.product.count({
      where: { id: { in: productIds }, businessId, contentRating: "SENSITIVE_18" },
    });
    return asset.contentRating === "SENSITIVE_18" || sensitiveProducts > 0
      ? "SENSITIVE_18"
      : "GENERAL";
  }
}

function productCard(product: DiscoveryProduct, saved = false) {
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
    launchAt: product.launchAt,
    saved,
    name: product.name,
    placement: product.placement,
    price: product.price,
    promotions: product.promotions.map((promotion) => ({
      endsAt: promotion.endsAt,
      id: promotion.id,
      name: promotion.name,
      percentage: promotion.percentage,
      promotionalPrice: promotion.promotionalPrice,
      startsAt: promotion.startsAt,
      type: promotion.type,
      variantId: promotion.variantId,
    })),
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

function showcaseCard(showcase: DiscoveryShowcase, saved = false) {
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
    saved,
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

function shopCard(business: DiscoveryBusiness, relationship?: string) {
  return {
    ...shopIdentity(business),
    category: business.category,
    description: business.description,
    location: business.location,
    ...(relationship ? { relationship } : {}),
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

type PersonalDiscoverySignal = {
  business: { category: string | null };
  product: { category: string | null } | null;
  showcase: { hotspots: Array<{ product: { category: string | null } }> } | null;
  type: string;
};

function diverseDiscoveryOrder<T extends {
  businessId: string;
  score?: number;
  sortDate: Date;
  value: unknown;
}>(items: T[], rawPreference: unknown, personalSignals: PersonalDiscoverySignal[] = []) {
  const preferences = Array.isArray(rawPreference)
    ? new Set(rawPreference.filter((value): value is string => typeof value === "string").map((value) => value.toLowerCase()))
    : new Set<string>();
  const categorySignals = discoveryCategoryScores(personalSignals);
  const ranked = [...items].sort((left, right) => {
    const leftCategory = discoveryCategory(left.value);
    const rightCategory = discoveryCategory(right.value);
    const leftPreference = leftCategory && [...preferences].some((preference) => categoryMatchesInterest(leftCategory, preference)) ? 1 : 0;
    const rightPreference = rightCategory && [...preferences].some((preference) => categoryMatchesInterest(rightCategory, preference)) ? 1 : 0;
    return rightPreference - leftPreference
      || categorySignalScore(categorySignals, rightCategory) - categorySignalScore(categorySignals, leftCategory)
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

function orderDiscoveryCategories(
  categories: string[],
  rawPreference: unknown,
  personalSignals: PersonalDiscoverySignal[],
) {
  const preferences = Array.isArray(rawPreference)
    ? rawPreference.filter((value): value is string => typeof value === "string")
    : [];
  const categorySignals = discoveryCategoryScores(personalSignals);
  return [...new Set(categories)].sort((left, right) => {
    const leftPreference = preferences.some((preference) => categoryMatchesInterest(left, preference)) ? 1 : 0;
    const rightPreference = preferences.some((preference) => categoryMatchesInterest(right, preference)) ? 1 : 0;
    return rightPreference - leftPreference
      || categorySignalScore(categorySignals, right) - categorySignalScore(categorySignals, left)
      || left.localeCompare(right);
  });
}

function orderDiscoveryShops(
  shops: DiscoveryBusiness[],
  rawPreference: unknown,
  personalSignals: PersonalDiscoverySignal[],
) {
  const preferences = Array.isArray(rawPreference)
    ? rawPreference.filter((value): value is string => typeof value === "string")
    : [];
  const categorySignals = discoveryCategoryScores(personalSignals);
  return [...shops].sort((left, right) => {
    const leftPreference = left.category && preferences.some((preference) => categoryMatchesInterest(left.category!, preference)) ? 1 : 0;
    const rightPreference = right.category && preferences.some((preference) => categoryMatchesInterest(right.category!, preference)) ? 1 : 0;
    return rightPreference - leftPreference
      || categorySignalScore(categorySignals, right.category) - categorySignalScore(categorySignals, left.category)
      || right.updatedAt.getTime() - left.updatedAt.getTime();
  });
}

function discoveryCategoryScores(events: PersonalDiscoverySignal[]) {
  const scores = new Map<string, number>();
  for (const event of events) {
    const weight = discoveryEventWeight(event.type);
    const categories = [
      event.product?.category,
      event.business.category,
      ...(event.showcase?.hotspots.map((hotspot) => hotspot.product.category) ?? []),
    ];
    for (const category of new Set(categories.filter((value): value is string => Boolean(value?.trim())))) {
      const key = normalizeInterest(category);
      scores.set(key, (scores.get(key) ?? 0) + weight);
    }
  }
  return scores;
}

function categorySignalScore(scores: Map<string, number>, category: string | null) {
  if (!category) return 0;
  const normalized = normalizeInterest(category);
  let score = scores.get(normalized) ?? 0;
  for (const [interest, value] of scores) {
    if (interest !== normalized && categoryMatchesInterest(category, interest)) score = Math.max(score, value * 0.7);
  }
  return score;
}

function categoryMatchesInterest(category: string, interest: string) {
  const categoryTokens = interestTokens(category);
  const interestTokensSet = interestTokens(interest);
  if (!categoryTokens.size || !interestTokensSet.size) return false;
  return [...interestTokensSet].some((token) => categoryTokens.has(token));
}

function interestTokens(value: string) {
  return new Set(normalizeInterest(value)
    .split(" ")
    .map((token) => token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token)
    .filter((token) => token.length > 2));
}

function normalizeInterest(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function discoveryEventWeight(type: string) {
  const weights: Record<string, number> = {
    PRODUCT_IMPRESSION: 0.15,
    SHOWCASE_IMPRESSION: 0.15,
    SHOP_IMPRESSION: 0.1,
    SHOP_VIEWED: 1,
    PRODUCT_VIEWED: 1,
    SHOWCASE_VIEWED: 1,
    PRODUCT_SHARED: 2,
    SHOWCASE_SHARED: 2,
    SHOP_FOLLOWED: 3,
    PRODUCT_SAVED: 3,
    PRODUCT_WISHLISTED: 3,
    SHOWCASE_SAVED: 3,
    REQUEST_SUBMITTED: 5,
    PURCHASE_COMPLETED: 8,
  };
  return weights[type] ?? 0;
}

function signalScore<T extends { _count: number; type: string }>(
  rows: T[],
  idKey: "productId" | "showcaseId",
  id: string,
) {
  return rows.reduce((total, row) => {
    const target = (row as T & Record<typeof idKey, string | null>)[idKey];
    return target === id ? total + row._count * discoveryEventWeight(row.type) : total;
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
