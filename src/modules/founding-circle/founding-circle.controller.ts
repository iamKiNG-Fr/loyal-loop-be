import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { minutes, Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  ONBOARDING_GRANT_COOKIE,
  clearSessionCookie,
  readCookie,
  setSessionCookie,
} from "../../common/http.util";
import { ok } from "../../common/api-response";
import {
  CreateFoundingApplicationDto,
  ValidateFoundingAccessDto,
  SaveOnboardingDraftDto,
} from "./dto/founding-circle.dto";
import { FoundingCircleService } from "./founding-circle.service";

@Controller("founding-circle")
export class FoundingCircleController {
  constructor(private readonly founding: FoundingCircleService) {}

  @Post("applications")
  @Throttle({ default: { limit: 5, ttl: minutes(10) } })
  async apply(@Body() dto: CreateFoundingApplicationDto) {
    return ok(
      await this.founding.createApplication(dto),
      "Your Founding Circle request has been received",
    );
  }

  @Post("access/validate")
  @Throttle({ default: { limit: 8, ttl: minutes(10) } })
  async validate(
    @Body() dto: ValidateFoundingAccessDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.founding.validateAccess(dto.code);
    setSessionCookie(
      response,
      ONBOARDING_GRANT_COOKIE,
      result.grantToken,
      result.expiresAt,
    );
    return ok(
      {
        expiresAt: result.expiresAt,
        invitationSuffix: result.invitationSuffix,
        draftScope: result.draftScope,
      },
      "Founding Circle invitation accepted",
    );
  }

  @Get("access/status")
  async status(@Req() request: Request) {
    const raw = readCookie(request.headers.cookie, ONBOARDING_GRANT_COOKIE);
    return ok(await this.founding.grantStatus(raw));
  }

  @Post("access/clear")
  clear(@Res({ passthrough: true }) response: Response) {
    clearSessionCookie(response, ONBOARDING_GRANT_COOKIE);
    return ok(null, "Founding access cleared");
  }

  @Get("onboarding-draft")
  @Header("Cache-Control", "no-store")
  async draft(@Req() request: Request) {
    return ok(await this.founding.readOnboardingDraft(readCookie(request.headers.cookie, ONBOARDING_GRANT_COOKIE)));
  }

  @Post("onboarding-draft")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 60, ttl: minutes(1) } })
  async saveDraft(@Req() request: Request, @Body() dto: SaveOnboardingDraftDto) {
    return ok(await this.founding.saveOnboardingDraft(readCookie(request.headers.cookie, ONBOARDING_GRANT_COOKIE), dto));
  }
}
