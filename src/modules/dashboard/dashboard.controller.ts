import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
@UseGuards(OwnerAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentAuth() auth: OwnerAuthContext) {
    return this.dashboard.get(auth).then((data) => ok(data));
  }
}
