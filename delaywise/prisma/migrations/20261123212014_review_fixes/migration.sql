-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "scanLockUntil" DATETIME;

-- CreateTable
CREATE TABLE "RedactedOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL DEFAULT 'ai',
    "discountCode" TEXT,
    "discountPercent" INTEGER,
    "discountCreated" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "scheduledFor" DATETIME,
    "discountRedeemedAt" DATETIME,
    "discountOrderName" TEXT,
    "discountOrderValue" REAL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "Message_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("body", "createdAt", "discountCode", "discountOrderName", "discountOrderValue", "discountRedeemedAt", "error", "generatedBy", "id", "kind", "language", "scheduledFor", "sentAt", "shipmentId", "shop", "status", "subject") SELECT "body", "createdAt", "discountCode", "discountOrderName", "discountOrderValue", "discountRedeemedAt", "error", "generatedBy", "id", "kind", "language", "scheduledFor", "sentAt", "shipmentId", "shop", "status", "subject" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE INDEX "Message_shop_status_idx" ON "Message"("shop", "status");
CREATE UNIQUE INDEX "Message_shipmentId_kind_key" ON "Message"("shipmentId", "kind");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RedactedOrder_shop_orderId_key" ON "RedactedOrder"("shop", "orderId");
