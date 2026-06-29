import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type {
  CustomerAuthContext,
  LoyalLoopRequest,
  OwnerAuthContext,
} from "../request-context";

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OwnerAuthContext => {
    const request = context.switchToHttp().getRequest<LoyalLoopRequest>();
    if (!request.auth) throw new Error("Owner auth context is missing");
    return request.auth;
  },
);

export const CurrentCustomer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CustomerAuthContext => {
    const request = context.switchToHttp().getRequest<LoyalLoopRequest>();
    if (!request.customerAuth) throw new Error("Customer auth context is missing");
    return request.customerAuth;
  },
);
