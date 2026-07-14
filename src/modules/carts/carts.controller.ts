import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentCustomer } from "../../common/auth/current-auth.decorator";
import { CustomerAuthGuard } from "../../common/auth/customer-auth.guard";
import { ok } from "../../common/api-response";
import type { CustomerAuthContext } from "../../common/request-context";
import { CartsService } from "./carts.service";
import {
  AddCartItemDto,
  MergeDeviceCartDto,
  SubmitCartDto,
  UpdateCartGroupDto,
  UpdateCartItemDto,
} from "./dto/cart.dto";

@Controller("customer-cart/device")
export class DeviceCartController {
  constructor(private readonly carts: CartsService) {}

  @Get()
  get(@Headers("x-cart-device") key: string) { return this.carts.deviceCart(key).then((data) => ok(data)); }

  @Post("items")
  add(@Headers("x-cart-device") key: string, @Body() dto: AddCartItemDto) {
    return this.carts.addDeviceItem(key, dto).then((data) => ok(data, "Added to bag"));
  }

  @Patch("items/:id")
  update(@Headers("x-cart-device") key: string, @Param("id") id: string, @Body() dto: UpdateCartItemDto) {
    return this.carts.updateDeviceItem(key, id, dto.quantity).then((data) => ok(data));
  }

  @Delete("items/:id")
  remove(@Headers("x-cart-device") key: string, @Param("id") id: string) {
    return this.carts.removeDeviceItem(key, id).then((data) => ok(data));
  }
}

@Controller("customer-cart")
@UseGuards(CustomerAuthGuard)
export class CustomerCartController {
  constructor(private readonly carts: CartsService) {}

  @Get()
  get(@CurrentCustomer() auth: CustomerAuthContext) { return this.carts.accountCart(auth).then((data) => ok(data)); }

  @Post("items")
  add(@CurrentCustomer() auth: CustomerAuthContext, @Body() dto: AddCartItemDto) {
    return this.carts.addAccountItem(auth, dto).then((data) => ok(data, "Added to bag"));
  }

  @Patch("items/:id")
  update(@CurrentCustomer() auth: CustomerAuthContext, @Param("id") id: string, @Body() dto: UpdateCartItemDto) {
    return this.carts.updateAccountItem(auth, id, dto.quantity).then((data) => ok(data));
  }

  @Delete("items/:id")
  remove(@CurrentCustomer() auth: CustomerAuthContext, @Param("id") id: string) {
    return this.carts.removeAccountItem(auth, id).then((data) => ok(data));
  }

  @Patch("groups/:businessId")
  group(@CurrentCustomer() auth: CustomerAuthContext, @Param("businessId") businessId: string, @Body() dto: UpdateCartGroupDto) {
    return this.carts.updateGroup(auth, businessId, dto).then((data) => ok(data));
  }

  @Post("merge")
  merge(@CurrentCustomer() auth: CustomerAuthContext, @Body() dto: MergeDeviceCartDto) {
    return this.carts.merge(auth, dto.deviceKey).then((data) => ok(data, "Bag merged"));
  }

  @Post("submit")
  submit(@CurrentCustomer() auth: CustomerAuthContext, @Body() dto: SubmitCartDto) {
    return this.carts.submit(auth, dto).then((data) => ok(data, "Bag submitted"));
  }
}
