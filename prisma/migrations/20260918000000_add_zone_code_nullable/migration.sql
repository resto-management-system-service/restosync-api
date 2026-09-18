-- Step A of the two-step "add required column" pattern: add the new column
-- as nullable, backfill every existing zone, then create the uniqueness index.
-- The follow-up migration (require_zone_code) sets the column NOT NULL.

-- AlterTable
ALTER TABLE "zones" ADD COLUMN "code" TEXT;

-- Backfill: give each existing zone a sequential numeric code per restaurant
-- ("1", "2", "3", ...) ordered by sortOrder then createdAt (id breaks ties).
-- ROW_NUMBER() guarantees uniqueness within each restaurant, so the unique
-- index below can be created immediately after.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "restaurantId"
      ORDER BY "sortOrder" ASC, "createdAt" ASC, id ASC
    ) AS rn
  FROM "zones"
)
UPDATE "zones" AS z
SET "code" = ranked.rn::text
FROM ranked
WHERE z.id = ranked.id;

-- CreateIndex
CREATE UNIQUE INDEX "zones_restaurantId_code_key" ON "zones"("restaurantId", "code");
