import type { Request } from "express";
import type {
  BusinessCapability,
  BusinessRole,
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

export interface LoyalLoopRequest extends Request {
  requestId?: string;
  auth?: OwnerAuthContext;
  customerAuth?: CustomerAuthContext;
}
