-- Backfill durable business categories from readable legacy product values.
-- The old UI sentinel `__new` did not contain the category name, so it is
-- cleared instead of becoming a customer-visible category.
INSERT INTO "business_categories" (
    "id", "businessId", "name", "slug", "createdAt", "updatedAt"
)
SELECT
    md5(p."businessId" || ':category:' || lower(trim(p."category"))),
    p."businessId",
    min(trim(p."category")),
    regexp_replace(lower(min(trim(p."category"))), '[^a-z0-9]+', '-', 'g') || '-' || substr(md5(lower(min(trim(p."category")))), 1, 6),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "products" p
WHERE p."category" IS NOT NULL
  AND trim(p."category") <> ''
  AND lower(trim(p."category")) <> '__new'
GROUP BY p."businessId", lower(trim(p."category"))
ON CONFLICT DO NOTHING;

UPDATE "products" p
SET "categoryId" = c."id",
    "category" = c."name"
FROM "business_categories" c
WHERE c."businessId" = p."businessId"
  AND lower(c."name") = lower(trim(p."category"));

UPDATE "products"
SET "category" = NULL
WHERE lower(trim("category")) = '__new';

-- Every existing product remains valid through a default variant.
INSERT INTO "product_variants" (
    "id", "productId", "name", "optionValues", "active", "stockCount", "sortOrder", "createdAt", "updatedAt"
)
SELECT
    md5(p."id" || ':default-variant'),
    p."id",
    'Default',
    '{}'::jsonb,
    p."status" <> 'ARCHIVED',
    p."stockCount",
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "products" p
WHERE NOT EXISTS (
    SELECT 1 FROM "product_variants" v WHERE v."productId" = p."id"
);

-- Preserve the legacy image relation while introducing ordered mixed media.
INSERT INTO "product_media" (
    "id", "productId", "assetId", "kind", "altText", "sortOrder", "isPrimary", "createdAt", "updatedAt"
)
SELECT
    md5(i."id" || ':product-media'),
    i."productId",
    i."assetId",
    'IMAGE',
    i."altText",
    i."sortOrder",
    i."isPrimary",
    i."createdAt",
    CURRENT_TIMESTAMP
FROM "product_images" i
ON CONFLICT DO NOTHING;
