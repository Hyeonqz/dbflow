/*
  Warnings:

  - Added the required column `department` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `ChangeRequest` ADD COLUMN `approverId` VARCHAR(191) NULL,
    ADD COLUMN `reviewerId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `department` VARCHAR(191) NOT NULL DEFAULT '미지정',
    ADD COLUMN `telegramChatId` VARCHAR(191) NULL,
    MODIFY `role` ENUM('DEVELOPER', 'REVIEWER', 'APPROVER', 'ADMIN') NOT NULL;
ALTER TABLE `User` ALTER COLUMN `department` DROP DEFAULT;

-- CreateIndex
CREATE INDEX `ChangeRequest_reviewerId_idx` ON `ChangeRequest`(`reviewerId`);

-- CreateIndex
CREATE INDEX `ChangeRequest_approverId_idx` ON `ChangeRequest`(`approverId`);

-- AddForeignKey
ALTER TABLE `ChangeRequest` ADD CONSTRAINT `ChangeRequest_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChangeRequest` ADD CONSTRAINT `ChangeRequest_approverId_fkey` FOREIGN KEY (`approverId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
