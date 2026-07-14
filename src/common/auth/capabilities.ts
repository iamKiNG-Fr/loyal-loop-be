import {
  BusinessCapability,
  BusinessRole,
} from "../../generated/prisma/client";

export const ALL_CAPABILITIES = Object.values(BusinessCapability);

const ROLE_DEFAULTS: Record<BusinessRole, BusinessCapability[]> = {
  OWNER: ALL_CAPABILITIES,
  MANAGER: ALL_CAPABILITIES.filter(
    (capability) => capability !== BusinessCapability.PERMISSION_ADMIN,
  ),
  SALES: [
    BusinessCapability.CUSTOMER_READ,
    BusinessCapability.CUSTOMER_WRITE,
    BusinessCapability.CATALOG_READ,
    BusinessCapability.SALE_READ,
    BusinessCapability.SALE_WRITE,
    BusinessCapability.PAYMENT_REVIEW,
    BusinessCapability.ORDER_READ,
    BusinessCapability.ORDER_WRITE,
    BusinessCapability.DELIVERY_READ,
    BusinessCapability.ISSUE_READ,
    BusinessCapability.ISSUE_WRITE,
    BusinessCapability.INSIGHT_READ,
    BusinessCapability.PROFILE_WRITE,
  ],
  DELIVERY: [
    BusinessCapability.CUSTOMER_READ,
    BusinessCapability.ORDER_READ,
    BusinessCapability.DELIVERY_READ,
    BusinessCapability.DELIVERY_WRITE,
    BusinessCapability.ISSUE_READ,
    BusinessCapability.ISSUE_WRITE,
    BusinessCapability.PROFILE_WRITE,
  ],
  VIEWER: [
    BusinessCapability.CUSTOMER_READ,
    BusinessCapability.CATALOG_READ,
    BusinessCapability.SALE_READ,
    BusinessCapability.ORDER_READ,
    BusinessCapability.DELIVERY_READ,
    BusinessCapability.ISSUE_READ,
    BusinessCapability.INSIGHT_READ,
  ],
};

export function resolveCapabilities(
  role: BusinessRole,
  overrides: Array<{ capability: BusinessCapability; allowed: boolean }> = [],
) {
  if (role === BusinessRole.OWNER) return [...ALL_CAPABILITIES];
  const resolved = new Set(ROLE_DEFAULTS[role]);
  for (const override of overrides) {
    if (override.allowed) resolved.add(override.capability);
    else resolved.delete(override.capability);
  }
  resolved.delete(BusinessCapability.PERMISSION_ADMIN);
  return ALL_CAPABILITIES.filter((capability) => resolved.has(capability));
}
