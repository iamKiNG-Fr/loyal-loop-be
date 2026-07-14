import { SetMetadata } from "@nestjs/common";
import type { BusinessCapability } from "../../generated/prisma/client";

export const BUSINESS_CAPABILITIES_KEY = "business-capabilities";
export const Capabilities = (...capabilities: BusinessCapability[]) =>
  SetMetadata(BUSINESS_CAPABILITIES_KEY, capabilities);
