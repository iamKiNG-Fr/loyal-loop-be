import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { minutes, Throttle } from "@nestjs/throttler";
import { ok } from "../../common/api-response";
import { CreateShortLinkDto } from "./dto/short-link.dto";
import { ShortLinksService } from "./short-links.service";

@Controller("public/short-links")
export class ShortLinksController {
  constructor(private readonly shortLinks: ShortLinksService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: minutes(1) } })
  create(@Body() dto: CreateShortLinkDto) {
    return this.shortLinks.create(dto).then(data => ok(data, "Short link ready"));
  }

  @Get(":code")
  resolve(@Param("code") code: string) {
    return this.shortLinks.resolve(code).then(data => ok(data));
  }
}
