-- CreateTable
CREATE TABLE `TargetDatabase` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `env` ENUM('DEV', 'STAGING', 'PROD') NOT NULL,
    `dbType` ENUM('MYSQL', 'POSTGRES', 'MARIADB', 'ORACLE') NOT NULL DEFAULT 'MYSQL',
    `host` VARCHAR(191) NOT NULL,
    `port` INTEGER NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordEnc` TEXT NOT NULL,
    `database` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TargetDatabase_env_idx`(`env`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Execution` (
    `id` VARCHAR(191) NOT NULL,
    `changeRequestId` VARCHAR(191) NOT NULL,
    `targetDatabaseId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `triggeredById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Execution_changeRequestId_idx`(`changeRequestId`),
    INDEX `Execution_targetDatabaseId_idx`(`targetDatabaseId`),
    INDEX `Execution_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExecutionStep` (
    `id` VARCHAR(191) NOT NULL,
    `executionId` VARCHAR(191) NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `error` TEXT NULL,
    `rowsAffected` INTEGER NULL,
    `durationMs` INTEGER NULL,

    INDEX `ExecutionStep_executionId_idx`(`executionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_changeRequestId_fkey` FOREIGN KEY (`changeRequestId`) REFERENCES `ChangeRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_targetDatabaseId_fkey` FOREIGN KEY (`targetDatabaseId`) REFERENCES `TargetDatabase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Execution` ADD CONSTRAINT `Execution_triggeredById_fkey` FOREIGN KEY (`triggeredById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExecutionStep` ADD CONSTRAINT `ExecutionStep_executionId_fkey` FOREIGN KEY (`executionId`) REFERENCES `Execution`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
