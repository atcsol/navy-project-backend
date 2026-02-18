-- AlterTable
ALTER TABLE `opportunities` ADD COLUMN `actual_delivery` DATETIME(3) NULL,
    ADD COLUMN `bid_notes` TEXT NULL,
    ADD COLUMN `bid_price` DECIMAL(12, 2) NULL,
    ADD COLUMN `bid_result_at` DATETIME(3) NULL,
    ADD COLUMN `bid_submitted_at` DATETIME(3) NULL,
    ADD COLUMN `cancellation_source` VARCHAR(191) NULL,
    ADD COLUMN `cancelled_at` DATETIME(3) NULL,
    ADD COLUMN `delivery_on_time` BOOLEAN NULL,
    ADD COLUMN `expected_delivery` DATETIME(3) NULL,
    ADD COLUMN `purchase_date` DATETIME(3) NULL,
    ADD COLUMN `purchase_order_no` VARCHAR(191) NULL,
    ADD COLUMN `purchase_status` VARCHAR(191) NULL,
    ADD COLUMN `quotation_phase` VARCHAR(191) NULL,
    ADD COLUMN `status_history` JSON NULL,
    ADD COLUMN `supplier_contact` VARCHAR(191) NULL,
    ADD COLUMN `supplier_name` VARCHAR(191) NULL,
    MODIFY `status` VARCHAR(191) NOT NULL DEFAULT 'nao_analisada';

-- CreateTable
CREATE TABLE `opportunity_alerts` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `opportunity_id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `metadata` JSON NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_alerts_user_read`(`user_id`, `is_read`),
    INDEX `idx_alerts_user_date`(`user_id`, `created_at`),
    INDEX `idx_alerts_opportunity`(`opportunity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `opportunity_alerts` ADD CONSTRAINT `opportunity_alerts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opportunity_alerts` ADD CONSTRAINT `opportunity_alerts_opportunity_id_fkey` FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
