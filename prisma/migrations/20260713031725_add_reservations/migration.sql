-- AlterEnum
ALTER TYPE "TableStatus" ADD VALUE 'RESERVED';

-- CreateEnum
CREATE TYPE "ReservationType" AS ENUM ('WITH_PREORDER', 'DEPOSIT_ONLY', 'INFORMAL');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SEATED', 'NO_SHOW', 'CANCELLED');

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "partySize" INTEGER NOT NULL,
    "reservedFor" TIMESTAMP(3) NOT NULL,
    "toleranceMinutes" INTEGER NOT NULL DEFAULT 10,
    "allergies" TEXT,
    "specialOccasion" TEXT,
    "reservationType" "ReservationType" NOT NULL,
    "tableId" TEXT,
    "orderId" TEXT,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "depositConfirmedBy" TEXT,
    "depositConfirmedAt" TIMESTAMP(3),
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reservations_orderId_key" ON "reservations"("orderId");

-- CreateIndex
CREATE INDEX "reservations_status_idx" ON "reservations"("status");

-- CreateIndex
CREATE INDEX "reservations_reservedFor_idx" ON "reservations"("reservedFor");

-- CreateIndex
CREATE INDEX "reservations_tableId_idx" ON "reservations"("tableId");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
