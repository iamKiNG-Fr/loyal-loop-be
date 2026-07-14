import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { BusinessCapability } from "../../generated/prisma/client";
import type { LoyalLoopRequest } from "../request-context";
import { BUSINESS_CAPABILITIES_KEY } from "./capabilities.decorator";

@Injectable()
export class CapabilitiesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required =
      this.reflector.getAllAndOverride<BusinessCapability[]>(
        BUSINESS_CAPABILITIES_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? [];
    if (!required.length) return true;
    const auth = context.switchToHttp().getRequest<LoyalLoopRequest>().auth;
    if (!auth || !required.every((capability) => auth.capabilities.includes(capability))) {
      throw new ForbiddenException("You do not have permission to do this");
    }
    return true;
  }
}
