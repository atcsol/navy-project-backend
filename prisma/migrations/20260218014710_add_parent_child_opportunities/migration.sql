-- AlterTable
ALTER TABLE `opportunities` ADD COLUMN `children_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `parent_opportunity_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `idx_opportunities_parent` ON `opportunities`(`parent_opportunity_id`);

-- AddForeignKey
ALTER TABLE `opportunities` ADD CONSTRAINT `opportunities_parent_opportunity_id_fkey` FOREIGN KEY (`parent_opportunity_id`) REFERENCES `opportunities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
