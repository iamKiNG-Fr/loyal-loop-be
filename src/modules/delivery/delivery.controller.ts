import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
  CreateDeliveryIssueDto,
  SubmitDeliveryFeedbackDto,
  UpdateDeliveryDto,
} from "./dto/delivery.dto";
import { DeliveryService } from "./delivery.service";

@Controller("deliveries")
@UseGuards(OwnerAuthGuard, RolesGuard)
export class DeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Get()
  list(@CurrentAuth() auth: OwnerAuthContext) {
    return this.deliveries.list(auth).then((data) => ok(data));
  }

  @Get(":id")
  get(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.deliveries.get(auth, id).then((data) => ok(data));
  }

  @Patch(":id")
  @Roles("OWNER", "MANAGER", "SALES", "DELIVERY")
  update(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: UpdateDeliveryDto,
  ) {
    return this.deliveries
      .update(auth, id, dto)
      .then((data) => ok(data, "Delivery updated"));
  }

  @Post(":id/issues/:issueId/resolve")
  @Roles("OWNER", "MANAGER", "DELIVERY")
  resolve(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Param("issueId") issueId: string,
  ) {
    return this.deliveries
      .resolveIssue(auth, id, issueId)
      .then((data) => ok(data, "Issue resolved"));
  }
}

@Controller("public/deliveries")
export class PublicDeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Get(":token")
  get(@Param("token") token: string) {
    return this.deliveries.getPublic(token).then((data) => ok(data));
  }

  @Post(":token/confirm")
  confirm(@Param("token") token: string) {
    return this.deliveries
      .confirm(token)
      .then((data) => ok(data, "Delivery confirmed"));
  }

  @Post(":token/feedback")
  feedback(
    @Param("token") token: string,
    @Body() dto: SubmitDeliveryFeedbackDto,
  ) {
    return this.deliveries
      .feedback(token, dto)
      .then((data) => ok(data, "Feedback submitted"));
  }

  @Post(":token/issues")
  issue(
    @Param("token") token: string,
    @Body() dto: CreateDeliveryIssueDto,
  ) {
    return this.deliveries
      .createIssue(token, dto)
      .then((data) => ok(data, "Issue submitted"));
  }
}
