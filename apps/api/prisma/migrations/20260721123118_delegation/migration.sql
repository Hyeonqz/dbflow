-- AlterTable
ALTER TABLE `audit_log` MODIFY `action` ENUM('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'ACCESS_DENIED', 'USER_CREATED', 'USER_PROFILE_UPDATED', 'CR_CREATED', 'CR_SUBMITTED', 'CR_REVIEWED', 'CR_APPROVED', 'CR_ASSIGNEES_CHANGED', 'CR_APPLIED', 'CR_ROLLED_BACK', 'TARGET_DB_CREATED', 'TARGET_DB_UPDATED', 'TARGET_DB_DELETED', 'SQL_POLICY_UPDATED', 'APPROVAL_POLICY_UPDATED', 'APPLY_WINDOW_UPDATED', 'FREEZE_UPDATED', 'DELEGATION_UPDATED') NOT NULL,
    MODIFY `targetType` ENUM('CHANGE_REQUEST', 'USER', 'TARGET_DATABASE', 'EXECUTION', 'AUTH', 'SQL_REVIEW_POLICY', 'APPROVAL_POLICY', 'APPLY_SCHEDULE', 'DELEGATION') NOT NULL;

-- AlterTable
ALTER TABLE `change_request_approver` ADD COLUMN `decidedById` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `delegation` (
    `id` VARCHAR(191) NOT NULL,
    `delegatorId` VARCHAR(191) NOT NULL,
    `delegateId` VARCHAR(191) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `delegation_delegatorId_idx`(`delegatorId`),
    INDEX `delegation_delegateId_idx`(`delegateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `change_request_approver` ADD CONSTRAINT `change_request_approver_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delegation` ADD CONSTRAINT `delegation_delegatorId_fkey` FOREIGN KEY (`delegatorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delegation` ADD CONSTRAINT `delegation_delegateId_fkey` FOREIGN KEY (`delegateId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delegation` ADD CONSTRAINT `delegation_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
