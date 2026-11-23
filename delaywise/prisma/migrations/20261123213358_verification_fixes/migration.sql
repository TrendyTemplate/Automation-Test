-- AlterTable
ALTER TABLE "Message" ADD COLUMN "sendingSince" DATETIME;

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "scanLockToken" TEXT;
