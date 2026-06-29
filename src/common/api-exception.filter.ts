import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import type { LoyalLoopRequest } from "./request-context";

type NestErrorBody = {
  error?: string;
  message?: string | string[];
  statusCode?: number;
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<LoyalLoopRequest>();
    const response = context.getResponse<Response>();
    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttp ? exception.getResponse() : undefined;
    const normalized =
      typeof body === "string" ? { message: body } : (body as NestErrorBody);
    const messages = Array.isArray(normalized?.message)
      ? normalized.message
      : normalized?.message
        ? [normalized.message]
        : [];
    const code =
      normalized?.error
        ?.toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_") ??
      (status === 500 ? "INTERNAL_SERVER_ERROR" : `HTTP_${status}`);

    response.status(status).json({
      success: false,
      message:
        status === 500
          ? "Something went wrong"
          : messages[0] ?? "Request failed",
      data: null,
      code,
      errors: messages.length > 1 ? messages : undefined,
      requestId: request.requestId,
    });
  }
}
