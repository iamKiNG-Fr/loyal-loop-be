import { Global, Module } from "@nestjs/common";
import { CustomerAuthGuard } from "./customer-auth.guard";
import { OwnerAuthGuard } from "./owner-auth.guard";
import { RolesGuard } from "./roles.guard";

@Global()
@Module({
  providers: [OwnerAuthGuard, CustomerAuthGuard, RolesGuard],
  exports: [OwnerAuthGuard, CustomerAuthGuard, RolesGuard],
})
export class SecurityModule {}
