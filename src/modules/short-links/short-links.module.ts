import { Module } from "@nestjs/common";
import { ShortLinksController } from "./short-links.controller";
import { ShortLinksService } from "./short-links.service";

@Module({ controllers: [ShortLinksController], providers: [ShortLinksService] })
export class ShortLinksModule {}
