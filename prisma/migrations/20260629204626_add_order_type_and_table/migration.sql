-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'TAKEAWAY');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "type" "OrderType" NOT NULL DEFAULT 'DINE_IN',
                   ADD COLUMN "table" TEXT;
