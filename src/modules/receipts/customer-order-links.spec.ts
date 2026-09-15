import { describe, expect, it, vi } from 'vitest';
import { ReceiptsService } from './receipts.service';
import { DeliveryService } from '../delivery/delivery.service';

describe('private customer order and receipt navigation', () => {
  it('creates a journey link only after resolving the account-bound receipt token', async () => {
    const prisma = { receipt: { findFirst: vi.fn().mockResolvedValue({ id: 'receipt', status: 'CREATED', sale: { delivery: { id: 'delivery' } } }) }, deliveryShareToken: { create: vi.fn() } };
    const service = new ReceiptsService(prisma as never, {} as never, {} as never);
    const result = await service.createCustomerOrderLink('account', 'private-token');
    expect(result.token).toEqual(expect.any(String));
    expect(prisma.receipt.findFirst.mock.calls[0][0].where).toMatchObject({ tokenHash: expect.any(String), OR: [{ customer: { accountId: 'account' } }, { sale: { sourceRequest: { customerAccountId: 'account' } } }] });
    expect(prisma.deliveryShareToken.create).toHaveBeenCalledWith({ data: { deliveryId: 'delivery', tokenHash: expect.any(String) } });
    expect(prisma.deliveryShareToken.create.mock.calls[0][0].data.tokenHash).not.toBe(result.token);
  });
  it('does not create a journey link for an unowned or revoked receipt token', async () => {
    const prisma = { receipt: { findFirst: vi.fn().mockResolvedValue(null) }, receiptShareToken: { findFirst: vi.fn().mockResolvedValue(null) }, deliveryShareToken: { create: vi.fn() } };
    const service = new ReceiptsService(prisma as never, {} as never, {} as never);
    await expect(service.createCustomerOrderLink('other-account', 'private-token')).rejects.toThrow(/not found/);
    expect(prisma.receiptShareToken.findFirst.mock.calls[0][0].where).toMatchObject({ revokedAt: null, receipt: { OR: [{ customer: { accountId: 'other-account' } }, { sale: { sourceRequest: { customerAccountId: 'other-account' } } }] } });
    expect(prisma.deliveryShareToken.create).not.toHaveBeenCalled();
  });
  it('links only the receipt belonging to the authenticated delivery journey', async () => {
    const prisma = { delivery: { findFirst: vi.fn().mockResolvedValue({ id: 'delivery', saleId: 'sale' }) }, receipt: { findFirst: vi.fn().mockResolvedValue({ id: 'receipt' }) }, receiptShareToken: { create: vi.fn() } };
    const service = new DeliveryService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await service.createCustomerReceiptLink('account', 'private-token');
    expect(prisma.delivery.findFirst.mock.calls[0][0].where).toMatchObject({ OR: [{ customer: { accountId: 'account' } }, { sale: { sourceRequest: { customerAccountId: 'account' } } }] });
    expect(prisma.receipt.findFirst.mock.calls[0][0].where).toMatchObject({ saleId: 'sale', status: { not: 'VOID' } });
    expect(prisma.receiptShareToken.create).toHaveBeenCalledWith({ data: { receiptId: 'receipt', tokenHash: expect.any(String) } });
  });
  it('does not mint a link to a void or unavailable receipt', async () => {
    const prisma = { delivery: { findFirst: vi.fn().mockResolvedValue({ id: 'delivery', saleId: 'sale' }) }, receipt: { findFirst: vi.fn().mockResolvedValue(null) }, receiptShareToken: { create: vi.fn() } };
    const service = new DeliveryService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.createCustomerReceiptLink('account', 'private-token')).rejects.toThrow(/not available/);
    expect(prisma.receiptShareToken.create).not.toHaveBeenCalled();
  });
});
