import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { minutes, Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { ok } from "../../common/api-response";
import {
  OWNER_SESSION_COOKIE,
  PLATFORM_ADMIN_SESSION_COOKIE,
  clearSessionCookie,
  readCookie,
  setSessionCookie,
} from "../../common/http.util";
import { VerifyPlatformStepUpDto } from "./dto/platform-auth.dto";
import { PlatformAuthService } from "./platform-auth.service";

@Controller("platform-auth")
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Get("me")
  async me(@Req() request: Request) {
    return ok(
      await this.auth.current(
        readCookie(request.headers.cookie, OWNER_SESSION_COOKIE),
        readCookie(request.headers.cookie, PLATFORM_ADMIN_SESSION_COOKIE),
      ),
    );
  }

  @Post("step-up/start")
  @Throttle({ default: { limit: 3, ttl: minutes(10) } })
  async start(@Req() request: Request) {
    return ok(
      await this.auth.start(readCookie(request.headers.cookie, OWNER_SESSION_COOKIE)),
      "Platform verification sent",
    );
  }

  @Post("step-up/verify")
  @Throttle({ default: { limit: 8, ttl: minutes(10) } })
  async verify(
    @Req() request: Request,
    @Body() dto: VerifyPlatformStepUpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verify(
      readCookie(request.headers.cookie, OWNER_SESSION_COOKIE),
      dto.challengeId,
      dto.code,
    );
    setSessionCookie(
      response,
      PLATFORM_ADMIN_SESSION_COOKIE,
      result.token,
      result.expiresAt,
    );
    return ok(result.admin, "Platform access verified");
  }

  @Post("logout")
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(
      readCookie(request.headers.cookie, PLATFORM_ADMIN_SESSION_COOKIE),
    );
    clearSessionCookie(response, PLATFORM_ADMIN_SESSION_COOKIE);
    return ok(null, "Platform session closed");
  }
}
