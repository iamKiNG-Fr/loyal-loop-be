import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import {
  CreateUploadSignatureDto,
  RegisterMediaAssetDto,
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

  @Get("assets")
  list(@CurrentAuth() auth: OwnerAuthContext) {
    return this.media.list(auth).then((data) => ok(data));
  }

  @Delete("assets/:id")
  @Roles("OWNER", "MANAGER")
  remove(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.media.remove(auth, id).then((data) => ok(data, "Asset deleted"));
  }
}
