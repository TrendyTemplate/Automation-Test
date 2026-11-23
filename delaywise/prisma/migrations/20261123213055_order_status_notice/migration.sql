-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "extraTransitDays" INTEGER NOT NULL DEFAULT 0,
    "deliveredFollowUp" BOOLEAN NOT NULL DEFAULT true,
    "merchantDigest" BOOLEAN NOT NULL DEFAULT true,
    "digestEmail" TEXT,
    "lastDigestAt" DATETIME,
    "flowTriggerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "orderStatusNotice" BOOLEAN NOT NULL DEFAULT true,
    "klaviyoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "klaviyoApiKeyEnc" TEXT,
    "scanLockUntil" DATETIME,
    "lastScanAt" DATETIME,
    "lastScanError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopSettings" ("brandInstructions", "brandName", "carrierTransitDays", "compensationEnabled", "compensationMinDaysLate", "compensationPercent", "createdAt", "defaultTransitDays", "deliveredFollowUp", "digestEmail", "excludedCountries", "excludedTags", "extraTransitDays", "flowTriggerEnabled", "graceHours", "klaviyoApiKeyEnc", "klaviyoEnabled", "lastDigestAt", "lastScanAt", "lastScanError", "merchantDigest", "minOrderValue", "mode", "notifyOnDelay", "notifyOnException", "notifyOnStall", "onboardingCompleted", "plan", "replyToEmail", "scanLockUntil", "sendWindowEnd", "sendWindowStart", "shop", "shopCountry", "shopName", "signature", "stallHours", "timezone", "tone", "updatedAt") SELECT "brandInstructions", "brandName", "carrierTransitDays", "compensationEnabled", "compensationMinDaysLate", "compensationPercent", "createdAt", "defaultTransitDays", "deliveredFollowUp", "digestEmail", "excludedCountries", "excludedTags", "extraTransitDays", "flowTriggerEnabled", "graceHours", "klaviyoApiKeyEnc", "klaviyoEnabled", "lastDigestAt", "lastScanAt", "lastScanError", "merchantDigest", "minOrderValue", "mode", "notifyOnDelay", "notifyOnException", "notifyOnStall", "onboardingCompleted", "plan", "replyToEmail", "scanLockUntil", "sendWindowEnd", "sendWindowStart", "shop", "shopCountry", "shopName", "signature", "stallHours", "timezone", "tone", "updatedAt" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
