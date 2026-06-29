import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { paginated } from "../../common/api-response";
import { slugify } from "../../common/crypto.util";
import type { OwnerAuthContext } from "../../common/request-context";
import { ActivityService } from "../activity/activity.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateProductDto,
  ProductListDto,
  ReplaceProductImagesDto,
  UpdateProductDto,
} from "./dto/product.dto";

const productInclude = {
  images: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const },
  },
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

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
    return paginated(items, total, query.page, query.pageSize);
  }

  get(auth: OwnerAuthContext, id: string) {
    return this.prisma.product.findFirstOrThrow({
      where: { id, businessId: auth.businessId },
      include: productInclude,
    });
  }

  async create(auth: OwnerAuthContext, dto: CreateProductDto) {
    const assets = await this.validateAssets(
      auth.businessId,
      dto.imageAssetIds ?? [],
    );
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
          status: dto.status,
          placement: dto.placement,
          visibility: dto.visibility,
          stockCount: dto.stockCount,
          images: assets.length
            ? {
                create: assets.map((asset, index) => ({
                  assetId: asset.id,
                  sortOrder: index,
                  isPrimary: index === 0,
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
          type: "PRODUCT_ADDED",
          title: `Added ${product.name}`,
          metadata: { productId: product.id },
        },
        tx,
      );
      return product;
    });
  }

  async update(
    auth: OwnerAuthContext,
    productId: string,
    dto: UpdateProductDto,
  ) {
    const product = await this.assertOwned(auth.businessId, productId);
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
          category: dto.category?.trim(),
          status: dto.status,
          placement: dto.placement,
          visibility: dto.visibility,
          stockCount: dto.stockCount,
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
      return updated;
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
      if (assets.length) {
        await tx.productImage.createMany({
          data: assets.map((asset, index) => ({
            productId,
            assetId: asset.id,
            sortOrder: index,
            isPrimary: index === 0,
          })),
        });
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
    });
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  private async validateAssets(businessId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        id: { in: uniqueIds },
        businessId,
        purpose: "PRODUCT_IMAGE",
        status: "ACTIVE",
      },
    });
    if (assets.length !== uniqueIds.length) {
      throw new BadRequestException("One or more product images are invalid");
    }
    return uniqueIds.map((id) => assets.find((asset) => asset.id === id)!);
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
