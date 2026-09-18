/*
  Warnings:

  - Made the column `code` on table `zones` required. This step will fail if
    there are existing NULL values in that column (i.e. if the backfill in
    add_zone_code_nullable did not run).

*/
-- AlterTable
ALTER TABLE "zones" ALTER COLUMN "code" SET NOT NULL;
