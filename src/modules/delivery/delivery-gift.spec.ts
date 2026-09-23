import { describe, expect, it, vi } from 'vitest';
import { DeliveryService } from './delivery.service';

describe('gift and payment journey context', () => {
  it.each([true, false])('serializes gift details only for gift orders (%s) while retaining bank instructions', async isGift => {
    const record = {
      id: 'delivery', isGift, recipientName: 'Amina', recipientPhone: '+2348033334444', giftOccasion: 'Birthday',
      status: 'AWAITING_PAYMENT', journeyMethod: 'SHOP_DELIVERY', handoffAsset: null, handoffCodeIssuedAt: null,
      business: { id: 'shop', name: 'Shop', contacts: [], logoAsset: null }, events: [], feedback: [], issues: [],
      sale: { id: 'sale', items: [], paymentProofs: [], paymentStatus: 'UNPAID', amountPaid: '0', total: '7000',
        paymentInstruction: { method: 'BANK_TRANSFER', bankName: 'Fixture Bank', accountNumber: '0123456789', accountName: 'Shop' } },
      tokenHash: 'must-stay-private',
    };
    const prisma = { delivery: { findFirst: vi.fn().mockResolvedValue(record), findUniqueOrThrow: vi.fn().mockResolvedValue(record) } };
    const service = new DeliveryService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const result = await service.getPublic('buyer-account', 'private-token');
    expect(result.recipientName).toBe(isGift ? 'Amina' : null);
    expect(result.recipientPhone).toBe(isGift ? '+2348033334444' : null);
    expect(result.giftOccasion).toBe(isGift ? 'Birthday' : null);
    expect(result.sale.paymentInstruction?.accountNumber).toBe('0123456789');
    expect(result.handoffCode).toBeNull();
    expect(result).not.toHaveProperty('tokenHash');
    expect(prisma.delivery.findFirst.mock.calls[0][0].where.OR).toContainEqual({ customer: { accountId: 'buyer-account' } });
  });

  it('does not let an unpaid bank-transfer order leave the payment stage', async () => {
    const prisma = { delivery: { findFirst: vi.fn().mockResolvedValue({ id: 'delivery', status: 'AWAITING_PAYMENT', journeyMethod: 'SHOP_DELIVERY', sale: { paymentStatus: 'UNPAID', paymentInstruction: { method: 'BANK_TRANSFER' } } }) }, $transaction: vi.fn() };
    const service = new DeliveryService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.update({ businessId: 'shop' } as never, 'delivery', { status: 'PREPARING' })).rejects.toThrow(/payment/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
