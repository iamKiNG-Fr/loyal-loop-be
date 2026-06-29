import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { ActivityService } from "./activity.service";

@Controller("activity")
@UseGuards(OwnerAuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  list(
    @CurrentAuth() auth: OwnerAuthContext,
    @Query("customerId") customerId?: string,
  ) {
    return this.activity
      .list(auth.businessId, customerId)
      .then((data) => ok(data));
  }
}
