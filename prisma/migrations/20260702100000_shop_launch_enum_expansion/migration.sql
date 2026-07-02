-- Expand lifecycle and activity enums in their own transaction so the new
-- values are available to the following launch-fields migration.

ALTER TYPE "StoreStatus" ADD VALUE IF NOT EXISTS 'SETTING_UP';
ALTER TYPE "StoreStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';

ALTER TYPE "ActivityEventType" ADD VALUE IF NOT EXISTS 'SHOP_LAUNCH_SCHEDULED';
ALTER TYPE "ActivityEventType" ADD VALUE IF NOT EXISTS 'SHOP_LAUNCH_UPDATED';
ALTER TYPE "ActivityEventType" ADD VALUE IF NOT EXISTS 'SHOP_OPENED';
ALTER TYPE "ActivityEventType" ADD VALUE IF NOT EXISTS 'SHOP_PAUSED';
