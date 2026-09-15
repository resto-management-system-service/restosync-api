-- DropIndex
DROP INDEX "tables_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "tables_restaurantId_name_key" ON "tables"("restaurantId", "name");
