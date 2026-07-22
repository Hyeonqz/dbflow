import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const users = [
    { email: 'dev@dbflow.io', name: '개발자', department: '개발팀', role: 'DEVELOPER' as const },
    { email: 'dba@dbflow.io', name: '검토자', department: 'DBA팀', role: 'REVIEWER' as const },
    { email: 'approver@dbflow.io', name: '결재자', department: '인프라팀', role: 'APPROVER' as const },
    { email: 'admin@dbflow.io', name: '관리자', department: '운영팀', role: 'ADMIN' as const },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { department: u.department, role: u.role },
      create: { ...u, passwordHash: await argon2.hash('password1234') },
    });
  }

  const LEVELS = {
    DEV:     { DROP_DATABASE:'WARN', DROP_TABLE:'WARN', TRUNCATE:'WARN', DELETE_WITHOUT_WHERE:'WARN', UPDATE_WITHOUT_WHERE:'WARN', ALTER_DROP_COLUMN:'WARN', DROP_INDEX:'INFO' },
    STAGING: { DROP_DATABASE:'BLOCK', DROP_TABLE:'BLOCK', TRUNCATE:'BLOCK', DELETE_WITHOUT_WHERE:'BLOCK', UPDATE_WITHOUT_WHERE:'BLOCK', ALTER_DROP_COLUMN:'WARN', DROP_INDEX:'INFO' },
    PROD:    { DROP_DATABASE:'BLOCK', DROP_TABLE:'BLOCK', TRUNCATE:'BLOCK', DELETE_WITHOUT_WHERE:'BLOCK', UPDATE_WITHOUT_WHERE:'BLOCK', ALTER_DROP_COLUMN:'WARN', DROP_INDEX:'INFO' },
  } as const;
  for (const [env, rules] of Object.entries(LEVELS)) {
    for (const [ruleKey, level] of Object.entries(rules)) {
      await prisma.sqlReviewRule.upsert({
        where: { env_ruleKey: { env: env as any, ruleKey } },
        update: { level: level as any },
        create: { env: env as any, ruleKey, level: level as any },
      });
    }
  }

  for (const env of ['DEV', 'STAGING', 'PROD'] as const) {
    await prisma.approvalPolicy.upsert({ where: { env }, update: {}, create: { env, requiredApprovals: 1 } });
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
