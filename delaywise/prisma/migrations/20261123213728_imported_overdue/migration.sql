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
    "importedOverdue" BOOLEAN NOT NULL DEFAULT false,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "excludedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Shipment" ("carrier", "createdAt", "currency", "customerLocale", "deliveredAt", "destinationCountry", "excluded", "excludedReason", "expectedBy", "externalTrackerId", "followUpSent", "fulfillmentId", "id", "lastCheckedAt", "lastEventAt", "notifiedRisk", "orderId", "orderName", "orderValue", "risk", "riskReason", "riskSince", "shippedAt", "shop", "source", "status", "trackingNumber", "trackingUrl", "updatedAt") SELECT "carrier", "createdAt", "currency", "customerLocale", "deliveredAt", "destinationCountry", "excluded", "excludedReason", "expectedBy", "externalTrackerId", "followUpSent", "fulfillmentId", "id", "lastCheckedAt", "lastEventAt", "notifiedRisk", "orderId", "orderName", "orderValue", "risk", "riskReason", "riskSince", "shippedAt", "shop", "source", "status", "trackingNumber", "trackingUrl", "updatedAt" FROM "Shipment";
DROP TABLE "Shipment";
ALTER TABLE "new_Shipment" RENAME TO "Shipment";
CREATE INDEX "Shipment_shop_risk_idx" ON "Shipment"("shop", "risk");
CREATE INDEX "Shipment_shop_status_idx" ON "Shipment"("shop", "status");
CREATE UNIQUE INDEX "Shipment_shop_fulfillmentId_key" ON "Shipment"("shop", "fulfillmentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
