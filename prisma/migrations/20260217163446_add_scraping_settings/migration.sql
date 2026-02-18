-- CreateTable
CREATE TABLE `scraping_settings` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `min_delay_ms` INTEGER NOT NULL DEFAULT 3000,
    `max_delay_ms` INTEGER NOT NULL DEFAULT 7000,
    `global_timeout_ms` INTEGER NOT NULL DEFAULT 30000,
    `max_retries` INTEGER NOT NULL DEFAULT 3,
    `retry_delay_ms` INTEGER NOT NULL DEFAULT 2000,
    `auto_scrape_on_sync` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scraping_settings_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `scraping_settings` ADD CONSTRAINT `scraping_settings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
