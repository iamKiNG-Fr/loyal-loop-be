import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import type { Observable } from "rxjs";
import { tap } from "rxjs";
import type { LoyalLoopRequest } from "./request-context";

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestIdInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<LoyalLoopRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const incoming = request.header("x-request-id");
    const startedAt = process.hrtime.bigint();
    let recorded = false;
    request.requestId ||= incoming?.slice(0, 100) || randomUUID();
    response.setHeader("x-request-id", request.requestId);

    const recordTiming = (statusCode: number) => {
      if (recorded) return;
      recorded = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const timing = `app;dur=${durationMs.toFixed(1)}`;
      if (!response.headersSent) {
        const existing = response.getHeader("Server-Timing");
        response.setHeader("Server-Timing", existing ? `${String(existing)}, ${timing}` : timing);
      }
      if (statusCode >= 500 || durationMs >= 750) {
        const event = JSON.stringify({
          durationMs: Number(durationMs.toFixed(1)),
          method: request.method,
          path: request.path,
          requestId: request.requestId,
          statusCode,
        });
        if (statusCode >= 500) this.logger.error(event);
        else this.logger.warn(event);
      }
    };

    return next.handle().pipe(tap({
      error: (error: { status?: number, statusCode?: number }) => recordTiming(error.statusCode ?? error.status ?? 500),
      next: () => recordTiming(response.statusCode),
    }));
  }
}
