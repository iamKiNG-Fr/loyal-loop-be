import type { Request } from "express";
import type {
  BusinessCapability,
  BusinessRole,
  PlatformRole,
} from "../generated/prisma/client";

export type OwnerAuthContext = {
  userId: string;
  sessionId: string;
  businessId: string;
  memberId: string;
  role: BusinessRole;
  capabilities: BusinessCapability[];
};

export type CustomerAuthContext = {
  customerAccountId: string;
  sessionId: string;
};

export type PlatformAuthContext = {
  platformAdminId: string;
  platformSessionId: string;
  userId: string;
  ownerSessionId: string;
  role: PlatformRole;
  verifiedAt: Date;
};

export interface LoyalLoopRequest extends Request {
  rawBody?: Buffer;
  requestId?: string;
  auth?: OwnerAuthContext;
  customerAuth?: CustomerAuthContext;
  platformAuth?: PlatformAuthContext;
}
