import type { Prisma } from "../generated/prisma/client";

export function customerOrderRequestTokenWhere(
  customerAccountId: string,
  tokenHash: string,
): Prisma.OrderRequestWhereInput {
  return {
    customerAccountId,
    OR: [
      { tokenHash },
      { shareTokens: { some: { tokenHash, revokedAt: null } } },
    ],
  };
}
