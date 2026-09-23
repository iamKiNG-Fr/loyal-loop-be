-- Additive only; prepared locally. Apply during an authorized release before this API version.
ALTER TABLE "customer_cart_groups" ADD COLUMN "giftOccasion" TEXT;
ALTER TABLE "order_requests" ADD COLUMN "giftOccasion" TEXT;
ALTER TABLE "deliveries" ADD COLUMN "giftOccasion" TEXT;
