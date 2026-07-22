-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('DEVELOPER', 'REVIEWER', 'APPROVER') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChangeRequest` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `targetEnv` ENUM('DEV', 'STAGING', 'PROD') NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'REVIEW_APPROVED', 'REVIEW_REJECTED', 'FINAL_APPROVED', 'FINAL_REJECTED', 'APPLIED') NOT NULL DEFAULT 'DRAFT',
    `authorId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ChangeRequest_authorId_idx`(`authorId`),
    INDEX `ChangeRequest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChangeRequestFile` (
    `id` VARCHAR(191) NOT NULL,
    `changeRequestId` VARCHAR(191) NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `sqlType` ENUM('DDL', 'DML') NOT NULL,
    `content` TEXT NOT NULL,
    `order` INTEGER NOT NULL,

    INDEX `ChangeRequestFile_changeRequestId_idx`(`changeRequestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StatusHistory` (
    `id` VARCHAR(191) NOT NULL,
    `changeRequestId` VARCHAR(191) NOT NULL,
    `fromStatus` ENUM('DRAFT', 'SUBMITTED', 'REVIEW_APPROVED', 'REVIEW_REJECTED', 'FINAL_APPROVED', 'FINAL_REJECTED', 'APPLIED') NOT NULL,
    `toStatus` ENUM('DRAFT', 'SUBMITTED', 'REVIEW_APPROVED', 'REVIEW_REJECTED', 'FINAL_APPROVED', 'FINAL_REJECTED', 'APPLIED') NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `comment` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StatusHistory_changeRequestId_idx`(`changeRequestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ChangeRequest` ADD CONSTRAINT `ChangeRequest_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChangeRequestFile` ADD CONSTRAINT `ChangeRequestFile_changeRequestId_fkey` FOREIGN KEY (`changeRequestId`) REFERENCES `ChangeRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StatusHistory` ADD CONSTRAINT `StatusHistory_changeRequestId_fkey` FOREIGN KEY (`changeRequestId`) REFERENCES `ChangeRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StatusHistory` ADD CONSTRAINT `StatusHistory_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
