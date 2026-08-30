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
import { MonitoringService } from "../modules/monitoring/monitoring.service";

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestIdInterceptor.name);

  constructor(private readonly monitoring?: MonitoringService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<LoyalLoopRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const incoming = request.header("x-request-id");
    const startedAt = process.hrtime.bigint();
    let recorded = false;
    const requestId = request.requestId || incoming?.slice(0, 100) || randomUUID();
    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);

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
          requestId,
          statusCode,
        });
        if (statusCode >= 500) this.logger.error(event);
        else this.logger.warn(event);
        void this.monitoring?.capture({
          durationMs: Number(durationMs.toFixed(1)),
          method: request.method,
          path: request.path,
          requestId,
          severity: statusCode >= 500 ? "error" : "warning",
          statusCode,
          timestamp: new Date().toISOString(),
          type: statusCode >= 500 ? "http_error" : "slow_request",
        });
      }
    };

    return next.handle().pipe(tap({
      error: (error: { status?: number, statusCode?: number }) => recordTiming(error.statusCode ?? error.status ?? 500),
      next: () => recordTiming(response.statusCode),
    }));
  }
}
