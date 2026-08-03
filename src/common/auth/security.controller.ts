import { Controller, Get, Header, Req } from "@nestjs/common";
import type { Request } from "express";
import { ok } from "../api-response";
import { CsrfService } from "./csrf.service";

@Controller("security")
export class SecurityController {
  constructor(private readonly csrf: CsrfService) {}

  @Get("csrf")
  @Header("Cache-Control", "no-store")
  csrfToken(@Req() request: Request) {
    return ok({ token: this.csrf.issue(request) });
  }
}
