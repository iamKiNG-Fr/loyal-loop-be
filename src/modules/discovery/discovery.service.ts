import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { OwnerAuthContext } from "../../common/request-context";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateShowcaseDto,
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
};

const discoveryShowcaseInclude = {
  asset: true,
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
  constructor(private readonly prisma: PrismaService) {}

  async explore(query: ExploreDto) {
    const normalized = query.query?.trim();
    const category = query.category?.trim();
    const take = Math.min(query.page * query.pageSize + 12, 100);
    const productWhere: Prisma.ProductWhereInput = {
      status: "ACTIVE",
      visibility: "PUBLIC",
      business: { storeStatus: "OPEN" },
      ...(category && category.toLowerCase() !== "all"
        ? { category: { equals: category, mode: "insensitive" } }
        : {}),
      ...(normalized
        ? {
            OR: [
              { name: { contains: normalized, mode: "insensitive" } },
              { category: { contains: normalized, mode: "insensitive" } },
              { description: { contains: normalized, mode: "insensitive" } },
              {
                business: {
                  name: { contains: normalized, mode: "insensitive" },
                },
              },
            ],
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
      ...(normalized
        ? {
            OR: [
              { title: { contains: normalized, mode: "insensitive" } },
              { caption: { contains: normalized, mode: "insensitive" } },
              {
                business: {
                  name: { contains: normalized, mode: "insensitive" },
                },
              },
              {
                hotspots: {
                  some: {
                    product: {
                      name: { contains: normalized, mode: "insensitive" },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [products, showcases, productCount, showcaseCount, categories] =
      await this.prisma.$transaction([
        this.prisma.product.findMany({
          where: productWhere,
          include: discoveryProductInclude,
          orderBy: [{ placement: "desc" }, { updatedAt: "desc" }],
          take,
        }),
        this.prisma.showcase.findMany({
          where: showcaseWhere,
          include: discoveryShowcaseInclude,
          orderBy: [{ featured: "desc" }, { publishedAt: "desc" }, { updatedAt: "desc" }],
          take,
        }),
        this.prisma.product.count({ where: productWhere }),
        this.prisma.showcase.count({ where: showcaseWhere }),
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
      ]);

    const combined = [
      ...products.map((product) => ({
        sortDate: product.updatedAt,
        value: productCard(product),
      })),
      ...showcases.map((showcase) => ({
        sortDate: showcase.publishedAt ?? showcase.updatedAt,
        value: showcaseCard(showcase),
      })),
    ].sort((left, right) => right.sortDate.getTime() - left.sortDate.getTime());
    const start = (query.page - 1) * query.pageSize;
    const total = productCount + showcaseCount;
    return {
      categories: categories.flatMap((entry) =>
        entry.category ? [entry.category] : [],
      ),
      hasMore: start + query.pageSize < total,
      items: combined.slice(start, start + query.pageSize).map((entry) => entry.value),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
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
    await this.validateShowcaseInput(auth.businessId, dto.assetId, dto.hotspots);
    const status = dto.status ?? "PUBLISHED";
    return this.prisma.showcase.create({
      data: {
        assetId: dto.assetId,
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
    hotspots?: Array<{ productId: string; x: number; y: number }>,
  ) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        businessId,
        purpose: "SHOWCASE_IMAGE",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!asset) throw new BadRequestException("Showcase image is invalid");
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
    kind: "product" as const,
    name: product.name,
    placement: product.placement,
    price: product.price,
    slug: product.slug,
    stockCount: product.stockCount,
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
