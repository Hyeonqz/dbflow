/*
  Warnings:

  - You are about to drop the column `approverId` on the `ChangeRequest` table. All the data in the column will be lost.

*/

-- AlterTable (audit enums; unrelated to approverId backfill ordering)
ALTER TABLE `audit_log` MODIFY `action` ENUM('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'ACCESS_DENIED', 'USER_CREATED', 'USER_PROFILE_UPDATED', 'CR_CREATED', 'CR_SUBMITTED', 'CR_REVIEWED', 'CR_APPROVED', 'CR_ASSIGNEES_CHANGED', 'CR_APPLIED', 'CR_ROLLED_BACK', 'TARGET_DB_CREATED', 'TARGET_DB_UPDATED', 'TARGET_DB_DELETED', 'SQL_POLICY_UPDATED', 'APPROVAL_POLICY_UPDATED') NOT NULL,
    MODIFY `targetType` ENUM('CHANGE_REQUEST', 'USER', 'TARGET_DATABASE', 'EXECUTION', 'AUTH', 'SQL_REVIEW_POLICY', 'APPROVAL_POLICY') NOT NULL;

-- 1) CreateTable
CREATE TABLE `approval_policy` (
    `id` VARCHAR(191) NOT NULL,
    `env` ENUM('DEV', 'STAGING', 'PROD') NOT NULL,
    `requiredApprovals` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `approval_policy_env_key`(`env`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 1) CreateTable
CREATE TABLE `change_request_approver` (
    `id` VARCHAR(191) NOT NULL,
    `changeRequestId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL,
    `decision` ENUM('APPROVE', 'REJECT') NULL,
    `comment` TEXT NULL,
    `decidedAt` DATETIME(3) NULL,

    INDEX `change_request_approver_userId_idx`(`userId`),
    UNIQUE INDEX `change_request_approver_changeRequestId_userId_key`(`changeRequestId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `change_request_approver` ADD CONSTRAINT `change_request_approver_changeRequestId_fkey` FOREIGN KEY (`changeRequestId`) REFERENCES `ChangeRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_request_approver` ADD CONSTRAINT `change_request_approver_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) 백필: 기존 단일 결재자를 조인 1행으로 (DROP 이전!)
INSERT INTO `change_request_approver` (`id`,`changeRequestId`,`userId`,`order`,`decision`,`comment`,`decidedAt`)
SELECT CONCAT('cra_', `id`), `id`, `approverId`, 0, NULL, NULL, NULL
FROM `ChangeRequest` WHERE `approverId` IS NOT NULL;

-- 3) ChangeRequest.approverId FK/컬럼 DROP (백필 이후로 이동)
-- DropForeignKey
ALTER TABLE `ChangeRequest` DROP FOREIGN KEY `ChangeRequest_approverId_fkey`;

-- AlterTable
ALTER TABLE `ChangeRequest` DROP COLUMN `approverId`;

-- 4) 정책 3행(고정 id, 기본 1)
INSERT INTO `approval_policy` (`id`,`env`,`requiredApprovals`,`updatedAt`) VALUES
 ('ap_dev','DEV',1,NOW(3)),
 ('ap_staging','STAGING',1,NOW(3)),
 ('ap_prod','PROD',1,NOW(3));
