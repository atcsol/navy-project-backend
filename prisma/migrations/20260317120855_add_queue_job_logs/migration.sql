-- CreateTable
CREATE TABLE `queue_job_logs` (
    `id` VARCHAR(191) NOT NULL,
    `queue` VARCHAR(191) NOT NULL,
    `job_id` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `opportunity_id` VARCHAR(191) NULL,
    `gmail_account_id` VARCHAR(191) NULL,
    `template_id` VARCHAR(191) NULL,
    `source_url` TEXT NULL,
    `duration_ms` INTEGER NULL,
    `error` TEXT NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_job_logs_queue`(`queue`, `created_at`),
    INDEX `idx_job_logs_opportunity`(`opportunity_id`),
    INDEX `idx_job_logs_status`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
