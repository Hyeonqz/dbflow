import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

const DEMO_USERS = [
  { email: 'dev@dbflow.io', name: '개발자', department: '개발팀', role: 'DEVELOPER' as const },
  { email: 'dba@dbflow.io', name: '검토자', department: 'DBA팀', role: 'REVIEWER' as const },
  { email: 'approver@dbflow.io', name: '결재자', department: '인프라팀', role: 'APPROVER' as const },
  { email: 'admin@dbflow.io', name: '관리자', department: '운영팀', role: 'ADMIN' as const },
];

const DEMO_RULE_LEVELS = {
  DEV:     { DROP_DATABASE: 'WARN', DROP_TABLE: 'WARN', TRUNCATE: 'WARN', DELETE_WITHOUT_WHERE: 'WARN', UPDATE_WITHOUT_WHERE: 'WARN', ALTER_DROP_COLUMN: 'WARN', DROP_INDEX: 'INFO' },
  STAGING: { DROP_DATABASE: 'BLOCK', DROP_TABLE: 'BLOCK', TRUNCATE: 'BLOCK', DELETE_WITHOUT_WHERE: 'BLOCK', UPDATE_WITHOUT_WHERE: 'BLOCK', ALTER_DROP_COLUMN: 'WARN', DROP_INDEX: 'INFO' },
  PROD:    { DROP_DATABASE: 'BLOCK', DROP_TABLE: 'BLOCK', TRUNCATE: 'BLOCK', DELETE_WITHOUT_WHERE: 'BLOCK', UPDATE_WITHOUT_WHERE: 'BLOCK', ALTER_DROP_COLUMN: 'WARN', DROP_INDEX: 'INFO' },
} as const;

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Bootstrap');

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.createAdminFromEnv();
    if (process.env.DBFLOW_DEMO === 'true') await this.seedDemo();
    await this.assertAnyUserExists();
  }

  /** DBFLOW_ADMIN_EMAIL/PASSWORD가 있고 해당 계정이 없으면 ADMIN 1회 생성. 기존 계정은 건드리지 않는다. */
  private async createAdminFromEnv() {
    const email = process.env.DBFLOW_ADMIN_EMAIL;
    const password = process.env.DBFLOW_ADMIN_PASSWORD;
    if (!email || !password) return;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return;

    await this.prisma.user.create({
      data: {
        email,
        name: 'Administrator',
        department: 'admin',
        role: 'ADMIN',
        passwordHash: await argon2.hash(password),
      },
    });
    this.logger.log(`관리자 계정 생성됨: ${email}`);
  }

  /** 데모 계정·SQL 검토 규칙·결재 정책 upsert (멱등 — 반복 기동 무해) */
  private async seedDemo() {
    for (const u of DEMO_USERS) {
      await this.prisma.user.upsert({
        where: { email: u.email },
        update: { department: u.department, role: u.role },
        create: { ...u, passwordHash: await argon2.hash('password1234') },
      });
    }
    for (const [env, rules] of Object.entries(DEMO_RULE_LEVELS)) {
      for (const [ruleKey, level] of Object.entries(rules)) {
        await this.prisma.sqlReviewRule.upsert({
          where: { env_ruleKey: { env: env as never, ruleKey } },
          update: { level: level as never },
          create: { env: env as never, ruleKey, level: level as never },
        });
      }
    }
    for (const env of ['DEV', 'STAGING', 'PROD'] as const) {
      await this.prisma.approvalPolicy.upsert({ where: { env }, update: {}, create: { env, requiredApprovals: 1 } });
    }
    this.logger.log('데모 시드 완료 (DBFLOW_DEMO=true)');
  }

  /** 로그인 가능한 사용자가 하나도 없으면 부팅을 중단시킨다 (로그인 불가 상태로 뜨는 것 방지) */
  private async assertAnyUserExists() {
    const count = await this.prisma.user.count();
    if (count > 0) return;
    this.logger.error(
      '사용자가 없어 로그인할 수 없습니다. DBFLOW_ADMIN_EMAIL/DBFLOW_ADMIN_PASSWORD를 설정하거나 DBFLOW_DEMO=true로 기동하세요.',
    );
    process.exit(1);
  }
}
