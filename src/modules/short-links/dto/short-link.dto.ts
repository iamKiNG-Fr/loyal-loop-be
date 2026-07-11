import { IsEnum, IsIn, IsOptional, IsString, Length, Matches } from "class-validator";
import { ShortLinkKind } from "../../../generated/prisma/client";
import { DISCOVERY_CAMPAIGNS, DISCOVERY_SOURCES } from "../../shops/discovery-attribution";

export class CreateShortLinkDto {
  @IsEnum(ShortLinkKind)
  kind!: ShortLinkKind;

  @IsIn(DISCOVERY_SOURCES)
  source!: (typeof DISCOVERY_SOURCES)[number];

  @IsIn(DISCOVERY_CAMPAIGNS)
  campaign!: (typeof DISCOVERY_CAMPAIGNS)[number];

  @IsOptional()
  @IsString()
  @Length(1, 120)
  shopSlug?: string;

  @IsOptional()
  @IsString()
  @Length(1, 180)
  productKey?: string;

  @IsOptional()
  @IsString()
  @Length(8, 200)
  receiptToken?: string;

  @IsOptional()
  @IsString()
  @Matches(/^LL-[A-Z2-9]{4,32}$/)
  cardId?: string;
}
