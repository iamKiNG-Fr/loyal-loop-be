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
import { SubmitFoundingValueFeedbackDto } from "./dto/founding-value-feedback.dto";
import { FoundingValueFeedbackService } from "./founding-value-feedback.service";

@Controller("founding-circle/value-feedback")
@UseGuards(OwnerAuthGuard, RolesGuard)
@Roles("OWNER")
export class FoundingValueFeedbackController {
  constructor(private readonly feedback: FoundingValueFeedbackService) {}

  @Get("pending")
  async pending(@CurrentAuth() auth: OwnerAuthContext) {
    return ok(await this.feedback.pending(auth.businessId));
  }

  @Post(":id/submit")
  async submit(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: SubmitFoundingValueFeedbackDto,
  ) {
    return ok(
      await this.feedback.submit(auth.businessId, id, dto),
      "Thanks — your feedback was saved",
    );
  }

  @Post(":id/defer")
  async defer(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
  ) {
    return ok(
      await this.feedback.defer(auth.businessId, id),
      "We will ask after another completed sale",
    );
  }

  @Post(":id/snooze")
  async snooze(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
  ) {
    return ok(await this.feedback.snooze(auth.businessId, id));
  }
}
