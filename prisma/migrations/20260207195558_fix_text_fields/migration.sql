-- AlterTable
ALTER TABLE `gmail_accounts` MODIFY `access_token` TEXT NOT NULL,
    MODIFY `refresh_token` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `opportunities` MODIFY `source_url` TEXT NULL;

-- AlterTable
ALTER TABLE `users` MODIFY `refresh_token` TEXT NULL;
