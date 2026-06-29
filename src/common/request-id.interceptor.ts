import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import type { Observable } from "rxjs";
import type { LoyalLoopRequest } from "./request-context";

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<LoyalLoopRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const incoming = request.header("x-request-id");
    request.requestId = incoming?.slice(0, 100) || randomUUID();
    response.setHeader("x-request-id", request.requestId);
    return next.handle();
  }
}
