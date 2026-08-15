import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { paginated } from "../../common/api-response";
import { slugify } from "../../common/crypto.util";
import type { OwnerAuthContext } from "../../common/request-context";
import { ActivityService } from "../activity/activity.service";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import { discoverySource } from "../shops/discovery-attribution";
import { CreateBusinessCategoryDto } from "./dto/category.dto";
import {
  CreateProductDto,
  ProductListDto,
  ReplaceProductImagesDto,
  ReplaceProductMediaDto,
  UpdateProductDto,
} from "./dto/product.dto";

const productInclude = {
  _count: { select: { commerceEvents: true, interests: true, requestItems: true, saleItems: true, wishlistItems: true } },
  businessCategory: true,
  images: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const },
  },
  media: {
    include: { asset: true, posterAsset: true },
    orderBy: { sortOrder: "asc" as const },
  },
  variants: { orderBy: { sortOrder: "asc" as const } },
  promotions: { include: { _count: { select: { reservations: true } } }, orderBy: { createdAt: "desc" as const } },
};

const publicAssetReviewFields = {
  contentRating: true,
  moderationStatus: true,
  qualityStatus: true,
  status: true,
} as const;

const categoryTemplates = [
  { key: "fashion", label: "Fashion", attributes: ["size", "color", "material", "measurements"] },
  { key: "beauty", label: "Beauty & fragrance", attributes: ["shade", "size", "ingredients"] },
  { key: "electronics", label: "Electronics", attributes: ["model", "capacity", "color"] },
  { key: "home", label: "Home", attributes: ["material", "dimensions", "color"] },
  { key: "generic", label: "General", attributes: [] },
];

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async categories(auth: OwnerAuthContext) {
    const items = await this.prisma.businessCategory.findMany({
      where: { businessId: auth.businessId },
      orderBy: [{ name: "asc" }],
      include: { _count: { select: { products: true } } },
    });
    return { items, templates: categoryTemplates };
  }

  async analytics(auth: OwnerAuthContext, id: string, days = 30) {
    const product = await this.prisma.product.findFirst({
      where: { id, businessId: auth.businessId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException("Product not found");

    const safeDays = [7, 30, 90].includes(days) ? days : 30;
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - safeDays + 1);
    const events = await this.prisma.commerceEvent.findMany({
      where: {
        businessId: auth.businessId,
        createdAt: { gte: since },
        OR: [
          { productId: id, type: { in: ["PRODUCT_IMPRESSION", "PRODUCT_VIEWED", "PRODUCT_SAVED", "PRODUCT_SHARED", "PURCHASE_COMPLETED"] } },
          { type: "SHOP_VIEWED" },
        ],
      },
      select: { createdAt: true, id: true, metadata: true, productId: true, sessionKey: true, type: true },
      orderBy: { createdAt: "asc" },
    });

    const series = new Map<string, { date: string; productImpressions: number; productOpens: number; productViews: number; searchAppearances: number; shares: number; shopViews: number }>();
    for (let offset = 0; offset < safeDays; offset += 1) {
      const date = new Date(since);
      date.setUTCDate(since.getUTCDate() + offset);
      const key = date.toISOString().slice(0, 10);
      series.set(key, { date: key, productImpressions: 0, productOpens: 0, productViews: 0, searchAppearances: 0, shares: 0, shopViews: 0 });
    }
    const sourceCounts = new Map<string, number>();
    const searchSessions = new Set<string>();
    const searchTermSessions = new Map<string, Set<string>>();
    let saves = 0;
    let purchases = 0;
    let searchOpens = 0;
    for (const event of events) {
      const day = series.get(event.createdAt.toISOString().slice(0, 10));
      if (!day) continue;
      if (event.type === "SHOP_VIEWED") day.shopViews += 1;
      if (event.productId === id && event.type === "PRODUCT_IMPRESSION") {
        day.productImpressions += 1;
        const context = commerceEventContext(event.metadata);
        if (context.surface === "explore_search") {
          day.searchAppearances += 1;
          const searchSession = `${event.sessionKey || event.id}:${context.query || "unknown"}`;
          searchSessions.add(searchSession);
          if (context.query) {
            const sessions = searchTermSessions.get(context.query) ?? new Set<string>();
            sessions.add(searchSession);
            searchTermSessions.set(context.query, sessions);
          }
        }
      }
      if (event.productId === id && event.type === "PRODUCT_VIEWED") {
        day.productViews += 1;
        if (commerceEventContext(event.metadata).surface?.startsWith("explore")) day.productOpens += 1;
      }
      if (event.productId === id && event.type === "PRODUCT_SHARED") day.shares += 1;
      if (event.productId === id && event.type === "PRODUCT_SAVED") saves += 1;
      if (event.productId === id && event.type === "PURCHASE_COMPLETED") purchases += 1;
      if (event.productId === id && event.type === "PRODUCT_VIEWED" && commerceEventContext(event.metadata).surface === "explore_search") searchOpens += 1;
      if (event.productId === id && ["PRODUCT_VIEWED", "PRODUCT_SHARED"].includes(event.type)) {
        const source = discoverySource(event.metadata);
        if (source) sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
      }
    }

    const values = [...series.values()];
    const impressions = values.reduce((total, day) => total + day.productImpressions, 0);
    const productClicks = values.reduce((total, day) => total + day.productViews, 0);
    const productOpens = values.reduce((total, day) => total + day.productOpens, 0);
    const searchAppearances = values.reduce((total, day) => total + day.searchAppearances, 0);
    return {
      days: safeDays,
      impressions,
      openRate: percentage(productOpens, impressions),
      productClicks,
      productOpens,
      purchases,
      saves,
      searchAppearances,
      searchOpenRate: percentage(searchOpens, searchAppearances),
      searchOpens,
      searchReportingReady: searchAppearances >= 5,
      searches: searchSessions.size,
      shares: values.reduce((total, day) => total + day.shares, 0),
      shopVisits: values.reduce((total, day) => total + day.shopViews, 0),
      sourceBreakdown: [...sourceCounts.entries()]
        .map(([source, count]) => ({ source, count }))
        .sort((left, right) => right.count - left.count || left.source.localeCompare(right.source)),
      topSearchTerms: [...searchTermSessions.entries()]
        .filter(([, sessions]) => sessions.size >= 5)
        .map(([term, sessions]) => ({ appearances: sessions.size, term }))
        .sort((left, right) => right.appearances - left.appearances || left.term.localeCompare(right.term))
        .slice(0, 5),
      series: values,
    };
  }

  async createCategory(
    auth: OwnerAuthContext,
    dto: CreateBusinessCategoryDto,
  ) {
    const name = dto.name.trim();
    if (!name || name.toLowerCase() === "__new") {
      throw new BadRequestException("Enter a real category name");
    }
    const existing = await this.prisma.businessCategory.findFirst({
      where: { businessId: auth.businessId, name: { equals: name, mode: "insensitive" } },
    });
    if (existing) return existing;
    try {
      return await this.prisma.businessCategory.create({
        data: {
          businessId: auth.businessId,
          name,
          slug: await this.uniqueCategorySlug(auth.businessId, name),
          templateKey: dto.templateKey ?? "generic",
          attributes: dto.attributes as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("That category already exists");
      }
      throw error;
    }
  }

  async list(auth: OwnerAuthContext, query: ProductListDto) {
    const where = {
      businessId: auth.businessId,
      status: query.status,
      ...(query.query
        ? {
            OR: [
              { name: { contains: query.query, mode: "insensitive" as const } },
              {
                category: {
                  contains: query.query,
                  mode: "insensitive" as const,
                },
              },
              { attributes: { path: ["searchTags"], string_contains: query.query.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginated(items.map(withListingReadiness), total, query.page, query.pageSize);
  }

  async get(auth: OwnerAuthContext, id: string) {
    const product = await this.prisma.product.findFirstOrThrow({
      where: { id, businessId: auth.businessId },
      include: productInclude,
    });
    return withListingReadiness(product);
  }

  async create(auth: OwnerAuthContext, dto: CreateProductDto) {
    this.validateVariantStock(dto.stockCount, dto.variants);
    const assets = await this.validateAssets(
      auth.businessId,
      dto.imageAssetIds ?? [],
    );
    const collection = await this.resolveCategory(auth, dto.categoryId);
    const media = dto.media?.length
      ? await this.validateMedia(auth.businessId, dto.media)
      : assets.map((asset, index) => ({
          asset,
          posterAsset: null,
          kind: "IMAGE" as const,
          altText: undefined,
          sortOrder: index,
          isPrimary: index === 0,
        }));
    const variants = dto.variants?.length
      ? dto.variants
      : [{ name: "Default", optionValues: {}, stockCount: dto.stockCount }];
    const moderationHold = [...assets, ...media.flatMap((item) => [item.asset, item.posterAsset].filter(Boolean))]
      .some(asset => mediaAssetNeedsReview(asset));
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          businessId: auth.businessId,
          slug: await this.uniqueSlug(auth.businessId, dto.name),
          name: dto.name.trim(),
          description: dto.description?.trim(),
          price: dto.price,
          currency: dto.currency?.toUpperCase() ?? "NGN",
          category: dto.category?.trim(),
          categoryId: collection?.id,
          attributes: dto.attributes as Prisma.InputJsonValue | undefined,
          status: moderationHold ? "DRAFT" : dto.status,
          placement: dto.placement,
          visibility: moderationHold ? "PRIVATE" : dto.visibility,
          contentRating: dto.contentRating,
          stockCount: dto.stockCount,
          launchAt: dto.launchAt ? new Date(dto.launchAt) : undefined,
          images: assets.length
            ? {
                create: assets.map((asset, index) => ({
                  assetId: asset.id,
                  sortOrder: index,
                  isPrimary: index === 0,
                })),
              }
            : undefined,
          media: media.length
            ? {
                create: media.map((item) => ({
                  assetId: item.asset.id,
                  posterAssetId: item.posterAsset?.id,
                  kind: item.kind,
                  altText: item.altText,
                  sortOrder: item.sortOrder,
                  isPrimary: item.isPrimary,
                  durationSeconds: item.asset.durationSeconds,
                })),
              }
            : undefined,
          variants: {
            create: variants.map((variant, index) => ({
              name: variant.name?.trim() || this.variantName(variant.optionValues),
              optionValues: variant.optionValues as Prisma.InputJsonValue,
              priceOverride: variant.priceOverride,
              sku: variant.sku?.trim(),
              active: variant.active ?? true,
              stockCount: variant.stockCount,
              sortOrder: index,
            })),
          },
        },
        include: productInclude,
      });
      await this.activity.record(
        {
          businessId: auth.businessId,
          actorId: auth.userId,
          type: "PRODUCT_ADDED",
          title: `Added ${product.name}`,
          metadata: { productId: product.id },
        },
        tx,
      );
      return withListingReadiness(product);
    });
  }

  async update(
    auth: OwnerAuthContext,
    productId: string,
    dto: UpdateProductDto,
  ) {
    const product = await this.assertOwned(auth.businessId, productId);
    if (dto.variants || dto.stockCount !== undefined) {
      this.validateVariantStock(dto.stockCount ?? product.stockCount, dto.variants ?? product.variants);
    }
    const hasCollectionUpdate = dto.categoryId !== undefined;
    const collection = hasCollectionUpdate
      ? await this.resolveCategory(auth, dto.categoryId)
      : undefined;
    const nextStatus = dto.status ?? product.status;
    const nextVisibility = dto.visibility ?? product.visibility;
    if (nextStatus === "ACTIVE" && nextVisibility === "PUBLIC") {
      await this.assertProductMediaReadyForPublic(auth.businessId, product.id);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: product.id },
        data: {
          name: dto.name?.trim(),
          slug: dto.name
            ? await this.uniqueSlug(auth.businessId, dto.name, product.id)
            : undefined,
          description: dto.description?.trim(),
          price: dto.price,
          category: dto.category === undefined ? undefined : dto.category.trim() || null,
          categoryId: hasCollectionUpdate ? collection?.id ?? null : undefined,
          attributes: dto.attributes as Prisma.InputJsonValue | undefined,
          status: dto.status,
          placement: dto.placement,
          visibility: dto.visibility,
          contentRating: dto.contentRating,
          stockCount: dto.stockCount,
          launchAt: dto.launchAt === null ? null : dto.launchAt ? new Date(dto.launchAt) : undefined,
          variants: dto.variants
            ? {
                deleteMany: {},
                create: dto.variants.map((variant, index) => ({
                  name: variant.name?.trim() || this.variantName(variant.optionValues),
                  optionValues: variant.optionValues as Prisma.InputJsonValue,
                  priceOverride: variant.priceOverride,
                  sku: variant.sku?.trim(),
                  active: variant.active ?? true,
                  stockCount: variant.stockCount,
                  sortOrder: index,
                })),
              }
            : undefined,
        },
        include: productInclude,
      });
      await this.activity.record(
        {
          businessId: auth.businessId,
          actorId: auth.userId,
          type: "PRODUCT_UPDATED",
          title: `Updated ${updated.name}`,
          metadata: { productId: updated.id },
          awardTrust: false,
        },
        tx,
      );
      return withListingReadiness(updated);
    });
  }

  async replaceImages(
    auth: OwnerAuthContext,
    productId: string,
    dto: ReplaceProductImagesDto,
  ) {
    await this.assertOwned(auth.businessId, productId);
    const assets = await this.validateAssets(auth.businessId, dto.assetIds);
    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.deleteMany({ where: { productId } });
      await tx.productMedia.deleteMany({ where: { productId, kind: "IMAGE" } });
      if (assets.length) {
        await tx.productImage.createMany({
          data: assets.map((asset, index) => ({
            productId,
            assetId: asset.id,
            sortOrder: index,
            isPrimary: index === 0,
          })),
        });
        await tx.productMedia.createMany({
          data: assets.map((asset, index) => ({
            productId,
            assetId: asset.id,
            kind: "IMAGE",
            sortOrder: index,
            isPrimary: index === 0,
          })),
        });
      }
      if (assets.some(asset => mediaAssetNeedsReview(asset))) {
        await tx.product.update({ where: { id: productId }, data: { status: "DRAFT", visibility: "PRIVATE" } });
      }
    });
    return this.get(auth, productId);
  }

  async replaceMedia(
    auth: OwnerAuthContext,
    productId: string,
    dto: ReplaceProductMediaDto,
  ) {
    await this.assertOwned(auth.businessId, productId);
    const media = await this.validateMedia(auth.businessId, dto.media);
    await this.prisma.$transaction(async (tx) => {
      await tx.productMedia.deleteMany({ where: { productId } });
      await tx.productImage.deleteMany({ where: { productId } });
      if (media.length) {
        await tx.productMedia.createMany({
          data: media.map((item) => ({
            productId,
            assetId: item.asset.id,
            posterAssetId: item.posterAsset?.id,
            kind: item.kind,
            altText: item.altText,
            sortOrder: item.sortOrder,
            isPrimary: item.isPrimary,
            durationSeconds: item.asset.durationSeconds,
          })),
        });
        const images = media.filter((item) => item.kind === "IMAGE");
        if (images.length) {
          await tx.productImage.createMany({
            data: images.map((item, index) => ({
              productId,
              assetId: item.asset.id,
              altText: item.altText,
              sortOrder: item.sortOrder,
              isPrimary: index === 0,
            })),
          });
        }
      }
      if (media.some(item => mediaAssetNeedsReview(item.asset) || mediaAssetNeedsReview(item.posterAsset))) {
        await tx.product.update({ where: { id: productId }, data: { status: "DRAFT", visibility: "PRIVATE" } });
      }
    });
    return this.get(auth, productId);
  }

  async archive(auth: OwnerAuthContext, productId: string) {
    await this.assertOwned(auth.businessId, productId);
    return this.prisma.product.update({
      where: { id: productId },
      data: { status: "ARCHIVED", visibility: "PRIVATE" },
    });
  }

  private async assertOwned(businessId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, businessId },
      include: { variants: true },
    });
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  private async assertProductMediaReadyForPublic(businessId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { businessId, id: productId },
      select: {
        images: { select: { asset: { select: publicAssetReviewFields } } },
        media: {
          select: {
            asset: { select: publicAssetReviewFields },
            posterAsset: { select: publicAssetReviewFields },
          },
        },
      },
    });
    if (!product) throw new NotFoundException("Product not found");
    const assets = [
      ...product.images.map(item => item.asset),
      ...product.media.flatMap(item => [item.asset, item.posterAsset].filter(Boolean)),
    ];
    if (!assets.length || assets.some(asset => !mediaAssetCanPublish(asset))) {
      throw new BadRequestException("Product media must pass safety review before this listing can be published");
    }
  }

  private validateVariantStock(
    productStock: number | null | undefined,
    variants?: Array<{ stockCount?: number | null }>,
  ) {
    if (productStock === null || productStock === undefined || !variants?.length) return;
    const assignedStock = variants.reduce((total, variant) => total + (variant.stockCount ?? 0), 0);
    if (assignedStock > productStock) {
      throw new BadRequestException(
        `Option stock totals ${assignedStock}, which exceeds Product inventory of ${productStock}`,
      );
    }
  }

  private async validateAssets(businessId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        id: { in: uniqueIds },
        businessId,
        purpose: "PRODUCT_IMAGE",
        status: "ACTIVE",
        qualityStatus: { not: "FAIL" },
        moderationStatus: { not: "REJECTED" },
        contentRating: { not: "PROHIBITED" },
      },
    });
    if (assets.length !== uniqueIds.length) {
      throw new BadRequestException("One or more product images are invalid");
    }
    return uniqueIds.map((id) => assets.find((asset) => asset.id === id)!);
  }

  private async resolveCategory(
    auth: OwnerAuthContext,
    categoryId?: string | null,
  ) {
    if (categoryId) {
      const category = await this.prisma.businessCategory.findFirst({
        where: { id: categoryId, businessId: auth.businessId },
      });
      if (!category) throw new BadRequestException("Collection is not available for this business");
      return category;
    }
    return null;
  }

  private async validateMedia(
    businessId: string,
    input: ReplaceProductMediaDto["media"],
  ) {
    const ids = [
      ...new Set(input.flatMap((item) => [item.assetId, item.posterAssetId].filter(Boolean) as string[])),
    ];
    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        id: { in: ids },
        businessId,
        status: "ACTIVE",
        qualityStatus: { not: "FAIL" },
        moderationStatus: { not: "REJECTED" },
        contentRating: { not: "PROHIBITED" },
      },
    });
    if (assets.length !== ids.length) {
      throw new BadRequestException("One or more product media assets are invalid");
    }
    return input.map((item, index) => {
      const asset = assets.find((entry) => entry.id === item.assetId)!;
      const posterAsset = item.posterAssetId
        ? assets.find((entry) => entry.id === item.posterAssetId) ?? null
        : null;
      if (item.kind === "VIDEO") {
        if (asset.purpose !== "PRODUCT_VIDEO" || asset.resourceType !== "video") {
          throw new BadRequestException("Video media must use a verified product-video asset");
        }
        if ((asset.durationSeconds ?? 0) > 30 || asset.bytes > 50 * 1024 * 1024) {
          throw new BadRequestException("Product videos must be 30 seconds or less and no larger than 50 MB");
        }
        if (!posterAsset || posterAsset.purpose !== "PRODUCT_POSTER" || posterAsset.resourceType !== "image") {
          throw new BadRequestException("Product videos require a verified poster image");
        }
      } else if (asset.purpose !== "PRODUCT_IMAGE" || asset.resourceType !== "image") {
        throw new BadRequestException("Image media must use a verified product-image asset");
      }
      return {
        asset,
        posterAsset,
        kind: item.kind,
        altText: item.altText?.trim(),
        sortOrder: index,
        isPrimary: index === 0,
      };
    });
  }

  private variantName(optionValues: Record<string, string>) {
    const value = Object.values(optionValues).map((item) => item.trim()).filter(Boolean).join(" / ");
    return value || "Default";
  }

  private async uniqueCategorySlug(businessId: string, name: string) {
    const base = slugify(name) || "category";
    let candidate = base;
    let suffix = 2;
    while (await this.prisma.businessCategory.findFirst({
      where: { businessId, slug: candidate },
      select: { id: true },
    })) {
      candidate = `${base}-${suffix++}`;
    }
    return candidate;
  }

  private async uniqueSlug(
    businessId: string,
    name: string,
    excludeId?: string,
  ) {
    const base = slugify(name) || "product";
    let candidate = base;
    let suffix = 2;
    while (
      await this.prisma.product.findFirst({
        where: { businessId, slug: candidate, id: excludeId ? { not: excludeId } : undefined },
        select: { id: true },
      })
    ) {
      candidate = `${base}-${suffix++}`;
    }
    return candidate;
  }
}

