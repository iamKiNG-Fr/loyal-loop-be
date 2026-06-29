import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentAuth } from "../../common/auth/current-auth.decorator";
import { OwnerAuthGuard } from "../../common/auth/owner-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import {
  CreateProductDto,
  ProductListDto,
  ReplaceProductImagesDto,
  UpdateProductDto,
} from "./dto/product.dto";
import { ProductsService } from "./products.service";

@Controller("products")
@UseGuards(OwnerAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@CurrentAuth() auth: OwnerAuthContext, @Query() query: ProductListDto) {
    return this.products.list(auth, query);
  }

  @Post()
  @Roles("OWNER", "MANAGER", "SALES")
  create(@CurrentAuth() auth: OwnerAuthContext, @Body() dto: CreateProductDto) {
    return this.products.create(auth, dto).then((data) => ok(data, "Product added"));
  }

  @Get(":id")
  get(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.products.get(auth, id).then((data) => ok(data));
  }

  @Patch(":id")
  @Roles("OWNER", "MANAGER", "SALES")
  update(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products
      .update(auth, id, dto)
      .then((data) => ok(data, "Product updated"));
  }

  @Put(":id/images")
  @Roles("OWNER", "MANAGER", "SALES")
  images(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: ReplaceProductImagesDto,
  ) {
    return this.products
      .replaceImages(auth, id, dto)
      .then((data) => ok(data, "Product images updated"));
  }

  @Delete(":id")
  @Roles("OWNER", "MANAGER")
  archive(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.products
      .archive(auth, id)
      .then((data) => ok(data, "Product archived"));
  }
}
