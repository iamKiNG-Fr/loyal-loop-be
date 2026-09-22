import { describe, expect, it, vi } from 'vitest';
import { publicMediaAssetWhere } from '../media/public-media';
import { OG_THUMBNAIL_TRANSFORM, publicOgThumbnailUrl } from '../media/og-thumbnail';
import { ShopsService } from './shops.service';

describe('bounded public product previews', () => {
  it('loads the exact product beyond the catalog first page without recording a view', async () => {
    const product = { id: 'product-101', images: [{ asset: { secureUrl: 'https://res.cloudinary.com/shop/image/upload/v1/cover.jpg' } }], business: { name: 'Shop', slug: 'shop' } };
    const prisma = { product: { findFirst: vi.fn().mockResolvedValue(product) }, commerceEvent: { create: vi.fn() } };
    const businesses = { resolveShopSlug: vi.fn().mockResolvedValue({ id: 'shop' }), reconcileScheduledLaunch: vi.fn() };
    const service = new ShopsService(prisma as never, {} as never, {} as never, {} as never, {} as never, businesses as never, {} as never, {} as never);
    const result = await service.getPublicProductPreview('shop', 'product-101');
    expect(result.thumbnailUrl).toBe(`https://res.cloudinary.com/shop/image/upload/${OG_THUMBNAIL_TRANSFORM}/v1/cover.jpg`);
    const query = prisma.product.findFirst.mock.calls[0][0];
    expect(query.where).toMatchObject({ status: 'ACTIVE', visibility: 'PUBLIC', OR: [{ id: 'product-101' }, { slug: 'product-101' }, { name: { equals: 'product-101', mode: 'insensitive' } }], business: { id: 'shop', platformStatus: 'ACTIVE', storeStatus: { in: ['OPEN', 'PAUSED'] } } });
    expect(query.select.images).toMatchObject({ take: 1, where: { asset: { is: publicMediaAssetWhere } } });
    expect(query.select).not.toHaveProperty('saleItems');
    expect(prisma.commerceEvent.create).not.toHaveBeenCalled();
  });

  it('does not return metadata for unavailable or private products', async () => {
    const service = new ShopsService({ product: { findFirst: vi.fn().mockResolvedValue(null) } } as never, {} as never, {} as never, {} as never, {} as never, { resolveShopSlug: vi.fn().mockResolvedValue({ id: 'shop' }), reconcileScheduledLaunch: vi.fn() } as never, {} as never, {} as never);
    await expect(service.getPublicProductPreview('shop', 'private')).rejects.toThrow('Product not found');
  });

  it('uses a stable public cover/poster derivative without converting private delivery', () => {
    for (const asset of ['v2/poster.png', 'cover.png']) {
      const thumbnail = publicOgThumbnailUrl(`https://res.cloudinary.com/shop/image/upload/${asset}`);
      expect(publicOgThumbnailUrl(thumbnail)).toBe(thumbnail);
      expect(thumbnail).toContain(OG_THUMBNAIL_TRANSFORM);
    }
    const privateUrl = 'https://res.cloudinary.com/shop/image/authenticated/v2/proof.jpg';
    expect(publicOgThumbnailUrl(privateUrl)).toBe(privateUrl);
  });
});
