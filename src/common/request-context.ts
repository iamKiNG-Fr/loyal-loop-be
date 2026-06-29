import type { Request } from "express";
import type { BusinessRole } from "../generated/prisma/client";

export type OwnerAuthContext = {
  userId: string;
  sessionId: string;
  businessId: string;
  role: BusinessRole;
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
