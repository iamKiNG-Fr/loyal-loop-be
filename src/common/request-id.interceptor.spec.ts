import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { RequestIdInterceptor } from "./request-id.interceptor";

describe("RequestIdInterceptor", () => {
  it("preserves request correlation and exposes application duration", async () => {
    const setHeader = vi.fn();
    const request = {
      header: vi.fn(() => "incoming-request-id"),
      method: "POST",
      path: "/products",
    };
    const response = {
      getHeader: vi.fn(() => "db;dur=12.0"),
      headersSent: false,
      setHeader,
      statusCode: 201,
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of({ ok: true }) } as CallHandler;

    await lastValueFrom(new RequestIdInterceptor().intercept(context, next));

    expect(request).toHaveProperty("requestId", "incoming-request-id");
    expect(setHeader).toHaveBeenCalledWith("x-request-id", "incoming-request-id");
    expect(setHeader).toHaveBeenCalledWith("Server-Timing", expect.stringMatching(/^db;dur=12\.0, app;dur=\d+\.\d$/));
  });

  it("records failed requests without logging query-string contents", async () => {
    const setHeader = vi.fn();
    const request = {
      header: vi.fn(() => undefined),
      method: "POST",
      path: "/products",
    };
    const response = {
      getHeader: vi.fn(() => undefined),
      headersSent: false,
      setHeader,
      statusCode: 500,
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    const interceptor = new RequestIdInterceptor();
    const errorLog = vi.spyOn((interceptor as unknown as { logger: { error: (value: string) => void } }).logger, "error").mockImplementation(() => undefined);
    const next = { handle: () => throwError(() => ({ statusCode: 503 })) } as CallHandler;

    await expect(lastValueFrom(interceptor.intercept(context, next))).rejects.toEqual({ statusCode: 503 });

    expect(setHeader).toHaveBeenCalledWith("Server-Timing", expect.stringMatching(/^app;dur=\d+\.\d$/));
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('"path":"/products"'));
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('"statusCode":503'));
  });
});
