import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CurrentAuth,
  CurrentPlatformAdmin,
} from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { PlatformAdminGuard } from "../../common/auth/platform-admin.guard";
import { PlatformRoles } from "../../common/auth/platform-roles.decorator";
import { PlatformRolesGuard } from "../../common/auth/platform-roles.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type {
  OwnerAuthContext,
  LoyalLoopRequest,
  PlatformAuthContext,
} from "../../common/request-context";
import {
  AppealMediaAssetDto,
  CreateUploadSignatureDto,
  MediaFailureTelemetryDto,
  RegisterMediaAssetDto,
  ReviewMediaAssetDto,
} from "./dto/media.dto";
import { MediaService } from "./media.service";

@Controller("media")
@UseGuards(OwnerAuthGuard, RolesGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post("signature")
  @Roles("OWNER", "MANAGER", "SALES")
  signature(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: CreateUploadSignatureDto,
  ) {
    return ok(this.media.createUploadSignature(auth, dto));
  }

  @Post("assets")
  @Roles("OWNER", "MANAGER", "SALES")
  register(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: RegisterMediaAssetDto,
  ) {
    return this.media.register(auth, dto).then((data) => ok(data, "Asset registered"));
  }

  @Post("telemetry/failure")
  @Roles("OWNER", "MANAGER", "SALES")
  failure(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: MediaFailureTelemetryDto,
  ) {
    return this.media.recordFailure(auth, dto).then(() => ok(null, "Media failure recorded"));
  }

  @Get("assets")
  list(@CurrentAuth() auth: OwnerAuthContext) {
    return this.media.list(auth).then((data) => ok(data));
  }

  @Delete("assets/:id")
  @Roles("OWNER", "MANAGER")
  remove(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.media.remove(auth, id).then((data) => ok(data, "Asset deleted"));
  }

  @Post("assets/:id/appeal")
  @Roles("OWNER", "MANAGER")
  appeal(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: AppealMediaAssetDto,
  ) {
    return this.media.appeal(auth, id, dto).then((data) => ok(data, "Appeal submitted"));
  }
}

@Controller("platform/media")
@UseGuards(PlatformAdminGuard, PlatformRolesGuard)
@PlatformRoles("SUPERADMIN", "ADMIN")
export class MediaModerationController {
  constructor(private readonly media: MediaService) {}

  @Get("review")
  list(@Query("cursor") cursor?: string) {
    return this.media.reviewQueue(cursor).then((data) => ok(data));
  }

  @Post("review/:id")
  review(
    @CurrentPlatformAdmin() auth: PlatformAuthContext,
    @Param("id") id: string,
    @Body() dto: ReviewMediaAssetDto,
  ) {
    return this.media.review(auth, id, dto).then((data) => ok(data, "Review saved"));
  }
}

@Controller("media/webhooks")
export class MediaWebhookController {
  constructor(private readonly media: MediaService) {}

  @Post("cloudinary")
  cloudinary(
    @Req() request: LoyalLoopRequest,
    @Headers("x-cld-timestamp") timestamp: string | undefined,
    @Headers("x-cld-signature") signature: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.media
      .handleCloudinaryNotification(request.rawBody, timestamp, signature, payload)
      .then((data) => ok(data));
  }
}
