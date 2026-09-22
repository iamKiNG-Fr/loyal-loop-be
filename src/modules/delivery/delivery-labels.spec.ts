import { describe, expect, it, vi } from 'vitest';
import { customerHandoffCodeAvailable } from './delivery-labels';
import { DeliveryService } from './delivery.service';

describe('delivery feedback and private code timing', () => {
  it('uses customer-facing stage names for a rejected skip', async () => {
    const prisma = { delivery: { findFirst: vi.fn().mockResolvedValue({ id: 'delivery-1', businessId: 'shop-1', status: 'PREPARING', journeyMethod: 'SHOP_DELIVERY' }) }, $transaction: vi.fn() };
    const service = new DeliveryService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.update({ businessId: 'shop-1' } as never, 'delivery-1', { status: 'IN_TRANSIT' })).rejects.toThrow('“Preparing” to “In transit”');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['AWAITING_PAYMENT', 'PREPARING', 'READY_FOR_PICKUP', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED', 'CANCELED'])('shows a shop delivery code only during transit/arrival: %s', status => {
    expect(customerHandoffCodeAvailable('SHOP_DELIVERY', status)).toBe(['IN_TRANSIT', 'DELIVERED'].includes(status));
    expect(customerHandoffCodeAvailable('CUSTOMER_PICKUP', status)).toBe(status === 'READY_FOR_PICKUP');
    expect(customerHandoffCodeAvailable('CUSTOMER_RIDER', status)).toBe(false);
  });
});
