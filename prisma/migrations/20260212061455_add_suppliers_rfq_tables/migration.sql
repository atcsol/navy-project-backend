-- CreateTable
CREATE TABLE `suppliers` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `contact_name` VARCHAR(191) NULL,
    `street` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `zip_code` VARCHAR(191) NULL,
    `country` VARCHAR(191) NOT NULL DEFAULT 'US',
    `tags` JSON NOT NULL,
    `notes` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_suppliers_user_active`(`user_id`, `is_active`),
    INDEX `idx_suppliers_user_name`(`user_id`, `name`),
    UNIQUE INDEX `suppliers_user_id_email_key`(`user_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rfqs` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `gmail_account_id` VARCHAR(191) NOT NULL,
    `opportunity_id` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `reference_number` VARCHAR(191) NULL,
    `email_subject` VARCHAR(191) NOT NULL,
    `email_body` TEXT NOT NULL,
    `opportunity_data` JSON NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'rascunho',
    `sent_at` DATETIME(3) NULL,
    `deadline` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_rfqs_user_status`(`user_id`, `status`),
    INDEX `idx_rfqs_user_created`(`user_id`, `created_at`),
    INDEX `idx_rfqs_opportunity`(`opportunity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rfq_items` (
    `id` VARCHAR(191) NOT NULL,
    `rfq_id` VARCHAR(191) NOT NULL,
    `supplier_id` VARCHAR(191) NOT NULL,
    `email_message_id` VARCHAR(191) NULL,
    `email_thread_id` VARCHAR(191) NULL,
    `sent_at` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pendente',
    `quoted_price` DECIMAL(12, 2) NULL,
    `quoted_delivery_days` INTEGER NULL,
    `quoted_condition` VARCHAR(191) NULL,
    `quoted_notes` TEXT NULL,
    `responded_at` DATETIME(3) NULL,
    `quoted_at` DATETIME(3) NULL,
    `is_selected` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_rfq_items_thread`(`email_thread_id`),
    UNIQUE INDEX `rfq_items_rfq_id_supplier_id_key`(`rfq_id`, `supplier_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rfq_email_templates` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_rfq_email_templates_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rfqs` ADD CONSTRAINT `rfqs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rfqs` ADD CONSTRAINT `rfqs_gmail_account_id_fkey` FOREIGN KEY (`gmail_account_id`) REFERENCES `gmail_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rfqs` ADD CONSTRAINT `rfqs_opportunity_id_fkey` FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rfq_items` ADD CONSTRAINT `rfq_items_rfq_id_fkey` FOREIGN KEY (`rfq_id`) REFERENCES `rfqs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rfq_items` ADD CONSTRAINT `rfq_items_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rfq_email_templates` ADD CONSTRAINT `rfq_email_templates_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
