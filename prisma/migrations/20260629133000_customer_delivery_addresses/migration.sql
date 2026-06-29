-- Add arrange-later fulfillment value before using it in later defaults.

ALTER TYPE "FulfillmentType" ADD VALUE IF NOT EXISTS 'ARRANGE_LATER';
