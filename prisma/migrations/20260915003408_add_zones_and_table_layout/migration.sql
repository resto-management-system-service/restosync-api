-- AlterTable
ALTER TABLE "tables" ADD COLUMN     "height" DOUBLE PRECISION,
ADD COLUMN     "positionX" DOUBLE PRECISION,
ADD COLUMN     "positionY" DOUBLE PRECISION,
ADD COLUMN     "shape" TEXT DEFAULT 'rounded',
ADD COLUMN     "width" DOUBLE PRECISION,
ADD COLUMN     "zoneId" TEXT;

-- CreateTable
CREATE TABLE "zones" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zones_restaurantId_idx" ON "zones"("restaurantId");

-- CreateIndex
CREATE INDEX "tables_zoneId_idx" ON "tables"("zoneId");

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
