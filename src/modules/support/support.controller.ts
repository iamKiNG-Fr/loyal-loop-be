import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { CreateSupportRequestDto } from "./dto/support.dto";
import { SupportService } from "./support.service";

@Controller("support")
@UseGuards(OwnerAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  create(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: CreateSupportRequestDto,
  ) {
    return this.support
      .create(auth, dto)
      .then((data) => ok(data, "Support request received"));
  }

  @Get()
  list(@CurrentAuth() auth: OwnerAuthContext) {
    return this.support.list(auth).then((data) => ok(data));
  }
}
