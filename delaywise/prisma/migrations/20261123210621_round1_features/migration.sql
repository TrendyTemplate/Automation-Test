-- AlterTable
ALTER TABLE "Message" ADD COLUMN "discountOrderName" TEXT;
ALTER TABLE "Message" ADD COLUMN "discountOrderValue" REAL;
ALTER TABLE "Message" ADD COLUMN "discountRedeemedAt" DATETIME;
ALTER TABLE "Message" ADD COLUMN "scheduledFor" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "orderValue" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fulfillmentId" TEXT NOT NULL,
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "customerLocale" TEXT,
    "destinationCountry" TEXT,
    "shippedAt" DATETIME NOT NULL,
    "expectedBy" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastEventAt" DATETIME,
    "lastCheckedAt" DATETIME,
    "deliveredAt" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'shopify',
    "externalTrackerId" TEXT,
    "risk" TEXT NOT NULL DEFAULT 'none',
    "riskReason" TEXT,
    "riskSince" DATETIME,
    "notifiedRisk" TEXT,
    "followUpSent" BOOLEAN NOT NULL DEFAULT false,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "excludedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Shipment" ("carrier", "createdAt", "currency", "customerLocale", "deliveredAt", "destinationCountry", "expectedBy", "externalTrackerId", "fulfillmentId", "id", "lastCheckedAt", "lastEventAt", "notifiedRisk", "orderId", "orderName", "orderValue", "risk", "riskReason", "riskSince", "shippedAt", "shop", "source", "status", "trackingNumber", "trackingUrl", "updatedAt") SELECT "carrier", "createdAt", "currency", "customerLocale", "deliveredAt", "destinationCountry", "expectedBy", "externalTrackerId", "fulfillmentId", "id", "lastCheckedAt", "lastEventAt", "notifiedRisk", "orderId", "orderName", "orderValue", "risk", "riskReason", "riskSince", "shippedAt", "shop", "source", "status", "trackingNumber", "trackingUrl", "updatedAt" FROM "Shipment";
DROP TABLE "Shipment";
ALTER TABLE "new_Shipment" RENAME TO "Shipment";
CREATE INDEX "Shipment_shop_risk_idx" ON "Shipment"("shop", "risk");
CREATE INDEX "Shipment_shop_status_idx" ON "Shipment"("shop", "status");
CREATE UNIQUE INDEX "Shipment_shop_fulfillmentId_key" ON "Shipment"("shop", "fulfillmentId");
CREATE TABLE "new_ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "mode" TEXT NOT NULL DEFAULT 'approval',
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "shopCountry" TEXT,
    "shopName" TEXT,
    "brandName" TEXT,
    "replyToEmail" TEXT,
    "signature" TEXT,
    "defaultTransitDays" INTEGER NOT NULL DEFAULT 5,
    "graceHours" INTEGER NOT NULL DEFAULT 24,
    "stallHours" INTEGER NOT NULL DEFAULT 72,
    "notifyOnStall" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnDelay" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnException" BOOLEAN NOT NULL DEFAULT true,
    "compensationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "compensationPercent" INTEGER NOT NULL DEFAULT 10,
    "compensationMinDaysLate" INTEGER NOT NULL DEFAULT 3,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "brandInstructions" TEXT,
    "excludedTags" TEXT,
    "excludedCountries" TEXT,
    "minOrderValue" REAL NOT NULL DEFAULT 0,
    "timezone" TEXT,
    "sendWindowStart" INTEGER NOT NULL DEFAULT 8,
    "sendWindowEnd" INTEGER NOT NULL DEFAULT 20,
    "carrierTransitDays" TEXT,
    "deliveredFollowUp" BOOLEAN NOT NULL DEFAULT true,
    "merchantDigest" BOOLEAN NOT NULL DEFAULT true,
    "digestEmail" TEXT,
    "lastDigestAt" DATETIME,
    "flowTriggerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastScanAt" DATETIME,
    "lastScanError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopSettings" ("brandName", "compensationEnabled", "compensationMinDaysLate", "compensationPercent", "createdAt", "defaultTransitDays", "graceHours", "mode", "notifyOnDelay", "notifyOnException", "notifyOnStall", "onboardingCompleted", "plan", "replyToEmail", "shop", "shopCountry", "shopName", "signature", "stallHours", "tone", "updatedAt") SELECT "brandName", "compensationEnabled", "compensationMinDaysLate", "compensationPercent", "createdAt", "defaultTransitDays", "graceHours", "mode", "notifyOnDelay", "notifyOnException", "notifyOnStall", "onboardingCompleted", "plan", "replyToEmail", "shop", "shopCountry", "shopName", "signature", "stallHours", "tone", "updatedAt" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
