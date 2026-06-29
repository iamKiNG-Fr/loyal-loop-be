import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { BillingService } from "./billing.service";

@Controller("billing")
@UseGuards(OwnerAuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("plan")
  plan(@CurrentAuth() auth: OwnerAuthContext) {
    return this.billing.getPlan(auth).then((data) => ok(data));
  }
}
