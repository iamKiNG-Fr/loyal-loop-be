import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { BusinessRole } from "../../generated/prisma/client";
import type { LoyalLoopRequest } from "../request-context";
import { BUSINESS_ROLES_KEY } from "./roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const allowed =
      this.reflector.getAllAndOverride<BusinessRole[]>(BUSINESS_ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (!allowed.length) return true;

    const request = context.switchToHttp().getRequest<LoyalLoopRequest>();
    if (!request.auth || !allowed.includes(request.auth.role)) {
      throw new ForbiddenException("Your business role cannot do this");
    }
    return true;
  }
}
