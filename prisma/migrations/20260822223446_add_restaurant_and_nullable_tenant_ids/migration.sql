-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "restaurantId" TEXT;

-- AlterTable
ALTER TABLE "cash_register_sessions" ADD COLUMN     "restaurantId" TEXT;

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "restaurantId" TEXT;

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "restaurantId" TEXT;

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "restaurantId" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "restaurantId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "restaurantId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "restaurantId" TEXT;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "restaurantId" TEXT;

-- AlterTable
ALTER TABLE "stock_adjustments" ADD COLUMN     "restaurantId" TEXT;

-- AlterTable
ALTER TABLE "tables" ADD COLUMN     "restaurantId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "restaurantId" TEXT;

-- CreateTable
CREATE TABLE "restaurants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Lima',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_restaurantId_idx" ON "audit_logs"("restaurantId");

-- CreateIndex
CREATE INDEX "cash_register_sessions_restaurantId_idx" ON "cash_register_sessions"("restaurantId");

-- CreateIndex
CREATE INDEX "categories_restaurantId_idx" ON "categories"("restaurantId");

-- CreateIndex
CREATE INDEX "inventory_items_restaurantId_idx" ON "inventory_items"("restaurantId");

-- CreateIndex
CREATE INDEX "menu_items_restaurantId_idx" ON "menu_items"("restaurantId");

-- CreateIndex
CREATE INDEX "order_items_restaurantId_idx" ON "order_items"("restaurantId");

-- CreateIndex
CREATE INDEX "orders_restaurantId_idx" ON "orders"("restaurantId");

-- CreateIndex
CREATE INDEX "payments_restaurantId_idx" ON "payments"("restaurantId");

-- CreateIndex
CREATE INDEX "reservations_restaurantId_idx" ON "reservations"("restaurantId");

-- CreateIndex
CREATE INDEX "stock_adjustments_restaurantId_idx" ON "stock_adjustments"("restaurantId");

-- CreateIndex
CREATE INDEX "tables_restaurantId_idx" ON "tables"("restaurantId");

-- CreateIndex
CREATE INDEX "users_restaurantId_idx" ON "users"("restaurantId");
