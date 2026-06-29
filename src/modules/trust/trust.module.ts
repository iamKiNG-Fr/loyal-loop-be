import { Global, Module } from "@nestjs/common";
import { TrustController } from "./trust.controller";
import { TrustService } from "./trust.service";

@Global()
@Module({
  controllers: [TrustController],
  providers: [TrustService],
  exports: [TrustService],
})
export class TrustModule {}
