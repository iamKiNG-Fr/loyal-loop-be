import { describe, expect, it, vi } from 'vitest';
import { DeliveryService } from './delivery.service';

function setup(overrides = {}) {
  const delivery = { id: 'delivery', journeyMethod: 'CUSTOMER_PICKUP', status: 'READY_FOR_PICKUP', handedOffAt: null, ...overrides };
  const tx = { delivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, deliveryEvent: { create: vi.fn().mockResolvedValue({}) } };
  const prisma = { delivery: { findFirst: vi.fn().mockResolvedValue(delivery) }, $transaction: vi.fn(async (run) => run(tx)) };
  const service = new DeliveryService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const publicRecord = { id: 'delivery', pickupAddress: 'Saved pickup address', handoffCode: null };
  vi.spyOn(service, 'getPublic').mockResolvedValue(publicRecord as never);
  return { service, tx, prisma, publicRecord };
}

describe('customer pickup collection updates', () => {
  it('returns the safe customer projection and changes the saved collector atomically', async () => {
    const { service, tx, publicRecord } = setup();
    expect(await service.switchPickupMethod('buyer', 'token', { method: 'CUSTOMER_RIDER', riderName: 'Ayo', riderPhone: '+2348011112222' })).toBe(publicRecord);
    expect(tx.delivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'delivery', status: 'READY_FOR_PICKUP', journeyMethod: 'CUSTOMER_PICKUP', handedOffAt: null }, data: expect.objectContaining({ journeyMethod: 'CUSTOMER_RIDER', handoffCodeIssuedAt: null }) }));
    expect(service.getPublic).toHaveBeenCalledWith('buyer', 'token');
    expect(tx.deliveryEvent.create).toHaveBeenCalledOnce();
  });
  it('lets the customer choose collection while payment is pending without starting fulfilment', async () => {
    const { service, tx } = setup({ status: 'AWAITING_PAYMENT' });
    await service.switchPickupMethod('buyer', 'token', { method: 'CUSTOMER_PICKUP' });
    expect(tx.delivery.updateMany.mock.calls[0][0].data).not.toHaveProperty('status');
    expect(tx.delivery.updateMany.mock.calls[0][0].data.handoffCodeIssuedAt).toBeNull();
  });
  it.each([{ journeyMethod: 'SHOP_DELIVERY' }, { status: 'IN_TRANSIT' }, { handedOffAt: new Date() }])('rejects a non-pickup or handed-off order: %j', async overrides => {
    const { service, prisma } = setup(overrides);
    await expect(service.switchPickupMethod('buyer', 'token', { method: 'CUSTOMER_PICKUP' })).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects a stale collection change after a concurrent handoff', async () => {
    const { service, tx } = setup();
    tx.delivery.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.switchPickupMethod('buyer', 'token', { method: 'CUSTOMER_PICKUP' })).rejects.toThrow(/order changed/);
    expect(tx.deliveryEvent.create).not.toHaveBeenCalled();
    expect(service.getPublic).not.toHaveBeenCalled();
  });
  it.each(['arbitrary text', '123', ''])('rejects invalid rider contact %s', async riderPhone => {
    const { service, prisma } = setup();
    await expect(service.switchPickupMethod('buyer', 'token', { method: 'CUSTOMER_RIDER', riderName: 'Ayo', riderPhone })).rejects.toThrow(/valid phone/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
