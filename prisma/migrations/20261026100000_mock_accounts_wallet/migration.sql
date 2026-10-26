ALTER TABLE "Order" ADD COLUMN "checkoutKey" TEXT;
ALTER TABLE "Order" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'live';
CREATE UNIQUE INDEX "Order_checkoutKey_key" ON "Order"("checkoutKey");
CREATE TABLE "MockAccount" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "provider" TEXT NOT NULL,
 "username" TEXT NOT NULL,
 "passwordHash" TEXT NOT NULL,
 "balanceFen" INTEGER NOT NULL DEFAULT 0 CHECK ("balanceFen" >= 0 AND "balanceFen" <= 100000000),
 "userId" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "MockAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MockAccount_userId_key" ON "MockAccount"("userId");
CREATE UNIQUE INDEX "MockAccount_provider_username_key" ON "MockAccount"("provider", "username");