function commerceEventContext(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {} as { query?: string; surface?: string };
  const context = (metadata as Record<string, unknown>).context;
  if (!context || typeof context !== "object" || Array.isArray(context)) return {} as { query?: string; surface?: string };
  const values = context as Record<string, unknown>;
  return {
    query: typeof values.query === "string" ? values.query : undefined,
    surface: typeof values.surface === "string" ? values.surface : undefined,
  };
}

function percentage(value: number, total: number) {
  return total ? Math.round(value / total * 1000) / 10 : 0;
}

function mediaAssetNeedsReview(asset?: { contentRating: string; moderationStatus: string } | null) {
  if (!asset) return false;
  return !["AUTO_APPROVED", "MANUALLY_APPROVED"].includes(asset.moderationStatus)
    || asset.contentRating !== "GENERAL";
}

export function mediaAssetCanPublish(asset?: {
  contentRating: string;
  moderationStatus: string;
  qualityStatus: string;
  status: string;
} | null) {
  return Boolean(asset
    && asset.status === "ACTIVE"
    && asset.qualityStatus !== "FAIL"
    && ["AUTO_APPROVED", "MANUALLY_APPROVED"].includes(asset.moderationStatus)
    && asset.contentRating === "GENERAL");
}

function withListingReadiness<T extends {
  category: string | null;
  description: string | null;
  images: Array<{ asset: { qualityStatus: string; moderationStatus: string } }>;
  media: Array<{ altText: string | null; asset: { qualityStatus: string; moderationStatus: string } }>;
  price: unknown;
  stockCount: number | null;
  variants: Array<{ active: boolean; stockCount: number | null }>;
}>(product: T) {
  const mediaCount = Math.max(product.images.length, product.media.length);
  const descriptionLength = product.description?.trim().length ?? 0;
  const checks = [
    { key: "primary_media", label: "Clear primary media", passed: mediaCount > 0, weight: 30 },
    { key: "supporting_media", label: "At least two useful views", passed: mediaCount >= 2, weight: 10 },
    { key: "description", label: "Informative description", passed: descriptionLength >= 80, weight: 20 },
    { key: "category", label: "Category selected", passed: Boolean(product.category), weight: 10 },
    { key: "price", label: "Price set", passed: Number(product.price) > 0, weight: 10 },
    {
      key: "availability",
      label: "Availability is clear",
      passed: product.stockCount !== null || product.variants.some(item => item.active && item.stockCount !== null),
      weight: 10,
    },
    {
      key: "alt_text",
      label: "Media is described",
      passed: product.media.length === 0 || product.media.every(item => Boolean(item.altText?.trim())),
      weight: 10,
    },
  ];
  const score = checks.reduce((total, check) => total + (check.passed ? check.weight : 0), 0);
  return {
    ...product,
    listingReadiness: {
      score,
      status: score >= 80 ? "READY" : score >= 50 ? "NEEDS_WORK" : "INCOMPLETE",
      checks,
    },
  };
}
