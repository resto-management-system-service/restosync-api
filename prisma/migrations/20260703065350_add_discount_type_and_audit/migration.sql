-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('FIXED', 'PERCENTAGE');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "discountAppliedAt" TIMESTAMP(3),
ADD COLUMN     "discountAppliedBy" TEXT,
ADD COLUMN     "discountPercent" INTEGER,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "discountType" "DiscountType" NOT NULL DEFAULT 'FIXED';
