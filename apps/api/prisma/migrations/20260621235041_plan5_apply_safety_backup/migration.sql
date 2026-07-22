-- AlterTable
ALTER TABLE `Execution` ADD COLUMN `backupId` VARCHAR(191) NULL,
    ADD COLUMN `kind` ENUM('APPLY', 'ROLLBACK') NOT NULL DEFAULT 'APPLY';

-- CreateTable
CREATE TABLE `Backup` (
    `id` VARCHAR(191) NOT NULL,
    `changeRequestId` VARCHAR(191) NOT NULL,
    `targetDatabaseId` VARCHAR(191) NOT NULL,
    `scope` ENUM('SCHEMA_AND_DATA', 'SCHEMA_ONLY') NOT NULL,
    `status` ENUM('SUCCESS', 'PARTIAL', 'FAILED') NOT NULL,
    `location` VARCHAR(191) NOT NULL DEFAULT 'DB',
    `payload` LONGTEXT NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Backup_changeRequestId_idx`(`changeRequestId`),
    INDEX `Backup_targetDatabaseId_idx`(`targetDatabaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Execution_backupId_key` ON `Execution`(`backupId`);

-- AddForeignKey
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_backupId_fkey` FOREIGN KEY (`backupId`) REFERENCES `Backup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Backup` ADD CONSTRAINT `Backup_changeRequestId_fkey` FOREIGN KEY (`changeRequestId`) REFERENCES `ChangeRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Backup` ADD CONSTRAINT `Backup_targetDatabaseId_fkey` FOREIGN KEY (`targetDatabaseId`) REFERENCES `TargetDatabase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

