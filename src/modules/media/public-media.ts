import { Prisma } from "../../generated/prisma/client";

export const publicMediaAssetWhere = {
  status: "ACTIVE",
  qualityStatus: { not: "FAIL" },
  moderationStatus: { in: ["AUTO_APPROVED", "MANUALLY_APPROVED"] },
  contentRating: "GENERAL",
} satisfies Prisma.MediaAssetWhereInput;

export const discoverableProductWhere = {
  status: "ACTIVE",
  visibility: "PUBLIC",
  contentRating: "GENERAL",
  OR: [
    { images: { some: { asset: { is: publicMediaAssetWhere } } } },
    { media: { some: { asset: { is: publicMediaAssetWhere } } } },
  ],
} satisfies Prisma.ProductWhereInput;

export const discoverableShowcaseWhere = {
  status: "PUBLISHED",
  contentRating: "GENERAL",
  asset: { is: publicMediaAssetWhere },
} satisfies Prisma.ShowcaseWhereInput;
