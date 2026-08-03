import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { minutes, Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { ok } from "../../common/api-response";
import { AdminOriginGuard } from "../../common/auth/admin-origin.guard";
import {
  OWNER_SESSION_COOKIE,
  PLATFORM_ADMIN_SESSION_COOKIE,
  clearSessionCookie,
  readCookie,
  setSessionCookie,
} from "../../common/http.util";
import {
  RenamePasskeyDto,
  VerifyPasskeyAuthenticationDto,
  VerifyPasskeyRegistrationDto,
  VerifyPlatformRecoveryCodeDto,
  VerifyPlatformStepUpDto,
} from "./dto/platform-auth.dto";
import { PlatformAuthService } from "./platform-auth.service";

@Controller("platform-auth")
@UseGuards(AdminOriginGuard)
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
      await this.auth.start(
        readCookie(request.headers.cookie, OWNER_SESSION_COOKIE),
        requestMeta(request),
      ),
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
      requestMeta(request),
    );
    setSessionCookie(
      response,
      PLATFORM_ADMIN_SESSION_COOKIE,
      result.token,
      result.expiresAt,
    );
    return ok(result.admin, "Platform access verified");
  }

  @Get("passkeys")
  async passkeys(@Req() request: Request) {
    return ok(await this.auth.passkeys(
      readCookie(request.headers.cookie, OWNER_SESSION_COOKIE),
      readCookie(request.headers.cookie, PLATFORM_ADMIN_SESSION_COOKIE),
    ));
  }

  @Post("passkeys/registration/options")
  async passkeyRegistrationOptions(@Req() request: Request) {
    return ok(await this.auth.passkeyRegistrationOptions(
      readCookie(request.headers.cookie, OWNER_SESSION_COOKIE),
      readCookie(request.headers.cookie, PLATFORM_ADMIN_SESSION_COOKIE),
    ));
  }

  @Post("passkeys/registration/verify")
  async verifyPasskeyRegistration(
    @Req() request: Request,
    @Body() dto: VerifyPasskeyRegistrationDto,
  ) {
    return ok(
      await this.auth.verifyPasskeyRegistration(
        readCookie(request.headers.cookie, OWNER_SESSION_COOKIE),
        readCookie(request.headers.cookie, PLATFORM_ADMIN_SESSION_COOKIE),
        dto,
      ),
      "Passkey added",
    );
  }

  @Post("passkeys/authentication/options")
  @Throttle({ default: { limit: 8, ttl: minutes(10) } })
  async passkeyAuthenticationOptions(@Req() request: Request) {
    return ok(await this.auth.passkeyAuthenticationOptions(
      readCookie(request.headers.cookie, OWNER_SESSION_COOKIE),
    ));
  }

  @Post("passkeys/authentication/verify")
  @Throttle({ default: { limit: 8, ttl: minutes(10) } })
  async verifyPasskeyAuthentication(
    @Req() request: Request,
    @Body() dto: VerifyPasskeyAuthenticationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verifyPasskeyAuthentication(
      readCookie(request.headers.cookie, OWNER_SESSION_COOKIE),
      dto,
      requestMeta(request),
    );
    setSessionCookie(response, PLATFORM_ADMIN_SESSION_COOKIE, result.token, result.expiresAt);
    return ok(result.admin, "Platform access verified with passkey");
  }

  @Post("recovery/verify")
  @Throttle({ default: { limit: 5, ttl: minutes(15) } })
  async verifyRecoveryCode(
    @Req() request: Request,
    @Body() dto: VerifyPlatformRecoveryCodeDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verifyRecoveryCode(
      readCookie(request.headers.cookie, OWNER_SESSION_COOKIE),
      dto.code,
      requestMeta(request),
    );
    setSessionCookie(response, PLATFORM_ADMIN_SESSION_COOKIE, result.token, result.expiresAt);
    return ok(result.admin, "Platform recovery code accepted");
  }

  @Post("recovery/regenerate")
  async regenerateRecoveryCodes(@Req() request: Request) {
    return ok(
      await this.auth.regenerateRecoveryCodes(
        readCookie(request.headers.cookie, OWNER_SESSION_COOKIE),
        readCookie(request.headers.cookie, PLATFORM_ADMIN_SESSION_COOKIE),
      ),
      "New recovery codes generated",
    );
  }

  @Patch("passkeys/:id")
  async renamePasskey(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() dto: RenamePasskeyDto,
  ) {
    return ok(await this.auth.renamePasskey(
      readCookie(request.headers.cookie, OWNER_SESSION_COOKIE),
      readCookie(request.headers.cookie, PLATFORM_ADMIN_SESSION_COOKIE),
      id,
      dto.name,
    ));
  }

  @Delete("passkeys/:id")
  async removePasskey(@Req() request: Request, @Param("id") id: string) {
    return ok(await this.auth.removePasskey(
      readCookie(request.headers.cookie, OWNER_SESSION_COOKIE),
      readCookie(request.headers.cookie, PLATFORM_ADMIN_SESSION_COOKIE),
      id,
    ), "Passkey removed");
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

function requestMeta(request: Request) {
  return {
    ip: request.ip,
    userAgent: request.header("user-agent")?.slice(0, 500),
  };
}
