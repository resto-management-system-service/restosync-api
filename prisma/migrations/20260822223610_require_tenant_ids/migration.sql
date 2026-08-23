/*
  Warnings:

  - Made the column `restaurantId` on table `audit_logs` required. This step will fail if there are existing NULL values in that column.
  - Made the column `restaurantId` on table `cash_register_sessions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `restaurantId` on table `categories` required. This step will fail if there are existing NULL values in that column.
  - Made the column `restaurantId` on table `inventory_items` required. This step will fail if there are existing NULL values in that column.
  - Made the column `restaurantId` on table `menu_items` required. This step will fail if there are existing NULL values in that column.
  - Made the column `restaurantId` on table `order_items` required. This step will fail if there are existing NULL values in that column.
  - Made the column `restaurantId` on table `orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `restaurantId` on table `payments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `restaurantId` on table `reservations` required. This step will fail if there are existing NULL values in that column.
  - Made the column `restaurantId` on table `stock_adjustments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `restaurantId` on table `tables` required. This step will fail if there are existing NULL values in that column.
  - Made the column `restaurantId` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "audit_logs" ALTER COLUMN "restaurantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "cash_register_sessions" ALTER COLUMN "restaurantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "categories" ALTER COLUMN "restaurantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "inventory_items" ALTER COLUMN "restaurantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "menu_items" ALTER COLUMN "restaurantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "order_items" ALTER COLUMN "restaurantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "restaurantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "restaurantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "reservations" ALTER COLUMN "restaurantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "stock_adjustments" ALTER COLUMN "restaurantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "tables" ALTER COLUMN "restaurantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "restaurantId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_register_sessions" ADD CONSTRAINT "cash_register_sessions_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
