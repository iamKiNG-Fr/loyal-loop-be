import {
  Body,
  Controller,
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
  CreateFollowUpSuggestionDto,
  CreateFollowUpTemplateDto,
} from "./dto/follow-up.dto";
import { FollowUpsService } from "./follow-ups.service";

@Controller("follow-ups")
@UseGuards(OwnerAuthGuard, RolesGuard)
export class FollowUpsController {
  constructor(private readonly followUps: FollowUpsService) {}

  @Get("templates")
  templates(@CurrentAuth() auth: OwnerAuthContext) {
    return this.followUps.listTemplates(auth).then((data) => ok(data));
  }

  @Post("templates")
  @Roles("OWNER", "MANAGER", "SALES")
  createTemplate(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: CreateFollowUpTemplateDto,
  ) {
    return this.followUps
      .createTemplate(auth, dto)
      .then((data) => ok(data, "Template created"));
  }

  @Get("suggestions")
  suggestions(@CurrentAuth() auth: OwnerAuthContext) {
    return this.followUps.listSuggestions(auth).then((data) => ok(data));
  }

  @Post("suggestions")
  @Roles("OWNER", "MANAGER", "SALES")
  createSuggestion(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: CreateFollowUpSuggestionDto,
  ) {
    return this.followUps
      .createSuggestion(auth, dto)
      .then((data) => ok(data, "Follow-up suggested"));
  }

  @Post("suggestions/:id/approve")
  @Roles("OWNER", "MANAGER", "SALES")
  approve(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.followUps.approve(auth, id).then((data) => ok(data, "Follow-up approved"));
  }

  @Post("suggestions/:id/complete")
  @Roles("OWNER", "MANAGER", "SALES")
  complete(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.followUps
      .complete(auth, id)
      .then((data) => ok(data, "Follow-up completed"));
  }
}
