export function deliveryStageLabel(status: string, method: string) {
  if (status === 'READY_FOR_PICKUP' && method === 'SHOP_DELIVERY') return 'Ready for dispatch';
  if (status === 'IN_TRANSIT' && method === 'CUSTOMER_RIDER') return 'Handed to rider';
  return ({ AWAITING_PAYMENT: 'Waiting for payment', PREPARING: 'Preparing', READY_FOR_PICKUP: 'Ready for pickup', IN_TRANSIT: 'In transit', DELIVERED: 'Arrived', CONFIRMED: 'Customer confirmed', ISSUE: 'Issue reported', CANCELED: 'Canceled' } as Record<string, string>)[status] || 'Unknown stage';
}

export function customerHandoffCodeAvailable(method: string, status: string) {
  return method === 'CUSTOMER_PICKUP' ? status === 'READY_FOR_PICKUP' : method === 'SHOP_DELIVERY' && ['IN_TRANSIT', 'DELIVERED'].includes(status);
}
