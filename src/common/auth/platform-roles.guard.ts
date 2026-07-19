import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PlatformRole } from "../../generated/prisma/client";
import type { LoyalLoopRequest } from "../request-context";
import { PLATFORM_ROLES_KEY } from "./platform-roles.decorator";

@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<PlatformRole[]>(
      PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) return true;
    const request = context.switchToHttp().getRequest<LoyalLoopRequest>();
    if (!request.platformAuth || !roles.includes(request.platformAuth.role)) {
      throw new ForbiddenException("This platform role cannot perform that action");
    }
    return true;
  }
}
