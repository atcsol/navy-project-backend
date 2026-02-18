-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NULL,
    `refresh_token` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gmail_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `access_token` VARCHAR(191) NOT NULL,
    `refresh_token` VARCHAR(191) NOT NULL,
    `token_expiry` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_sync` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_gmail_accounts_user_active`(`user_id`, `is_active`),
    UNIQUE INDEX `gmail_accounts_user_id_email_key`(`user_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `parsing_templates` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `sender_email` VARCHAR(191) NOT NULL,
    `subject_filter` VARCHAR(191) NULL,
    `email_query` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `extraction_config` JSON NOT NULL,
    `output_schema` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_templates_user_active`(`user_id`, `is_active`),
    INDEX `idx_templates_sender`(`sender_email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `opportunities` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `template_id` VARCHAR(191) NOT NULL,
    `gmail_account_id` VARCHAR(191) NOT NULL,
    `email_message_id` VARCHAR(191) NOT NULL,
    `email_thread_id` VARCHAR(191) NULL,
    `email_date` DATETIME(3) NOT NULL,
    `fingerprint` VARCHAR(191) NOT NULL,
    `solicitation_number` VARCHAR(191) NULL,
    `site` VARCHAR(191) NULL,
    `source_url` VARCHAR(191) NULL,
    `part_number` VARCHAR(191) NULL,
    `manufacturer` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `nsn` VARCHAR(191) NULL,
    `condition` VARCHAR(191) NULL,
    `unit` VARCHAR(191) NULL,
    `quantity` INTEGER NULL,
    `closing_date` DATETIME(3) NULL,
    `delivery_date` DATETIME(3) NULL,
    `max_price` DECIMAL(12, 2) NULL,
    `purchase_price` DECIMAL(12, 2) NULL,
    `profit_margin` DECIMAL(5, 2) NULL,
    `offered_price` DECIMAL(12, 2) NULL,
    `profit_amount` DECIMAL(12, 2) NULL,
    `won_price` DECIMAL(12, 2) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'new',
    `days_until_closing` INTEGER NULL,
    `urgency_level` VARCHAR(191) NULL,
    `is_viewed` BOOLEAN NOT NULL DEFAULT false,
    `viewed_at` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `extracted_data` JSON NOT NULL,
    `scraped_data` JSON NULL,
    `scraped_at` DATETIME(3) NULL,
    `scraping_status` VARCHAR(191) NULL,
    `scraping_error` TEXT NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_opportunities_user_closing`(`user_id`, `closing_date`, `deleted_at`),
    INDEX `idx_opportunities_user_status`(`user_id`, `status`, `deleted_at`),
    INDEX `idx_opportunities_fingerprint`(`user_id`, `fingerprint`),
    INDEX `idx_opportunities_email_id`(`email_message_id`),
    INDEX `idx_opportunities_solicitation`(`solicitation_number`),
    INDEX `idx_opportunities_site`(`site`),
    INDEX `idx_opportunities_nsn`(`nsn`),
    INDEX `idx_opportunities_scraping`(`scraping_status`),
    UNIQUE INDEX `opportunities_user_id_email_message_id_fingerprint_key`(`user_id`, `email_message_id`, `fingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `opportunity_fingerprints` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `fingerprint` VARCHAR(191) NOT NULL,
    `opportunity_id` VARCHAR(191) NULL,
    `action` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_fingerprints_user`(`user_id`),
    INDEX `idx_fingerprints_lookup`(`user_id`, `fingerprint`),
    UNIQUE INDEX `opportunity_fingerprints_user_id_fingerprint_key`(`user_id`, `fingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `web_scraping_configs` (
    `id` VARCHAR(191) NOT NULL,
    `template_id` VARCHAR(191) NOT NULL,
    `is_enabled` BOOLEAN NOT NULL DEFAULT false,
    `url_field` VARCHAR(191) NOT NULL,
    `extraction_rules` JSON NOT NULL,
    `timeout_seconds` INTEGER NOT NULL DEFAULT 30,
    `retry_attempts` INTEGER NOT NULL DEFAULT 3,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `web_scraping_configs_template_id_key`(`template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scraping_domain_configs` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `requires_auth` BOOLEAN NOT NULL DEFAULT false,
    `reason` VARCHAR(191) NULL,
    `timeout_ms` INTEGER NOT NULL DEFAULT 30000,
    `custom_headers` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_domain_configs_user`(`user_id`),
    UNIQUE INDEX `scraping_domain_configs_user_id_domain_key`(`user_id`, `domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `processing_logs` (
    `id` VARCHAR(191) NOT NULL,
    `gmail_account_id` VARCHAR(191) NULL,
    `template_id` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `emails_processed` INTEGER NOT NULL DEFAULT 0,
    `emails_failed` INTEGER NOT NULL DEFAULT 0,
    `opportunities_created` INTEGER NOT NULL DEFAULT 0,
    `duplicates_skipped` INTEGER NOT NULL DEFAULT 0,
    `error_details` JSON NULL,
    `started_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `idx_logs_account`(`gmail_account_id`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_preferences` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `visible_columns` JSON NOT NULL,
    `rows_per_page` INTEGER NOT NULL DEFAULT 50,
    `default_filters` JSON NULL,
    `sync_frequency` INTEGER NOT NULL DEFAULT 60,
    `notifications_enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_preferences_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `gmail_accounts` ADD CONSTRAINT `gmail_accounts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `parsing_templates` ADD CONSTRAINT `parsing_templates_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opportunities` ADD CONSTRAINT `opportunities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opportunities` ADD CONSTRAINT `opportunities_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `parsing_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opportunities` ADD CONSTRAINT `opportunities_gmail_account_id_fkey` FOREIGN KEY (`gmail_account_id`) REFERENCES `gmail_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opportunity_fingerprints` ADD CONSTRAINT `opportunity_fingerprints_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opportunity_fingerprints` ADD CONSTRAINT `opportunity_fingerprints_opportunity_id_fkey` FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `web_scraping_configs` ADD CONSTRAINT `web_scraping_configs_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `parsing_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scraping_domain_configs` ADD CONSTRAINT `scraping_domain_configs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `processing_logs` ADD CONSTRAINT `processing_logs_gmail_account_id_fkey` FOREIGN KEY (`gmail_account_id`) REFERENCES `gmail_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `processing_logs` ADD CONSTRAINT `processing_logs_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `parsing_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_preferences` ADD CONSTRAINT `user_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
