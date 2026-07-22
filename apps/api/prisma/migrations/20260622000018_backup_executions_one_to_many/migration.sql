-- Convert Execution.backupId from a 1:1 (unique) to a 1:many relation so a
-- backup can be referenced by both its APPLY execution and later ROLLBACKs.
-- The unique index backs the FK, so drop the FK first, swap the index, re-add.
ALTER TABLE `Execution` DROP FOREIGN KEY `Execution_backupId_fkey`;

DROP INDEX `Execution_backupId_key` ON `Execution`;

CREATE INDEX `Execution_backupId_idx` ON `Execution`(`backupId`);

ALTER TABLE `Execution` ADD CONSTRAINT `Execution_backupId_fkey` FOREIGN KEY (`backupId`) REFERENCES `Backup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
