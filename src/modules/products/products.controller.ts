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
import { Capabilities } from "../../common/auth/capabilities.decorator";
import { CapabilitiesGuard } from "../../common/auth/capabilities.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ok } from "../../common/api-response";
import type { OwnerAuthContext } from "../../common/request-context";
import { BusinessCapability } from "../../generated/prisma/client";
import {
  CreateProductDto,
  ProductListDto,
  ReplaceProductImagesDto,
  ReplaceProductMediaDto,
  UpdateProductDto,
} from "./dto/product.dto";
import { CreateBusinessCategoryDto } from "./dto/category.dto";
import { ProductsService } from "./products.service";

@Controller("products")
@UseGuards(OwnerAuthGuard, RolesGuard, CapabilitiesGuard)
@Capabilities(BusinessCapability.CATALOG_READ)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@CurrentAuth() auth: OwnerAuthContext, @Query() query: ProductListDto) {
    return this.products.list(auth, query);
  }

  @Post()
  @Capabilities(BusinessCapability.CATALOG_WRITE)
  @Roles("OWNER", "MANAGER", "SALES")
  create(@CurrentAuth() auth: OwnerAuthContext, @Body() dto: CreateProductDto) {
    return this.products.create(auth, dto).then((data) => ok(data, "Product added"));
  }

  @Get("categories")
  categories(@CurrentAuth() auth: OwnerAuthContext) {
    return this.products.categories(auth).then((data) => ok(data));
  }

  @Post("categories")
  @Capabilities(BusinessCapability.CATALOG_WRITE)
  @Roles("OWNER", "MANAGER", "SALES")
  createCategory(
    @CurrentAuth() auth: OwnerAuthContext,
    @Body() dto: CreateBusinessCategoryDto,
  ) {
    return this.products
      .createCategory(auth, dto)
      .then((data) => ok(data, "Category added"));
  }

  @Get(":id")
  get(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.products.get(auth, id).then((data) => ok(data));
  }

  @Patch(":id")
  @Capabilities(BusinessCapability.CATALOG_WRITE)
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
  @Capabilities(BusinessCapability.CATALOG_WRITE)
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

  @Put(":id/media")
  @Capabilities(BusinessCapability.CATALOG_WRITE)
  @Roles("OWNER", "MANAGER", "SALES")
  media(
    @CurrentAuth() auth: OwnerAuthContext,
    @Param("id") id: string,
    @Body() dto: ReplaceProductMediaDto,
  ) {
    return this.products
      .replaceMedia(auth, id, dto)
      .then((data) => ok(data, "Product media updated"));
  }

  @Delete(":id")
  @Capabilities(BusinessCapability.CATALOG_WRITE)
  @Roles("OWNER", "MANAGER")
  archive(@CurrentAuth() auth: OwnerAuthContext, @Param("id") id: string) {
    return this.products
      .archive(auth, id)
      .then((data) => ok(data, "Product archived"));
  }
}
