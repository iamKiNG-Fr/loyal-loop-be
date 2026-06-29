import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { minutes, Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { CurrentCustomer } from "../../common/auth/current-auth.decorator";
import { CustomerAuthGuard } from "../../common/auth/customer-auth.guard";
import {
  clearSessionCookie,
  CUSTOMER_SESSION_COOKIE,
  readCookie,
  setSessionCookie,
} from "../../common/http.util";
import { ok } from "../../common/api-response";
import type { CustomerAuthContext } from "../../common/request-context";
import {
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
} from "./dto/customer-address.dto";
import { CustomerAuthService } from "./customer-auth.service";
import { StartCustomerOtpDto, VerifyCustomerOtpDto } from "./dto/customer-otp.dto";

@Controller("customer-auth")
export class CustomerAuthController {
  constructor(private readonly auth: CustomerAuthService) {}

  @Post("whatsapp/start")
  @Throttle({ default: { limit: 3, ttl: minutes(10) } })
  async start(@Body() dto: StartCustomerOtpDto) {
    return ok(await this.auth.start(dto.phone), "Verification sent");
  }

  @Post("whatsapp/verify")
  @Throttle({ default: { limit: 8, ttl: minutes(10) } })
  async verify(
    @Body() dto: VerifyCustomerOtpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verify(dto.challengeId, dto.code);
    setSessionCookie(
      response,
      CUSTOMER_SESSION_COOKIE,
      result.session.token,
      result.session.expiresAt,
    );
    return ok({ account: result.account }, "Customer verified");
  }

  @Post("refresh")
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = readCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE);
    if (!token) return ok(null, "No customer session to refresh");
    const session = await this.auth.rotate(token);
    setSessionCookie(
      response,
      CUSTOMER_SESSION_COOKIE,
      session.token,
      session.expiresAt,
    );
    return ok(null, "Customer session refreshed");
  }

  @Post("logout")
  @UseGuards(CustomerAuthGuard)
  async logout(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(customer.sessionId);
    clearSessionCookie(response, CUSTOMER_SESSION_COOKIE);
    return ok(null, "Customer signed out");
  }

  @Get("me/addresses")
  @UseGuards(CustomerAuthGuard)
  addresses(@CurrentCustomer() customer: CustomerAuthContext) {
    return this.auth
      .listAddresses(customer.customerAccountId)
      .then((data) => ok(data));
  }

  @Post("me/addresses")
  @UseGuards(CustomerAuthGuard)
  createAddress(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Body() dto: CreateCustomerAddressDto,
  ) {
    return this.auth
      .createAddress(customer.customerAccountId, dto)
      .then((data) => ok(data, "Address saved"));
  }

  @Patch("me/addresses/:id")
  @UseGuards(CustomerAuthGuard)
  updateAddress(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("id") id: string,
    @Body() dto: UpdateCustomerAddressDto,
  ) {
    return this.auth
      .updateAddress(customer.customerAccountId, id, dto)
      .then((data) => ok(data, "Address updated"));
  }

  @Delete("me/addresses/:id")
  @UseGuards(CustomerAuthGuard)
  async deleteAddress(
    @CurrentCustomer() customer: CustomerAuthContext,
    @Param("id") id: string,
  ) {
    await this.auth.deleteAddress(customer.customerAccountId, id);
    return ok(null, "Address deleted");
  }
}
