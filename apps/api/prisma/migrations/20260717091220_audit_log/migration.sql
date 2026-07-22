-- CreateTable
CREATE TABLE `audit_log` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actorId` VARCHAR(191) NULL,
    `actorName` VARCHAR(191) NULL,
    `actorRole` VARCHAR(191) NULL,
    `actorDept` VARCHAR(191) NULL,
    `action` ENUM('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'ACCESS_DENIED', 'USER_CREATED', 'USER_PROFILE_UPDATED', 'CR_CREATED', 'CR_SUBMITTED', 'CR_REVIEWED', 'CR_APPROVED', 'CR_ASSIGNEES_CHANGED', 'CR_APPLIED', 'CR_ROLLED_BACK', 'TARGET_DB_CREATED', 'TARGET_DB_UPDATED', 'TARGET_DB_DELETED') NOT NULL,
    `targetType` ENUM('CHANGE_REQUEST', 'USER', 'TARGET_DATABASE', 'EXECUTION', 'AUTH') NOT NULL,
    `targetId` VARCHAR(191) NULL,
    `summary` TEXT NOT NULL,
    `metadata` JSON NULL,
    `outcome` ENUM('SUCCESS', 'FAILURE') NOT NULL DEFAULT 'SUCCESS',
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,

    INDEX `audit_log_createdAt_idx`(`createdAt`),
    INDEX `audit_log_actorId_idx`(`actorId`),
    INDEX `audit_log_action_idx`(`action`),
    INDEX `audit_log_targetType_targetId_idx`(`targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Tamper-blocking triggers: audit_log is append-only
DROP TRIGGER IF EXISTS audit_log_no_update;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON `audit_log`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';

DROP TRIGGER IF EXISTS audit_log_no_delete;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON `audit_log`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';
