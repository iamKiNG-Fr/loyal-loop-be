import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { minutes, Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { hashPrivateValue } from "../../common/crypto.util";
import {
  clearSessionCookie,
  OWNER_SESSION_COOKIE,
  readCookie,
  setSessionCookie,
} from "../../common/http.util";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { StartOwnerOtpDto, VerifyOwnerOtpDto } from "./dto/owner-otp.dto";
import {
  ChangePasswordDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
} from "./dto/password.dto";
import { RegisterOwnerDto } from "./dto/register-owner.dto";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post("register")
  async register(
    @Body() dto: RegisterOwnerDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.register(dto, this.sessionMeta(request));
    setSessionCookie(
      response,
      OWNER_SESSION_COOKIE,
      result.session.token,
      result.session.expiresAt,
    );
    const { session: _session, ...identity } = result;
    return ok(identity, "Account and business created");
  }

  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(
      dto.email,
      dto.password,
      this.sessionMeta(request),
    );
    setSessionCookie(
      response,
      OWNER_SESSION_COOKIE,
      result.session.token,
      result.session.expiresAt,
    );
    const { session: _session, ...identity } = result;
    return ok(identity, "Signed in");
  }

  @Post("whatsapp/start")
  @Throttle({ default: { limit: 3, ttl: minutes(10) } })
  async startWhatsapp(@Body() dto: StartOwnerOtpDto) {
    return ok(await this.auth.startWhatsapp(dto.phone), "Verification sent");
  }

  @Post("onboarding/whatsapp/start")
  @Throttle({ default: { limit: 3, ttl: minutes(10) } })
  async startOnboardingWhatsapp(@Body() dto: StartOwnerOtpDto) {
    return ok(
      await this.auth.startOnboardingWhatsapp(dto.phone),
      "Onboarding verification sent",
    );
  }

  @Post("onboarding/whatsapp/verify")
  @Throttle({ default: { limit: 8, ttl: minutes(10) } })
  async verifyOnboardingWhatsapp(@Body() dto: VerifyOwnerOtpDto) {
    return ok(
      await this.auth.verifyOnboardingWhatsapp(dto.challengeId, dto.code),
      "WhatsApp number verified",
    );
  }

  @Post("whatsapp/verify")
  @Throttle({ default: { limit: 8, ttl: minutes(10) } })
  async verifyWhatsapp(
    @Body() dto: VerifyOwnerOtpDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verifyWhatsapp(
      dto.challengeId,
      dto.code,
      this.sessionMeta(request),
    );
    setSessionCookie(
      response,
      OWNER_SESSION_COOKIE,
      result.session.token,
      result.session.expiresAt,
    );
    const { session: _session, ...identity } = result;
    return ok(identity, "Signed in with WhatsApp");
  }

  @Post("refresh")
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = readCookie(request.headers.cookie, OWNER_SESSION_COOKIE);
    if (!token) return ok(null, "No session to refresh");
    const session = await this.auth.rotate(token, this.sessionMeta(request));
    setSessionCookie(
      response,
      OWNER_SESSION_COOKIE,
      session.token,
      session.expiresAt,
    );
    return ok(null, "Session refreshed");
  }

  @Post("logout")
  @UseGuards(OwnerAuthGuard)
  async logout(
    @CurrentAuth() auth: OwnerAuthContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(auth.sessionId);
    clearSessionCookie(response, OWNER_SESSION_COOKIE);
    return ok(null, "Signed out");
  }

  @Get("me")
  @UseGuards(OwnerAuthGuard)
  async me(@CurrentAuth() auth: OwnerAuthContext) {
    return ok(await this.auth.me(auth));
  }

  @Post("password/change")
  @UseGuards(OwnerAuthGuard)
  async changePassword(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.auth.changePassword(auth, dto);
    return ok(null, "Password updated");
  }

  @Post("password/request-reset")
  async requestReset(@Body() dto: RequestPasswordResetDto) {
    await this.auth.requestPasswordReset(dto.email);
    return ok(null, "If the account exists, a reset link has been sent");
  }

  @Post("password/reset")
  async reset(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
    return ok(null, "Password reset");
  }

  private sessionMeta(request: Request) {
    const secret = this.config.get<string>("SESSION_HASH_SECRET", "");
    return {
      userAgent: request.header("user-agent")?.slice(0, 500),
      ipHash: request.ip ? hashPrivateValue(request.ip, secret) : undefined,
    };
  }
}
