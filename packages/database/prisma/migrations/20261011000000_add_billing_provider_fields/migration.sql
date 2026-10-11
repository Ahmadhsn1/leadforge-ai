-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "externalSubscriptionId" TEXT,
ADD COLUMN     "lastEventAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_externalSubscriptionId_key" ON "subscriptions"("externalSubscriptionId");
