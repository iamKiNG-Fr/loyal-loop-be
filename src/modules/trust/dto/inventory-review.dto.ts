import { ArrayUnique, IsArray, IsString } from "class-validator";

export class CompleteInventoryReviewDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  reviewedProductIds!: string[];
}
