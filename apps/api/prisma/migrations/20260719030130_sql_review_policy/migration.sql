-- AlterTable
ALTER TABLE `audit_log` MODIFY `action` ENUM('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'ACCESS_DENIED', 'USER_CREATED', 'USER_PROFILE_UPDATED', 'CR_CREATED', 'CR_SUBMITTED', 'CR_REVIEWED', 'CR_APPROVED', 'CR_ASSIGNEES_CHANGED', 'CR_APPLIED', 'CR_ROLLED_BACK', 'TARGET_DB_CREATED', 'TARGET_DB_UPDATED', 'TARGET_DB_DELETED', 'SQL_POLICY_UPDATED') NOT NULL,
    MODIFY `targetType` ENUM('CHANGE_REQUEST', 'USER', 'TARGET_DATABASE', 'EXECUTION', 'AUTH', 'SQL_REVIEW_POLICY') NOT NULL;

-- CreateTable
CREATE TABLE `sql_review_rule` (
    `id` VARCHAR(191) NOT NULL,
    `env` ENUM('DEV', 'STAGING', 'PROD') NOT NULL,
    `ruleKey` VARCHAR(191) NOT NULL,
    `level` ENUM('DISABLED', 'INFO', 'WARN', 'BLOCK') NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sql_review_rule_env_idx`(`env`),
    UNIQUE INDEX `sql_review_rule_env_ruleKey_key`(`env`, `ruleKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- InsertData: default SQL review policy (21 rows, reproduces existing hardcoded behavior)
INSERT INTO `sql_review_rule` (`id`,`env`,`ruleKey`,`level`,`updatedAt`) VALUES
 ('srr_dev_drop_database','DEV','DROP_DATABASE','WARN',NOW(3)),
 ('srr_dev_drop_table','DEV','DROP_TABLE','WARN',NOW(3)),
 ('srr_dev_truncate','DEV','TRUNCATE','WARN',NOW(3)),
 ('srr_dev_delete_no_where','DEV','DELETE_WITHOUT_WHERE','WARN',NOW(3)),
 ('srr_dev_update_no_where','DEV','UPDATE_WITHOUT_WHERE','WARN',NOW(3)),
 ('srr_dev_alter_drop_column','DEV','ALTER_DROP_COLUMN','WARN',NOW(3)),
 ('srr_dev_drop_index','DEV','DROP_INDEX','INFO',NOW(3)),
 ('srr_stg_drop_database','STAGING','DROP_DATABASE','BLOCK',NOW(3)),
 ('srr_stg_drop_table','STAGING','DROP_TABLE','BLOCK',NOW(3)),
 ('srr_stg_truncate','STAGING','TRUNCATE','BLOCK',NOW(3)),
 ('srr_stg_delete_no_where','STAGING','DELETE_WITHOUT_WHERE','BLOCK',NOW(3)),
 ('srr_stg_update_no_where','STAGING','UPDATE_WITHOUT_WHERE','BLOCK',NOW(3)),
 ('srr_stg_alter_drop_column','STAGING','ALTER_DROP_COLUMN','WARN',NOW(3)),
 ('srr_stg_drop_index','STAGING','DROP_INDEX','INFO',NOW(3)),
 ('srr_prod_drop_database','PROD','DROP_DATABASE','BLOCK',NOW(3)),
 ('srr_prod_drop_table','PROD','DROP_TABLE','BLOCK',NOW(3)),
 ('srr_prod_truncate','PROD','TRUNCATE','BLOCK',NOW(3)),
 ('srr_prod_delete_no_where','PROD','DELETE_WITHOUT_WHERE','BLOCK',NOW(3)),
 ('srr_prod_update_no_where','PROD','UPDATE_WITHOUT_WHERE','BLOCK',NOW(3)),
 ('srr_prod_alter_drop_column','PROD','ALTER_DROP_COLUMN','WARN',NOW(3)),
 ('srr_prod_drop_index','PROD','DROP_INDEX','INFO',NOW(3));
