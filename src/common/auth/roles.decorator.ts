import { SetMetadata } from "@nestjs/common";
import type { BusinessRole } from "../../generated/prisma/client";

export const BUSINESS_ROLES_KEY = "business_roles";
export const Roles = (...roles: BusinessRole[]) =>
  SetMetadata(BUSINESS_ROLES_KEY, roles);
