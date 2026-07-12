import { Module } from "@nestjs/common";
import {
  CustomerDiscoveryController,
  PublicDiscoveryController,
  ShowcasesController,
} from "./discovery.controller";
import { DiscoveryService } from "./discovery.service";

@Module({
  controllers: [
    PublicDiscoveryController,
    CustomerDiscoveryController,
    ShowcasesController,
  ],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
