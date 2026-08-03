import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { AttentionSchedulerService } from "./attention-scheduler.service";
import { AttentionService } from "./attention.service";
import {
  MarkAttentionSeenDto,
  RemovePushSubscriptionDto,
  SavePushSubscriptionDto,
  SnoozeAttentionDto,
  UpdateOwnerNotificationPreferencesDto,
} from "./dto/attention.dto";

@Controller("attention")
@UseGuards(OwnerAuthGuard, RolesGuard)
export class AttentionController {
  constructor(
    private readonly attention: AttentionService,
    private readonly scheduler: AttentionSchedulerService,
  ) {}

  @Get()
  get(@CurrentAuth() auth: OwnerAuthContext) {
    return this.attention.get(auth).then((data) => ok(data));
  }

  @Post("seen")
  seen(@CurrentAuth() auth: OwnerAuthContext, @Body() dto: MarkAttentionSeenDto) {
    return this.attention.markSeen(auth, dto).then((data) => ok(data, "Activity marked as seen"));
  }

  @Post("snooze")
  snooze(@CurrentAuth() auth: OwnerAuthContext, @Body() dto: SnoozeAttentionDto) {
    return this.attention.snooze(auth, dto).then((data) => ok(data, "Task snoozed"));
  }

  @Get("preferences")
  @Roles("OWNER")
  preferences(@CurrentAuth() auth: OwnerAuthContext) {
    return this.attention.preferences(auth).then((data) => ok(data));
  }

  @Put("preferences")
  @Roles("OWNER")
  updatePreferences(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: UpdateOwnerNotificationPreferencesDto,
  ) {
    return this.attention.updatePreferences(auth, dto).then((data) => ok(data, "Reminder preferences updated"));
  }

  @Post("push-subscriptions")
  savePushSubscription(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: SavePushSubscriptionDto,
    @Req() request: Request,
  ) {
    return this.attention
      .savePushSubscription(auth, dto, request.header("user-agent"))
      .then((data) => ok(data, "This device can receive notifications"));
  }

  @Delete("push-subscriptions")
  removePushSubscription(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: RemovePushSubscriptionDto,
  ) {
    return this.attention
      .removePushSubscription(auth, dto)
      .then((data) => ok(data, "Device notifications removed"));
  }

  @Post("push-test")
  pushTest(@CurrentAuth() auth: OwnerAuthContext) {
    return this.scheduler.sendPushTest(auth).then((data) => ok(data, "Test notification sent"));
  }
}

@Controller("attention/internal")
export class AttentionSchedulerController {
  constructor(private readonly scheduler: AttentionSchedulerService) {}

  @Post("run")
  run(@Headers("x-reminder-scheduler-secret") secret: string | undefined) {
    this.scheduler.assertSecret(secret);
    return this.scheduler.run().then((data) => ok(data, "Reminder schedule processed"));
  }
}
