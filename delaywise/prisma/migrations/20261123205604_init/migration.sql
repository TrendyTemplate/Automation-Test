-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

-- CreateTable
CREATE TABLE "ShopSettings" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Shipment" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL DEFAULT 'ai',
    "discountCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "Message_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UsageMonth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "shipmentsTracked" INTEGER NOT NULL DEFAULT 0,
    "paidLookups" INTEGER NOT NULL DEFAULT 0,
    "messagesSent" INTEGER NOT NULL DEFAULT 0,
    "overageBilled" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE INDEX "Shipment_shop_risk_idx" ON "Shipment"("shop", "risk");

-- CreateIndex
CREATE INDEX "Shipment_shop_status_idx" ON "Shipment"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shop_fulfillmentId_key" ON "Shipment"("shop", "fulfillmentId");

-- CreateIndex
CREATE INDEX "Message_shop_status_idx" ON "Message"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UsageMonth_shop_month_key" ON "UsageMonth"("shop", "month");
