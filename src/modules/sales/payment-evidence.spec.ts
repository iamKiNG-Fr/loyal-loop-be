import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { SalesService } from './sales.service';
import { MediaService } from '../media/media.service';

const auth = { businessId: 'shop', userId: 'owner', capabilities: ['PAYMENT_REVIEW'] } as never;
const evidence = { id: 'proof', purpose: 'PAYMENT_PROOF', status: 'ACTIVE', deliveryType: 'authenticated', resourceType: 'image', format: 'png', publicId: 'private-proof', secureUrl: 'unsigned-private-url' };
function harness(paid = '100') {
  const sale = { id: 'sale', businessId: 'shop', customerId: 'buyer', referenceCode: 'LL-1', amountPaid: new Prisma.Decimal(paid), total: new Prisma.Decimal('100'), paymentProofs: [], payments: [{ id: 'entry', type: 'REFUND', evidenceAsset: evidence }] };
  const tx = { sale: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue(sale) }, paymentEntry: { create: vi.fn() }, delivery: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
  const prisma = { sale: { findFirst: vi.fn().mockResolvedValue(sale) }, mediaAsset: { findFirst: vi.fn().mockResolvedValue(evidence) }, $transaction: vi.fn(async callback => callback(tx)) };
  const media = { protectAsset: vi.fn(asset => ({ ...asset, secureUrl: 'signed-expiring-url' })) };
  const service = new SalesService(prisma as never, { record: vi.fn() } as never, {} as never, { captureIfQualified: vi.fn() } as never, media as never);
  return { service, prisma, tx, media };
}

describe('recording payment and refund evidence', () => {
  it('requires refund evidence before any ledger mutation', async () => {
    const { service, prisma } = harness();
    await expect(service.recordPayment(auth, 'sale', { type: 'REFUND', amount: '100' })).rejects.toThrow('Attach proof');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects evidence outside the business, public images or images already used', async () => {
    const { service, prisma } = harness();
    prisma.mediaAsset.findFirst.mockResolvedValue(null as never);
    await expect(service.recordPayment(auth, 'sale', { type: 'REFUND', amount: '100', evidenceAssetId: 'foreign' })).rejects.toThrow('unused private payment image');
    expect(prisma.mediaAsset.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', businessId: 'shop', purpose: 'PAYMENT_PROOF', status: 'ACTIVE', deliveryType: 'authenticated', resourceType: 'image', paymentProof: null, paymentEvidence: null } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('records a full refund and evidence atomically, signs the image and never unlocks fulfilment', async () => {
    const { service, tx } = harness();
    const result = await service.recordPayment(auth, 'sale', { type: 'REFUND', amount: '100', evidenceAssetId: 'proof' });
    expect(tx.sale.updateMany.mock.calls[0][0].data.paymentStatus).toBe('REFUNDED');
    expect(tx.sale.updateMany.mock.calls[0][0].data.amountPaid.toString()).toBe('0');
    expect(tx.paymentEntry.create.mock.calls[0][0].data).toMatchObject({ evidenceAssetId: 'proof', saleId: 'sale', recordedById: 'owner', type: 'REFUND' });
    expect(result.payments[0].evidenceAsset?.secureUrl).toBe('signed-expiring-url');
    expect(tx.delivery.updateMany).not.toHaveBeenCalled();
  });
  it('keeps a partial refund amount distinct from the remaining recorded payment', async () => {
    const { service, tx } = harness();
    await service.recordPayment(auth, 'sale', { type: 'REFUND', amount: '40', evidenceAssetId: 'proof' });
    expect(tx.sale.updateMany.mock.calls[0][0].data.amountPaid.toString()).toBe('60');
    expect(tx.sale.updateMany.mock.calls[0][0].data.paymentStatus).toBe('PARTIAL');
  });
  it('allows a normal payment without an image and unlocks an awaiting order', async () => {
    const { service, tx } = harness('0');
    await service.recordPayment(auth, 'sale', { type: 'PAYMENT', amount: '40' });
    expect(tx.delivery.updateMany).toHaveBeenCalledWith({ where: { saleId: 'sale', status: 'AWAITING_PAYMENT' }, data: { status: 'PREPARING' } });
  });
  it('does not expose evidence to staff without payment-review permission', async () => {
    const { service, media } = harness();
    const result = await service.recordPayment({ businessId: 'shop', userId: 'staff', capabilities: [] } as never, 'sale', { type: 'REFUND', amount: '40', evidenceAssetId: 'proof' });
    expect(result.payments[0].evidenceAsset).toBeNull();
    expect(media.protectAsset).not.toHaveBeenCalled();
  });
  it('rejects an outdated balance before creating a second ledger entry', async () => {
    const { service, tx } = harness();
    tx.sale.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.recordPayment(auth, 'sale', { type: 'REFUND', amount: '40', evidenceAssetId: 'proof' })).rejects.toThrow('record changed');
    expect(tx.paymentEntry.create).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '101'])('rejects an invalid refund amount: %s', async amount => {
    const { service, prisma } = harness();
    await expect(service.recordPayment(auth, 'sale', { type: 'REFUND', amount, evidenceAssetId: 'proof' })).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('prevents deletion of an attached receipt image', async () => {
    const prisma = { mediaAsset: { findFirst: vi.fn().mockResolvedValue({ ...evidence, productImages: [], productMedia: [], productPosters: [], showcaseImages: [], showcasePosters: [], deliveryHandoffs: [], paymentEvidence: { id: 'entry' } }), update: vi.fn() } };
    const service = new MediaService(prisma as never, {} as never);
    await expect(service.remove(auth, 'proof')).rejects.toThrow('still in use');
    expect(prisma.mediaAsset.update).not.toHaveBeenCalled();
  });
});
