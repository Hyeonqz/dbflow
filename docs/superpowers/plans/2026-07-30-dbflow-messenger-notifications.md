# DBFlow Slack and Telegram Action Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver optional, per-user Slack or Telegram DM notifications whenever a DBFlow user becomes responsible for reviewing or approving a Change Request.

**Architecture:** `ChangeRequestModule` creates immutable notification snapshots inside locked workflow transactions and hands them to `NotificationModule` after commit. `NotificationModule` resolves active delegates and preferences synchronously, then sends through low-level Slack/Telegram clients without awaiting provider I/O; `IntegrationModule` independently owns OAuth, OIDC, Telegram linking, provider status, and test messages. A one-way module graph prevents circular dependencies.

**Tech Stack:** NestJS 10, Prisma 5, MySQL 8, Node 22 `fetch`, `jose` for Slack OIDC JWT verification, Jest/Supertest, Next.js 14 App Router, React 18, next-intl 4.13, Tailwind, Vitest/Testing Library, Docker Compose, GitHub Actions, Docker Hub

**Design source:** [docs/superpowers/specs/2026-07-30-dbflow-messenger-notifications-design.md](../specs/2026-07-30-dbflow-messenger-notifications-design.md)

## Global Constraints

- Follow the required cycle: requirements/design -> implementation plan -> implementation -> test -> deployment.
- Execute this plan in an isolated worktree created with `superpowers:using-git-worktrees`.
- Before creating the feature worktree, inspect `git status --short`. Any concurrent edits must be committed by their owner or deliberately transferred and reviewed in the new worktree. Never revert them, stage them accidentally, or assume their test failure belongs to this feature.
- Notifications are personal DMs. Shared Slack channels and Telegram groups are out of scope.
- One DBFlow user selects at most one preferred channel: `SLACK`, `TELEGRAM`, or unset.
- Notify only action requests: submit, review approval, and newly actionable reassignment.
- When an assignee has active delegates, exclude the original assignee, notify every active delegate, and deduplicate by DBFlow user ID.
- Keep message content to title, environment, requester name, requested action, and the DBFlow detail URL. Never include SQL, description, comments, tokens, provider IDs, or OAuth codes in messages or logs.
- Await local recipient and integration lookup so caller-visible warnings are accurate. Do not await external provider sends in workflow requests.
- Provider API failure never rolls back or changes a committed Change Request transition.
- No durable outbox, retry queue, notification history, interactive approval, reminder, email, generic webhook, or Slack multi-workspace support.
- Missing provider configuration must not stop API boot. A partially configured provider is reported as unavailable.
- `DBFLOW_PUBLIC_URL` must be an HTTPS origin in staging/production and is the sole base for OAuth callbacks, Telegram webhook registration, and Change Request links.
- Slack workspace installation and Slack user linking are separate flows. OIDC scopes cannot be combined with bot scopes.
- Slack OAuth/OIDC attempts and Telegram link attempts expire after exactly 10 minutes and are single-use.
- Provider HTTP timeout is exactly 5 seconds.
- Reuse `encryptSecret()`/`decryptSecret()` and `APP_ENCRYPTION_KEY` for the Slack bot token.
- Persist `en` or `ko`; keep the `dbflow_locale` cookie synchronized with the persisted value.
- Remove the visible sidebar language toggle. Language selection appears only at `/settings/general`.
- Add Korean `@DisplayName` to new or edited Jest test methods when the test style supports decorators; this repository currently uses Jest function tests, so retain its established `it('Korean description', ...)` style.
- Every task completes its own failing-test -> minimal-implementation -> passing-test cycle and ends with a narrow Lore Protocol commit.
- Stage only files listed by the current task. Never use `git add -A` or `git commit -a`.

---

## File Structure

### New API Files

| File | Responsibility |
|---|---|
| `apps/api/src/integration/integration.module.ts` | Account-linking and admin-provider composition root |
| `apps/api/src/integration/integration.controller.ts` | Authenticated user integration endpoints and public callbacks |
| `apps/api/src/integration/admin-integration.controller.ts` | ADMIN-only readiness/install/webhook endpoints |
| `apps/api/src/integration/integration.service.ts` | Preferences, link/unlink, status, test sends |
| `apps/api/src/integration/integration-query.service.ts` | Read-only preference/connection/workspace queries for notifications |
| `apps/api/src/integration/integration-security.service.ts` | Hashed state/nonce creation and atomic single-use consumption |
| `apps/api/src/integration/slack-oauth.service.ts` | Slack install OAuth and user OIDC flows |
| `apps/api/src/integration/telegram-link.service.ts` | Telegram deep-link, webhook, and manual recovery flow |
| `apps/api/src/integration/dto/integration.dto.ts` | Preference, manual chat ID, and callback DTO validation |
| `apps/api/src/messaging-provider/messaging-provider.module.ts` | Low-level provider client exports |
| `apps/api/src/messaging-provider/provider-error.ts` | Secret-free provider error categories |
| `apps/api/src/messaging-provider/slack-api.client.ts` | OAuth/token exchange, OIDC discovery, and Slack DM HTTP calls |
| `apps/api/src/messaging-provider/telegram-api.client.ts` | `getMe`, `setWebhook`, and `sendMessage` HTTP calls |
| `apps/api/src/notification/notification.module.ts` | Notification coordinator composition |
| `apps/api/src/notification/notification.types.ts` | Event, delivery, warning, locale, and channel contracts |
| `apps/api/src/notification/recipient-resolver.ts` | Active-delegate fan-out and DBFlow-user deduplication |
| `apps/api/src/notification/notification-template.service.ts` | Minimal Korean/English message rendering |
| `apps/api/src/notification/notification-coordinator.ts` | Local preparation, fire-and-forget dispatch, structured logging |
| `apps/api/src/**/*.spec.ts` | Focused unit tests beside each new service |
| `apps/api/src/integration/integration.controller.e2e.spec.ts` | Guard, callback, and webhook HTTP behavior |

### New Web Files

| File | Responsibility |
|---|---|
| `apps/web/app/(app)/settings/layout.tsx` | General/Notifications settings tabs |
| `apps/web/app/(app)/settings/general/page.tsx` | Persisted language control |
| `apps/web/app/(app)/settings/general/page.test.tsx` | Cookie/API/context synchronization |
| `apps/web/app/(app)/settings/notifications/page.tsx` | Link, unlink, preference, readiness, and test DM UI |
| `apps/web/app/(app)/settings/notifications/page.test.tsx` | Optional-provider and connection-state behavior |
| `apps/web/app/(app)/admin/integrations/page.tsx` | ADMIN provider installation and webhook operations |
| `apps/web/app/(app)/admin/integrations/page.test.tsx` | Secret-free readiness rendering and admin actions |
| `apps/web/app/api/[...path]/route.test.ts` | Upstream OAuth redirect passthrough |
| `apps/web/components/settings-tabs.tsx` | Compact route tabs shared by settings pages |

### Modified Files

| File | Change |
|---|---|
| `apps/api/prisma/schema.prisma` | Preference, connection, workspace, and auth-attempt models |
| `apps/api/prisma/migrations/20260730*_messenger_notifications/migration.sql` | Create/backfill/drop legacy Telegram column |
| `apps/api/package.json`, `pnpm-lock.yaml` | Add `jose` |
| `apps/api/src/app.module.ts` | Register provider, integration, and notification modules |
| `apps/api/src/config/validate-env.ts` | Optional provider readiness validation without boot failure |
| `apps/api/src/config/validate-env.spec.ts` | Optional/partial provider cases |
| `apps/api/src/users/users.service.ts` | Return persisted locale/channel/link status |
| `apps/api/src/users/dto/update-me.dto.ts` | Remove direct Telegram chat ID mutation |
| `apps/api/src/auth/auth.service.ts` | Include the persisted locale in successful login |
| `apps/api/src/auth/auth.service.spec.ts` | Login locale and sanitization contract |
| `apps/api/src/change-request/change-request.module.ts` | Import `NotificationModule` |
| `apps/api/src/change-request/change-request.service.ts` | Locked snapshots, after-commit notification, warning response |
| `apps/api/src/change-request/change-request.service.spec.ts` | Event, warning, delegation, and reassignment behavior |
| `apps/web/lib/api.ts` | Integration contracts and mutation warning type |
| `apps/web/lib/auth.ts` | Persisted locale in cached user |
| `apps/web/components/user-context.tsx` | Locale-aware user update |
| `apps/web/components/sidebar.tsx` | Remove `LocaleToggle`; add Settings/Admin Integrations links |
| `apps/web/components/sidebar.test.tsx` | Language-control absence and settings role visibility |
| `apps/web/components/locale-toggle.tsx` | Delete the obsolete sidebar-only language control |
| `apps/web/components/icons.tsx` | Add settings and message-provider icons following the existing icon system |
| `apps/web/app/login/page.tsx` | Synchronize the locale cookie from the login response |
| `apps/web/app/api/[...path]/route.ts` | Preserve upstream OAuth `302 Location` |
| `apps/web/app/(app)/change-requests/[id]/page.tsx` | Render successful-action notification warnings |
| `apps/web/app/(app)/change-requests/[id]/page.test.tsx` | Warning rendering without false workflow failure |
| `apps/web/messages/en.json`, `apps/web/messages/ko.json` | Settings, integrations, warnings, and provider copy |
| `.env.example`, `README.md`, `docs/deployment.md` | Provider configuration and staging validation |

---

### Task 1: Persist Preferences, Connections, Workspace, and Auth Attempts

**Files:**
- Modify: `apps/api/prisma/schema.prisma:68`
- Create: `apps/api/prisma/migrations/20260730090000_messenger_notifications/migration.sql`
- Modify: `apps/api/src/users/users.service.ts:72`
- Modify: `apps/api/src/users/dto/update-me.dto.ts:1`
- Modify: `apps/api/src/users/users.service.spec.ts`
- Modify: `apps/api/src/auth/auth.service.ts:16`
- Modify: `apps/api/src/auth/auth.service.spec.ts`

**Interfaces:**
- Produces: Prisma enums `NotificationChannel`, `UserLocale`, `IntegrationProvider`, `IntegrationAuthPurpose`.
- Produces: Prisma models `NotificationPreference`, `UserIntegration`, `SlackWorkspace`, `IntegrationAuthAttempt`.
- Produces: `UsersService.profile(id)` fields `locale`, `preferredChannel`, `integrations.slackLinked`, and `integrations.telegramLinked`.
- Produces: successful login field `user.locale`.
- Removes: direct `telegramChatId` write access from `UpdateMeDto`.

- [ ] **Step 1: Write a failing profile contract test**

Add a `users.service.spec.ts` case with a Prisma profile fixture containing preference and
integration relations:

```ts
it('내 프로필에 저장 언어, 기본 채널, 메신저 연결 상태를 반환한다', async () => {
  prisma.user.findUniqueOrThrow.mockResolvedValue({
    id: 'u1',
    email: 'reviewer@dbflow.io',
    name: 'Reviewer',
    department: 'DBA',
    role: Role.REVIEWER,
    preference: { locale: 'ko', preferredChannel: 'SLACK' },
    integrations: [{ provider: 'SLACK' }],
  });

  await expect(service.profile('u1')).resolves.toMatchObject({
    locale: 'ko',
    preferredChannel: 'SLACK',
    integrations: { slackLinked: true, telegramLinked: false },
  });
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
pnpm --filter @dbflow/api test -- users.service.spec.ts --runInBand
```

Expected: FAIL because `profile()` neither includes nor returns preference/integration data.

- [ ] **Step 3: Add the exact Prisma contracts**

Add the four enums and four models from design section 6. Add these relations to `User`:

```prisma
preference       NotificationPreference?
integrations     UserIntegration[]
integrationAuthAttempts IntegrationAuthAttempt[]
```

Use `SlackWorkspace.id = "primary"` from service code; do not encode a random default.

- [ ] **Step 4: Create the migration with legacy Telegram backfill**

The migration must perform operations in this order:

```sql
CREATE TABLE `notification_preference` (
  `userId` VARCHAR(191) NOT NULL,
  `preferredChannel` ENUM('SLACK', 'TELEGRAM') NULL,
  `locale` ENUM('en', 'ko') NOT NULL DEFAULT 'en',
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`userId`),
  CONSTRAINT `notification_preference_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_integration` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `provider` ENUM('SLACK', 'TELEGRAM') NOT NULL,
  `externalUserId` VARCHAR(191) NOT NULL,
  `displayName` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `user_integration_userId_provider_key`(`userId`, `provider`),
  UNIQUE INDEX `user_integration_provider_externalUserId_key`(`provider`, `externalUserId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `user_integration_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `user_integration`
  (`id`, `userId`, `provider`, `externalUserId`, `displayName`, `createdAt`, `updatedAt`)
SELECT CONCAT('telegram_', `id`), `id`, 'TELEGRAM', `telegramChatId`, NULL, NOW(3), NOW(3)
FROM `User`
WHERE `telegramChatId` IS NOT NULL AND `telegramChatId` <> '';

ALTER TABLE `User` DROP COLUMN `telegramChatId`;
```

Create `slack_workspace` and `integration_auth_attempt` exactly as declared in the design;
add unique indexes for `teamId` and `stateHash`, and the `(purpose, expiresAt)` index.

- [ ] **Step 5: Update profile reads and remove legacy mutation**

Use one Prisma read:

```ts
const u = await this.prisma.user.findUniqueOrThrow({
  where: { id },
  include: {
    preference: true,
    integrations: { select: { provider: true } },
  },
});
return {
  id: u.id,
  email: u.email,
  name: u.name,
  department: u.department,
  role: u.role,
  locale: u.preference?.locale ?? 'en',
  preferredChannel: u.preference?.preferredChannel ?? null,
  integrations: {
    slackLinked: u.integrations.some((row) => row.provider === 'SLACK'),
    telegramLinked: u.integrations.some((row) => row.provider === 'TELEGRAM'),
  },
};
```

Delete `telegramChatId` from `UpdateMeDto` and `UsersService.updateMe()`'s accepted data type.

- [ ] **Step 6: Return persisted locale at login**

After password verification, read the sanitized profile and use its locale in the login
response:

```ts
const profile = await this.users.profile(user.id);
return {
  accessToken,
  user: {
    id: user.id,
    email: user.email,
    name: user.name,
    department: user.department,
    role: user.role,
    locale: profile.locale,
  },
};
```

Update the valid-login test to require `locale: 'en'` and continue asserting that
`passwordHash` is absent.

- [ ] **Step 7: Generate and validate Prisma**

Run:

```bash
pnpm --filter @dbflow/api exec prisma format
pnpm --filter @dbflow/api exec prisma validate
pnpm --filter @dbflow/api exec prisma generate
pnpm --filter @dbflow/api test -- users.service.spec.ts --runInBand
pnpm --filter @dbflow/api test -- auth.service.spec.ts --runInBand
```

Expected: Prisma commands succeed and the focused test passes.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260730090000_messenger_notifications/migration.sql apps/api/src/users/users.service.ts apps/api/src/users/dto/update-me.dto.ts apps/api/src/users/users.service.spec.ts apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.service.spec.ts
git commit -m "Persist notification identity without exposing provider details" -m "Constraint: Preserve existing Telegram links during migration" -m "Rejected: Keep telegramChatId on User | It cannot represent multiple providers cleanly" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: Prisma validate, users service tests, auth service tests" -m "Not-tested: Production data volume migration timing"
```

---

### Task 2: Add Optional Provider Readiness and Low-Level HTTP Clients

**Files:**
- Create: `apps/api/src/messaging-provider/provider-error.ts`
- Create: `apps/api/src/messaging-provider/slack-api.client.ts`
- Create: `apps/api/src/messaging-provider/slack-api.client.spec.ts`
- Create: `apps/api/src/messaging-provider/telegram-api.client.ts`
- Create: `apps/api/src/messaging-provider/telegram-api.client.spec.ts`
- Create: `apps/api/src/messaging-provider/messaging-provider.module.ts`
- Modify: `apps/api/src/config/validate-env.ts:18`
- Modify: `apps/api/src/config/validate-env.spec.ts`
- Modify: `apps/api/src/app.module.ts:17`

**Interfaces:**
- Produces: `providerReadiness(env): { slack: ProviderReadiness; telegram: ProviderReadiness }`.
- Produces: `SlackApiClient.exchangeInstallCode()`, `exchangeOidcCode()`, `postDirectMessage()`.
- Produces: `TelegramApiClient.getMe()`, `getWebhookInfo()`, `setWebhook()`, `sendMessage()`.
- Produces: `ProviderError.category` in `TIMEOUT | AUTH | RATE_LIMIT | REJECTED | NETWORK | MALFORMED_RESPONSE`.

- [ ] **Step 1: Write failing optional-env and client tests**

Add assertions:

```ts
it('provider 환경변수가 모두 없어도 필수 env 검증은 통과한다', () => {
  expect(validateEnv(validCoreEnv())).toEqual([]);
  expect(providerReadiness(validCoreEnv()).slack.available).toBe(false);
  expect(providerReadiness(validCoreEnv()).telegram.available).toBe(false);
});

it('Slack DM은 user ID를 channel로 사용하고 5초 timeout을 건다', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ ok: true, ts: '1.2' }));
  await client.postDirectMessage('xoxb-secret', 'U123', 'Review requested');
  expect(fetchMock).toHaveBeenCalledWith(
    'https://slack.com/api/chat.postMessage',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

it('Telegram 메시지는 parse_mode 없이 개인 chat_id로 전송한다', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ ok: true, result: { message_id: 7 } }));
  await client.sendMessage('bot-token', '1234', 'Review requested');
  expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
    chat_id: '1234',
    text: 'Review requested',
  });
});
```

- [ ] **Step 2: Confirm failures**

Run:

```bash
pnpm --filter @dbflow/api test -- validate-env.spec.ts slack-api.client.spec.ts telegram-api.client.spec.ts --runInBand
```

Expected: FAIL because readiness and provider clients do not exist.

- [ ] **Step 3: Implement readiness without changing boot failure rules**

```ts
export type ProviderReadiness = {
  available: boolean;
  missing: string[];
};

function isHttpsOrigin(value?: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function providerReadiness(env: NodeJS.ProcessEnv = process.env) {
  const publicUrlValid = isHttpsOrigin(env.DBFLOW_PUBLIC_URL);
  const webhookSecretValid =
    !!env.TELEGRAM_WEBHOOK_SECRET &&
    /^[A-Za-z0-9_-]{1,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET);
  const slackMissing = [
    !env.SLACK_CLIENT_ID && 'SLACK_CLIENT_ID',
    !env.SLACK_CLIENT_SECRET && 'SLACK_CLIENT_SECRET',
    !publicUrlValid && 'DBFLOW_PUBLIC_URL',
  ].filter(Boolean) as string[];
  const telegramMissing = [
    !env.TELEGRAM_BOT_TOKEN && 'TELEGRAM_BOT_TOKEN',
    !env.TELEGRAM_BOT_USERNAME && 'TELEGRAM_BOT_USERNAME',
    !webhookSecretValid && 'TELEGRAM_WEBHOOK_SECRET',
    !publicUrlValid && 'DBFLOW_PUBLIC_URL',
  ].filter(Boolean) as string[];
  return {
    slack: { available: slackMissing.length === 0, missing: slackMissing },
    telegram: { available: telegramMissing.length === 0, missing: telegramMissing },
  };
}
```

Do not append provider readiness failures to `validateEnv()`'s returned errors.

- [ ] **Step 4: Implement provider errors and five-second fetch**

```ts
export type ProviderErrorCategory =
  | 'TIMEOUT'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'REJECTED'
  | 'NETWORK'
  | 'MALFORMED_RESPONSE';

export class ProviderError extends Error {
  constructor(public readonly category: ProviderErrorCategory) {
    super(`Provider request failed: ${category}`);
  }
}
```

Each client uses:

```ts
const response = await fetch(url, {
  ...init,
  signal: AbortSignal.timeout(5_000),
});
```

Parse provider JSON into narrow internal return types. Never include response bodies or
request secrets in thrown messages.

- [ ] **Step 5: Register and verify the module**

Export both clients from `MessagingProviderModule`; import the module from `AppModule`.

Run:

```bash
pnpm --filter @dbflow/api test -- validate-env.spec.ts slack-api.client.spec.ts telegram-api.client.spec.ts --runInBand
pnpm --filter @dbflow/api build
```

Expected: focused tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/messaging-provider apps/api/src/config/validate-env.ts apps/api/src/config/validate-env.spec.ts apps/api/src/app.module.ts
git commit -m "Keep messenger outages outside the DBFlow availability boundary" -m "Constraint: Providers are optional and requests time out after five seconds" -m "Rejected: Slack SDK and Telegram SDK | Node fetch covers the narrow API surface" -m "Confidence: high" -m "Scope-risk: narrow" -m "Tested: Provider client unit tests, env tests, API build" -m "Not-tested: Live provider endpoints"
```

---

### Task 3: Build Single-Use Integration Security Primitives

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/api/src/integration/integration-security.service.ts`
- Create: `apps/api/src/integration/integration-security.service.spec.ts`
- Create: `apps/api/src/integration/dto/integration.dto.ts`

**Interfaces:**
- Produces: `createAttempt(purpose, userId, withNonce): Promise<{ state: string; nonce?: string }>`
- Produces: `consumeAttempt(purpose, state, tx?): Promise<{ userId: string | null; nonceHash: string | null }>`
- Produces: `verifyNonce(rawNonce, storedHash): void`
- DTOs: `UpdateNotificationPreferenceDto`, `ManualTelegramLinkDto`, `OAuthCallbackDto`.

- [ ] **Step 1: Add `jose` and write replay/expiry tests**

Run:

```bash
pnpm --filter @dbflow/api add jose@^5.10.0
```

Add tests:

```ts
it('state 원문 대신 SHA-256 해시만 저장한다', async () => {
  const created = await service.createAttempt('SLACK_LINK', 'u1', true);
  expect(created.state).toHaveLength(64);
  expect(prisma.integrationAuthAttempt.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      stateHash: expect.not.stringContaining(created.state),
      userId: 'u1',
      expiresAt: expect.any(Date),
    }),
  });
});

it('이미 소비된 state 재사용을 거부한다', async () => {
  prisma.integrationAuthAttempt.updateMany.mockResolvedValue({ count: 0 });
  await expect(service.consumeAttempt('SLACK_LINK', 'raw-state')).rejects.toThrow(
    BadRequestException,
  );
});

it('10분이 지난 state를 거부한다', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-07-30T00:10:01Z'));
  prisma.integrationAuthAttempt.updateMany.mockResolvedValue({ count: 0 });
  await expect(service.consumeAttempt('TELEGRAM_LINK', 'raw-state')).rejects.toThrow(
    BadRequestException,
  );
});
```

- [ ] **Step 2: Confirm failure**

Run:

```bash
pnpm --filter @dbflow/api test -- integration-security.service.spec.ts --runInBand
```

Expected: FAIL because the security service does not exist.

- [ ] **Step 3: Implement random values, hashing, and atomic consumption**

```ts
const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('hex');

async createAttempt(purpose: IntegrationAuthPurpose, userId: string | null, withNonce: boolean) {
  const state = secret();
  const nonce = withNonce ? secret() : undefined;
  await this.prisma.integrationAuthAttempt.create({
    data: {
      purpose,
      userId,
      stateHash: digest(state),
      nonceHash: nonce ? digest(nonce) : null,
      expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS),
    },
  });
  return { state, nonce };
}
```

`consumeAttempt()` accepts an optional `Prisma.TransactionClient`, first reads by
`stateHash`, then atomically marks it consumed through that same client:

```ts
const db = tx ?? this.prisma;
const updated = await db.integrationAuthAttempt.updateMany({
  where: {
    id: row.id,
    purpose,
    consumedAt: null,
    expiresAt: { gt: new Date() },
  },
  data: { consumedAt: new Date() },
});
if (updated.count !== 1) throw new BadRequestException({ key: 'integration.invalidAttempt' });
```

Use `timingSafeEqual()` for nonce hash equality.

- [ ] **Step 4: Add exact DTO validation**

```ts
export class UpdateNotificationPreferenceDto {
  @IsOptional() @IsEnum(NotificationChannel) preferredChannel?: NotificationChannel | null;
  @IsOptional() @IsEnum(UserLocale) locale?: UserLocale;
}

export class ManualTelegramLinkDto {
  @IsString() @Matches(/^-?[0-9]{1,20}$/) chatId!: string;
}

export class OAuthCallbackDto {
  @IsString() @MaxLength(4096) code!: string;
  @IsString() @Length(64, 64) state!: string;
}
```

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @dbflow/api test -- integration-security.service.spec.ts --runInBand
pnpm --filter @dbflow/api build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/integration/integration-security.service.ts apps/api/src/integration/integration-security.service.spec.ts apps/api/src/integration/dto/integration.dto.ts
git commit -m "Bind provider callbacks to one authenticated DBFlow intent" -m "Constraint: State and nonce expire in ten minutes and are single-use" -m "Rejected: Signed state without persistence | It cannot enforce replay prevention" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: Replay, expiry, hashing, nonce tests and API build" -m "Not-tested: Clock skew across multiple API nodes"
```

---

### Task 4: Implement Singleton Slack Workspace Installation

**Files:**
- Create: `apps/api/src/integration/slack-oauth.service.ts`
- Create: `apps/api/src/integration/slack-oauth.service.spec.ts`
- Create: `apps/api/src/integration/admin-integration.controller.ts`
- Create: `apps/api/src/integration/integration.controller.ts`
- Create: `apps/api/src/integration/integration.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/src/integration/integration.controller.e2e.spec.ts`

**Interfaces:**
- Produces: `SlackOAuthService.createInstallUrl(adminUserId): Promise<{ url: string }>`
- Produces: `SlackOAuthService.completeInstall(code, state): Promise<void>`
- HTTP: `POST /admin/integrations/slack/install`
- HTTP: `GET /integrations/slack/oauth/callback?code=...&state=...`

- [ ] **Step 1: Write failing install-flow tests**

```ts
it('chat:write만 요청하고 정확한 HTTPS callback을 사용한다', async () => {
  security.createAttempt.mockResolvedValue({ state: 's'.repeat(64) });
  const { url } = await service.createInstallUrl('admin-1');
  const parsed = new URL(url);
  expect(parsed.origin + parsed.pathname).toBe('https://slack.com/oauth/v2/authorize');
  expect(parsed.searchParams.get('scope')).toBe('chat:write');
  expect(parsed.searchParams.get('redirect_uri')).toBe(
    'https://staging.dbflow.example/api/integrations/slack/oauth/callback',
  );
});

it('bot token을 암호화하고 primary row 하나에 upsert한다', async () => {
  slack.exchangeInstallCode.mockResolvedValue({
    accessToken: 'xoxb-secret',
    teamId: 'T1',
    teamName: 'DBA',
    scopes: ['chat:write'],
  });
  await service.completeInstall('code', 'state');
  expect(prisma.slackWorkspace.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'primary' },
      create: expect.objectContaining({ id: 'primary', teamId: 'T1' }),
    }),
  );
  expect(JSON.stringify(prisma.slackWorkspace.upsert.mock.calls[0])).not.toContain('xoxb-secret');
});
```

- [ ] **Step 2: Confirm failure**

Run:

```bash
pnpm --filter @dbflow/api test -- slack-oauth.service.spec.ts --runInBand
```

Expected: FAIL because the Slack OAuth service is absent.

- [ ] **Step 3: Implement install URL and callback**

Normalize `DBFLOW_PUBLIC_URL` by removing a trailing slash. Use:

```ts
const installRedirect = `${publicUrl}/api/integrations/slack/oauth/callback`;
const authorize = new URL('https://slack.com/oauth/v2/authorize');
authorize.search = new URLSearchParams({
  client_id: process.env.SLACK_CLIENT_ID!,
  scope: 'chat:write',
  redirect_uri: installRedirect,
  state,
}).toString();
```

On callback:

1. Atomically consume `SLACK_INSTALL`.
2. Exchange the code with the same redirect URI.
3. Require a bot access token, team ID, team name, and `chat:write`.
4. Encrypt the token with `encryptSecret()`.
5. Upsert `SlackWorkspace` at ID `primary`.
6. Redirect to `${DBFLOW_PUBLIC_URL}/admin/integrations?slack=installed`.

- [ ] **Step 4: Guard admin start and expose public callback**

`POST /admin/integrations/slack/install` uses JWT, `RolesGuard`, and `@Roles(Role.ADMIN)`.
The callback route is in `IntegrationController` without JWT because state is its
authorization boundary.

Add an HTTP test proving a non-admin receives 403 and the callback route is reachable
without JWT but rejects an invalid state with 400.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @dbflow/api test -- slack-oauth.service.spec.ts integration.controller.e2e.spec.ts --runInBand
pnpm --filter @dbflow/api build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/integration/slack-oauth.service.ts apps/api/src/integration/slack-oauth.service.spec.ts apps/api/src/integration/admin-integration.controller.ts apps/api/src/integration/integration.module.ts apps/api/src/integration/integration.controller.e2e.spec.ts apps/api/src/app.module.ts
git commit -m "Let one administrator establish the instance Slack boundary" -m "Constraint: One workspace per DBFlow instance with chat:write only" -m "Rejected: Store bot token in environment | Self-hosted OAuth installation must be instance-managed" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: OAuth URL, encrypted singleton upsert, guards, API build" -m "Not-tested: Live Slack consent screen"
```

---

### Task 5: Implement Slack User OIDC Link, Unlink, and Test DM

**Files:**
- Modify: `apps/api/src/integration/slack-oauth.service.ts`
- Modify: `apps/api/src/integration/slack-oauth.service.spec.ts`
- Create: `apps/api/src/integration/integration.service.ts`
- Create: `apps/api/src/integration/integration.service.spec.ts`
- Create: `apps/api/src/integration/integration-query.service.ts`
- Modify: `apps/api/src/integration/integration.controller.ts`
- Modify: `apps/api/src/integration/integration.module.ts`

**Interfaces:**
- Produces: `createUserLinkUrl(userId): Promise<{ url: string }>`
- Produces: `completeUserLink(code, state): Promise<void>`
- Produces: `IntegrationQueryService.getUserDeliveryProfiles(userIds)`
- HTTP: `GET /integrations/me`, `PATCH /integrations/me/preferences`
- HTTP: `POST /integrations/me/slack/link`, `DELETE /integrations/me/slack`, `POST /integrations/me/slack/test`
- HTTP: `GET /integrations/slack/oidc/callback`

- [ ] **Step 1: Write failing OIDC security tests**

```ts
it('OIDC 링크는 openid profile email과 installed team을 지정한다', async () => {
  prisma.slackWorkspace.findUnique.mockResolvedValue({ id: 'primary', teamId: 'T1' });
  security.createAttempt.mockResolvedValue({ state: 's'.repeat(64), nonce: 'n'.repeat(64) });
  const { url } = await service.createUserLinkUrl('u1');
  const parsed = new URL(url);
  expect(parsed.pathname).toBe('/openid/connect/authorize');
  expect(parsed.searchParams.get('scope')).toBe('openid profile email');
  expect(parsed.searchParams.get('team')).toBe('T1');
  expect(parsed.searchParams.get('nonce')).toBe('n'.repeat(64));
});

it('issuer, audience, expiry, nonce, team_id를 검증한 뒤 Slack user ID만 저장한다', async () => {
  oidcVerifier.verify.mockResolvedValue({
    sub: 'U1',
    name: 'Alice',
    'https://slack.com/team_id': 'T1',
    'https://slack.com/user_id': 'U1',
  });
  await service.completeUserLink('code', 'state');
  expect(prisma.userIntegration.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      create: expect.objectContaining({ provider: 'SLACK', externalUserId: 'U1' }),
    }),
  );
});

it('연결된 채널만 preferred channel로 저장하고 locale을 upsert한다', async () => {
  prisma.userIntegration.findUnique.mockResolvedValue({ id: 'link-1' });
  await service.updatePreferences('u1', { locale: 'ko', preferredChannel: 'SLACK' });
  expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: 'u1' },
      update: { locale: 'ko', preferredChannel: 'SLACK' },
    }),
  );
});
```

- [ ] **Step 2: Confirm failure**

Run:

```bash
pnpm --filter @dbflow/api test -- slack-oauth.service.spec.ts integration.service.spec.ts --runInBand
```

Expected: FAIL for missing user-link behavior.

- [ ] **Step 3: Verify ID tokens with `jose`**

Use:

```ts
const jwks = createRemoteJWKSet(new URL('https://slack.com/openid/connect/keys'));
const { payload } = await jwtVerify(idToken, jwks, {
  issuer: 'https://slack.com',
  audience: process.env.SLACK_CLIENT_ID!,
  algorithms: ['RS256'],
});
```

Then:

- compare `payload.nonce` through `IntegrationSecurityService.verifyNonce()`
- require `payload['https://slack.com/team_id'] === workspace.teamId`
- require string `payload['https://slack.com/user_id']`
- require `payload.sub === payload['https://slack.com/user_id']`
- upsert the `SLACK` `UserIntegration`
- discard the OIDC access token and ID token after callback processing

- [ ] **Step 4: Implement status, unlink, and awaited test send**

`IntegrationService.testSlack(userId)` must:

1. Read the user's Slack connection and singleton workspace.
2. Decrypt the bot token only immediately before provider use.
3. Await `postDirectMessage()` with a localized test message.
4. Return `{ ok: true }`; map provider failure to HTTP 502 without exposing provider text.

`unlink` deletes only `(userId, SLACK)` and clears `preferredChannel` when it was `SLACK`.

- [ ] **Step 5: Implement user status and preference endpoints**

`GET /integrations/me` returns locale, preferred channel, provider availability, link
booleans, and the non-secret Slack workspace name. `PATCH /integrations/me/preferences`
rejects a preferred channel unless that provider is available and the user has a matching
`UserIntegration`; it upserts `NotificationPreference`.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm --filter @dbflow/api test -- slack-oauth.service.spec.ts integration.service.spec.ts --runInBand
pnpm --filter @dbflow/api build
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/integration/slack-oauth.service.ts apps/api/src/integration/slack-oauth.service.spec.ts apps/api/src/integration/integration.service.ts apps/api/src/integration/integration.service.spec.ts apps/api/src/integration/integration-query.service.ts apps/api/src/integration/integration.controller.ts apps/api/src/integration/integration.module.ts
git commit -m "Bind DBFlow users to the installed Slack workspace securely" -m "Constraint: OIDC identity flow remains separate from bot installation" -m "Rejected: Match users by email | Explicit OIDC linking avoids identity ambiguity" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: OIDC claims, team binding, unlink, test DM service tests" -m "Not-tested: Live Slack OIDC callback"
```

---

### Task 6: Implement Telegram Deep Link, Secret Webhook, Manual Recovery, and Test DM

**Files:**
- Create: `apps/api/src/integration/telegram-link.service.ts`
- Create: `apps/api/src/integration/telegram-link.service.spec.ts`
- Modify: `apps/api/src/integration/integration.service.ts`
- Modify: `apps/api/src/integration/integration.service.spec.ts`
- Modify: `apps/api/src/integration/integration.controller.ts`
- Modify: `apps/api/src/integration/admin-integration.controller.ts`
- Modify: `apps/api/src/integration/integration.controller.e2e.spec.ts`

**Interfaces:**
- Produces: `createDeepLink(userId): Promise<{ url: string; expiresAt: string }>`
- Produces: `consumeWebhook(secretHeader, update): Promise<void>`
- Produces: `registerWebhook(): Promise<{ ok: true }>`
- Produces: `getAdminStatus(): Promise<AdminIntegrationStatus>` using provider readiness,
  singleton workspace data, and Telegram `getWebhookInfo()`.
- HTTP: `POST /integrations/me/telegram/link`, `POST /integrations/me/telegram/manual`
- HTTP: `DELETE /integrations/me/telegram`, `POST /integrations/me/telegram/test`
- HTTP: `POST /integrations/telegram/webhook`
- HTTP: `POST /admin/integrations/telegram/webhook`

- [ ] **Step 1: Write failing Telegram security tests**

```ts
it('딥링크는 10분짜리 단일 사용 토큰을 start 파라미터에 넣는다', async () => {
  security.createAttempt.mockResolvedValue({ state: 'a'.repeat(64) });
  await expect(service.createDeepLink('u1')).resolves.toEqual({
    url: `https://t.me/dbflow_test_bot?start=${'a'.repeat(64)}`,
    expiresAt: expect.any(String),
  });
});

it('webhook secret이 다르면 update를 처리하지 않는다', async () => {
  await expect(service.consumeWebhook('wrong', privateStartUpdate)).rejects.toThrow(
    ForbiddenException,
  );
  expect(security.consumeAttempt).not.toHaveBeenCalled();
});

it('private /start만 연결하고 consume과 upsert를 한 트랜잭션에서 처리한다', async () => {
  await service.consumeWebhook('expected-secret', privateStartUpdate);
  expect(prisma.$transaction).toHaveBeenCalled();
  expect(prisma.userIntegration.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      create: expect.objectContaining({ provider: 'TELEGRAM', externalUserId: '1234' }),
    }),
  );
});
```

- [ ] **Step 2: Confirm failure**

Run:

```bash
pnpm --filter @dbflow/api test -- telegram-link.service.spec.ts integration.service.spec.ts --runInBand
```

Expected: FAIL because Telegram linking behavior is absent.

- [ ] **Step 3: Implement constant-time secret validation and private-chat parsing**

Convert both header and configured secret to buffers of equal length before
`timingSafeEqual()`. Reject absent or unequal values. Accept only:

```ts
type TelegramStartUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { first_name?: string; username?: string };
  };
};
```

Require `chat.type === 'private'` and `/start <64 hex characters>`.
Inside one Prisma transaction, call
`security.consumeAttempt('TELEGRAM_LINK', token, tx)` and upsert the Telegram
`UserIntegration` through the same `tx`.

- [ ] **Step 4: Implement registration and manual recovery**

`registerWebhook()` calls:

```ts
telegram.setWebhook(token, {
  url: `${publicUrl}/api/integrations/telegram/webhook`,
  secret_token: process.env.TELEGRAM_WEBHOOK_SECRET!,
  allowed_updates: ['message'],
});
```

Manual linking must await:

```ts
await telegram.sendMessage(token, dto.chatId, localizedTestText);
await prisma.userIntegration.upsert({
  where: { userId_provider: { userId, provider: 'TELEGRAM' } },
  create: { userId, provider: 'TELEGRAM', externalUserId: dto.chatId },
  update: { externalUserId: dto.chatId },
});
```

Never persist when `sendMessage()` rejects.

- [ ] **Step 5: Implement secret-free admin status**

`GET /admin/integrations` returns missing environment variable names, Slack installed
status/workspace name, and Telegram webhook status. When Telegram is available,
`getWebhookInfo()` must report the exact expected webhook URL; provider failure degrades
`webhookConfigured` to `false` without exposing provider response text.

- [ ] **Step 6: Add HTTP tests and verify**

Prove an invalid webhook secret returns 403, a valid update returns 204, and no JWT is
required for the webhook endpoint.

Run:

```bash
pnpm --filter @dbflow/api test -- telegram-link.service.spec.ts integration.service.spec.ts integration.controller.e2e.spec.ts --runInBand
pnpm --filter @dbflow/api build
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/integration/telegram-link.service.ts apps/api/src/integration/telegram-link.service.spec.ts apps/api/src/integration/integration.service.ts apps/api/src/integration/integration.service.spec.ts apps/api/src/integration/integration.controller.ts apps/api/src/integration/admin-integration.controller.ts apps/api/src/integration/integration.controller.e2e.spec.ts
git commit -m "Let users prove ownership of a Telegram DM destination" -m "Constraint: Private chats, secret webhook, ten-minute single-use links" -m "Rejected: Save untested manual chat IDs | A successful DM is required first" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: Deep link, replay boundary, webhook secret, manual link tests" -m "Not-tested: Live Telegram webhook delivery"
```

---

### Task 7: Resolve Delegated Recipients and Render Minimal Localized Messages

**Files:**
- Create: `apps/api/src/notification/notification.types.ts`
- Create: `apps/api/src/notification/recipient-resolver.ts`
- Create: `apps/api/src/notification/recipient-resolver.spec.ts`
- Create: `apps/api/src/notification/notification-template.service.ts`
- Create: `apps/api/src/notification/notification-template.service.spec.ts`

**Interfaces:**
- Produces: `ActionNotificationSnapshot`, `NotificationWarning`, `PreparedDelivery`.
- Produces: `RecipientResolver.resolve(assigneeIds, now?): Promise<string[]>`.
- Produces: `NotificationTemplateService.render(snapshot, locale): string`.

- [ ] **Step 1: Write failing delegation and privacy tests**

```ts
it('활성 위임이 있으면 원 담당자를 제외하고 모든 대리인을 중복 제거한다', async () => {
  prisma.delegation.findMany.mockResolvedValue([
    { delegatorId: 'owner-1', delegateId: 'delegate-a' },
    { delegatorId: 'owner-1', delegateId: 'delegate-b' },
    { delegatorId: 'owner-2', delegateId: 'delegate-a' },
  ]);
  await expect(resolver.resolve(['owner-1', 'owner-2', 'owner-3'], now)).resolves.toEqual([
    'delegate-a',
    'delegate-b',
    'owner-3',
  ]);
});

it('메시지에는 최소 필드만 있고 SQL, 설명, 코멘트는 없다', () => {
  const text = templates.render(snapshot, 'ko');
  expect(text).toContain('검토 요청');
  expect(text).toContain(snapshot.title);
  expect(text).toContain(snapshot.targetEnv);
  expect(text).toContain(snapshot.requesterName);
  expect(text).toContain(`/change-requests/${snapshot.changeRequestId}`);
  expect(text).not.toContain('SELECT');
  expect(text).not.toContain('description');
  expect(text).not.toContain('comment');
});
```

- [ ] **Step 2: Confirm failure**

Run:

```bash
pnpm --filter @dbflow/api test -- recipient-resolver.spec.ts notification-template.service.spec.ts --runInBand
```

Expected: FAIL because resolver and templates do not exist.

- [ ] **Step 3: Implement one-query delegation fan-out**

Query:

```ts
const rows = await this.prisma.delegation.findMany({
  where: {
    delegatorId: { in: assigneeIds },
    startsAt: { lte: now },
    endsAt: { gt: now },
  },
  orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  select: { delegatorId: true, delegateId: true },
});
```

For each assignee, use all delegate IDs when at least one row exists; otherwise use the
assignee. Preserve deterministic first-seen order through `Set<string>`.

- [ ] **Step 4: Implement exact templates**

Korean:

```text
[DBFlow] 검토 요청
제목: {title}
환경: {targetEnv}
요청자: {requesterName}
작업: 검토가 필요합니다.
링크: {publicUrl}/change-requests/{changeRequestId}
```

English:

```text
[DBFlow] Review requested
Title: {title}
Environment: {targetEnv}
Requester: {requesterName}
Action: Review is required.
Link: {publicUrl}/change-requests/{changeRequestId}
```

Use `결재 요청` / `Approval requested` and corresponding action text for
`APPROVAL_REQUESTED`. Do not use provider-specific markup or `parse_mode`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @dbflow/api test -- recipient-resolver.spec.ts notification-template.service.spec.ts --runInBand
```

Expected: all pass.

```bash
git add apps/api/src/notification/notification.types.ts apps/api/src/notification/recipient-resolver.ts apps/api/src/notification/recipient-resolver.spec.ts apps/api/src/notification/notification-template.service.ts apps/api/src/notification/notification-template.service.spec.ts
git commit -m "Send action requests to the people who can actually act" -m "Constraint: Active delegates replace owners and messages contain minimal metadata" -m "Rejected: Reuse detail-view delegation mapping | It drops additional active delegates" -m "Confidence: high" -m "Scope-risk: narrow" -m "Tested: Delegate fan-out, deduplication, locale, message privacy tests" -m "Not-tested: Provider rendering differences"
```

---

### Task 8: Prepare Warnings and Dispatch Provider Sends After Local Resolution

**Files:**
- Create: `apps/api/src/notification/notification-coordinator.ts`
- Create: `apps/api/src/notification/notification-coordinator.spec.ts`
- Create: `apps/api/src/notification/notification.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: `NotificationCoordinator.notifyAfterCommit(snapshot): Promise<NotificationWarning[]>`.
- Consumes: `RecipientResolver`, `IntegrationQueryService`, templates, provider clients.
- Logging event: `notification.delivery_failed`.

- [ ] **Step 1: Write failing preparation and fire-and-forget tests**

```ts
it('미설정, 기본 채널 없음, 미연동을 묶어서 응답 경고로 반환한다', async () => {
  resolver.resolve.mockResolvedValue(['u1', 'u2', 'u3']);
  integrations.getUserDeliveryProfiles.mockResolvedValue([
    { userId: 'u1', locale: 'ko', preferredChannel: null, connection: null },
    { userId: 'u2', locale: 'en', preferredChannel: 'SLACK', connection: null },
    { userId: 'u3', locale: 'en', preferredChannel: 'TELEGRAM', connection: { externalUserId: '3' } },
  ]);
  readiness.telegram.available = false;

  await expect(coordinator.notifyAfterCommit(snapshot)).resolves.toEqual([
    { code: 'PREFERRED_CHANNEL_UNSET', channel: null, recipientCount: 1 },
    { code: 'RECIPIENT_UNLINKED', channel: 'SLACK', recipientCount: 1 },
    { code: 'PROVIDER_UNAVAILABLE', channel: 'TELEGRAM', recipientCount: 1 },
  ]);
});

it('provider promise를 기다리지 않고 시작하며 실패는 구조화 로그만 남긴다', async () => {
  const pending = deferred<void>();
  slack.postDirectMessage.mockReturnValue(pending.promise);
  await expect(coordinator.notifyAfterCommit(snapshot)).resolves.toEqual([]);
  pending.reject(new ProviderError('TIMEOUT'));
  await Promise.resolve();
  expect(logger.warn).toHaveBeenCalledWith(
    JSON.stringify({
      event: 'notification.delivery_failed',
      channel: 'SLACK',
      eventType: snapshot.eventType,
      changeRequestId: snapshot.changeRequestId,
      recipientUserId: 'u1',
      errorCategory: 'TIMEOUT',
    }),
  );
});
```

- [ ] **Step 2: Confirm failure**

Run:

```bash
pnpm --filter @dbflow/api test -- notification-coordinator.spec.ts --runInBand
```

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Implement local preparation and grouped warnings**

`notifyAfterCommit()` awaits only:

- recipient resolution
- user preference/connection query
- singleton workspace read for Slack deliveries

Group warnings by `(code, channel)` and increment `recipientCount`.

- [ ] **Step 4: Launch each provider call without awaiting**

```ts
for (const delivery of deliveries) {
  void this.send(delivery).catch((error: unknown) => {
    this.logger.warn(
      JSON.stringify({
        event: 'notification.delivery_failed',
        channel: delivery.channel,
        eventType: snapshot.eventType,
        changeRequestId: snapshot.changeRequestId,
        recipientUserId: delivery.userId,
        errorCategory: error instanceof ProviderError ? error.category : 'NETWORK',
      }),
    );
  });
}
return warnings;
```

Never log `delivery.externalUserId`, `delivery.text`, decrypted bot token, or raw error.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @dbflow/api test -- notification-coordinator.spec.ts --runInBand
pnpm --filter @dbflow/api build
```

Expected: tests and build pass.

```bash
git add apps/api/src/notification/notification-coordinator.ts apps/api/src/notification/notification-coordinator.spec.ts apps/api/src/notification/notification.module.ts apps/api/src/app.module.ts
git commit -m "Keep committed workflows responsive while preserving notification diagnostics" -m "Constraint: Local warnings are awaited, provider I/O is fire-and-forget" -m "Rejected: Await provider sends | A messenger outage must not delay workflow actions" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: Warning grouping, non-blocking dispatch, structured log privacy" -m "Not-tested: Process-crash delivery loss is accepted"
```

---

### Task 9: Emit Concurrency-Safe Notification Snapshots from Change Request Transitions

**Files:**
- Modify: `apps/api/src/change-request/change-request.module.ts:9`
- Modify: `apps/api/src/change-request/change-request.service.ts:93`
- Modify: `apps/api/src/change-request/change-request.service.spec.ts`
- Modify: `apps/api/src/change-request/change-request.controller.e2e.spec.ts`

**Interfaces:**
- Consumes: `NotificationCoordinator.notifyAfterCommit(snapshot)`.
- Produces: action mutation response `ChangeRequestDetail & { notificationWarnings: NotificationWarning[] }`.
- Maintains: GET detail/list response contracts without `notificationWarnings`.

- [ ] **Step 1: Write failing submit and review snapshot tests**

```ts
it('submit 커밋 뒤 REVIEW_REQUESTED를 준비하고 경고를 성공 응답에 붙인다', async () => {
  notification.notifyAfterCommit.mockResolvedValue([
    { code: 'RECIPIENT_UNLINKED', channel: 'SLACK', recipientCount: 1 },
  ]);
  const result = await service.submit(actor, 'cr1');
  expect(notification.notifyAfterCommit).toHaveBeenCalledWith({
    eventType: 'REVIEW_REQUESTED',
    cause: 'SUBMITTED',
    changeRequestId: 'cr1',
    title: 'Add index',
    targetEnv: 'PROD',
    requesterName: 'Developer',
    assigneeIds: ['reviewer-1'],
  });
  expect(result.notificationWarnings).toHaveLength(1);
});

it('review 승인 커밋 뒤 미결정 결재자 전원을 snapshot에 넣는다', async () => {
  await service.review(reviewer, 'cr1', { decision: Decision.APPROVE, comment: '' });
  expect(notification.notifyAfterCommit).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'APPROVAL_REQUESTED',
      cause: 'REVIEW_APPROVED',
      assigneeIds: ['approver-1', 'approver-2'],
    }),
  );
});

it('review 반려와 부분/최종 결재는 action-request 알림을 만들지 않는다', async () => {
  await service.review(reviewer, 'cr1', { decision: Decision.REJECT, comment: 'reason' });
  expect(notification.notifyAfterCommit).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing locked reassignment tests**

```ts
it('setAssignees는 CR 행 잠금 뒤 old/new를 비교해 새 담당자만 알린다', async () => {
  await service.setAssignees(admin, 'cr1', {
    reviewerId: 'reviewer-new',
    approverIds: ['approver-old', 'approver-new'],
  });
  expect(tx.$queryRaw).toHaveBeenCalled();
  expect(notification.notifyAfterCommit).toHaveBeenCalledWith(
    expect.objectContaining({
      cause: 'REASSIGNED',
      assigneeIds: ['reviewer-new'],
    }),
  );
});

it('REVIEW_APPROVED 재지정은 새 미결정 결재자만 알린다', async () => {
  await service.setAssignees(admin, 'cr2', {
    approverIds: ['approver-old', 'approver-new'],
  });
  expect(notification.notifyAfterCommit).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'APPROVAL_REQUESTED',
      assigneeIds: ['approver-new'],
    }),
  );
});
```

- [ ] **Step 3: Confirm focused failures**

Run:

```bash
pnpm --filter @dbflow/api test -- change-request.service.spec.ts --runInBand
```

Expected: FAIL because `NotificationCoordinator` is not injected or called.

- [ ] **Step 4: Convert submit transition to a locked interactive transaction**

Inside the transaction:

1. `SELECT id FROM ChangeRequest WHERE id = ${id} FOR UPDATE`
2. Re-read status, author, reviewer, approvers, title, target environment, requester name
3. Validate author, assignment count, and transition
4. Write status, history, audit
5. Return `{ detailPayload, snapshot }`

After commit:

```ts
const warnings = snapshot
  ? await this.notification.notifyAfterCommit(snapshot)
  : [];
return { ...this.toDetail(detailPayload), notificationWarnings: warnings };
```

`approve()` has no action-request event in this release but returns the same mutation shape
with `notificationWarnings: []`, so all Change Request action clients keep one contract.

- [ ] **Step 5: Return review snapshot from its existing transaction**

For `REVIEW_APPROVE`, select undecided approver user IDs after the status update. Return the
snapshot from the transaction and call the coordinator after `$transaction()` resolves.
For `REVIEW_REJECT`, return `snapshot: null`.

- [ ] **Step 6: Lock and compare reassignment in one transaction**

Move status, permission, assignment-role, approval-count, old/new assignment, mutation,
audit, and event calculation under the CR row lock. Event calculation:

```ts
const newlyAssigned = nextIds.filter((userId) => !previousIds.includes(userId));
const snapshot =
  status === ChangeRequestStatus.SUBMITTED && reviewerChanged && nextReviewerId
    ? makeReviewSnapshot([nextReviewerId], 'REASSIGNED')
    : status === ChangeRequestStatus.REVIEW_APPROVED && newlyAssigned.length > 0
      ? makeApprovalSnapshot(newlyAssigned, 'REASSIGNED')
      : null;
```

Do not notify for `DRAFT` or terminal statuses. Do not notify removed assignees.

- [ ] **Step 7: Add HTTP response contract coverage**

Assert `POST /change-requests/:id/submit` returns HTTP 200 with the existing detail fields
plus:

```json
{
  "notificationWarnings": [
    {
      "code": "RECIPIENT_UNLINKED",
      "channel": "SLACK",
      "recipientCount": 1
    }
  ]
}
```

- [ ] **Step 8: Verify and commit**

Run:

```bash
pnpm --filter @dbflow/api test -- change-request.service.spec.ts change-request.controller.e2e.spec.ts --runInBand
pnpm --filter @dbflow/api test
pnpm --filter @dbflow/api build
```

Expected: focused and full API suites pass; build succeeds.

```bash
git add apps/api/src/change-request/change-request.module.ts apps/api/src/change-request/change-request.service.ts apps/api/src/change-request/change-request.service.spec.ts apps/api/src/change-request/change-request.controller.e2e.spec.ts
git commit -m "Notify from committed assignment truth instead of pre-transaction guesses" -m "Constraint: Snapshot creation and assignee comparison occur under the CR row lock" -m "Rejected: Re-read mutable Change Requests after commit | It can notify a later assignee state" -m "Confidence: high" -m "Scope-risk: broad" -m "Directive: Keep workflow mutations independent from provider delivery success" -m "Tested: Submit, review, reassignment, warning response, full API suite and build" -m "Not-tested: Multi-process MySQL race until staging concurrency test"
```

---

### Task 10: Move Language Selection into General Settings

**Files:**
- Create: `apps/web/components/settings-tabs.tsx`
- Create: `apps/web/app/(app)/settings/layout.tsx`
- Create: `apps/web/app/(app)/settings/general/page.tsx`
- Create: `apps/web/app/(app)/settings/general/page.test.tsx`
- Modify: `apps/web/components/sidebar.tsx:21`
- Modify: `apps/web/components/sidebar.test.tsx`
- Delete: `apps/web/components/locale-toggle.tsx`
- Modify: `apps/web/components/icons.tsx`
- Modify: `apps/web/lib/api.ts:545`
- Modify: `apps/web/lib/auth.ts:8`
- Modify: `apps/web/components/user-context.tsx:6`
- Modify: `apps/web/app/login/page.tsx:20`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/ko.json`

**Interfaces:**
- Produces: `getMyIntegrationStatus()` and `updateNotificationPreference()`.
- Produces: `/settings/general` and `/settings/notifications` tabs.
- Removes: sidebar rendering of `LocaleToggle`.

- [ ] **Step 1: Write failing sidebar and general-settings tests**

```tsx
it('사이드바에는 언어 선택이 없고 Settings 링크만 있다', () => {
  renderWithIntl(<Sidebar user={makeUser()} />);
  expect(screen.queryByRole('radiogroup', { name: /language/i })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href',
    '/settings/general',
  );
});

it('언어 저장은 API, cookie, user context, router refresh를 함께 갱신한다', async () => {
  api.updateNotificationPreference.mockResolvedValue({
    locale: 'ko',
    preferredChannel: null,
  });
  renderPage();
  await userEvent.click(screen.getByRole('radio', { name: '한국어' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(api.updateNotificationPreference).toHaveBeenCalledWith({ locale: 'ko' });
  expect(document.cookie).toContain('dbflow_locale=ko');
  expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ locale: 'ko' }));
  expect(router.refresh).toHaveBeenCalled();
});
```

- [ ] **Step 2: Confirm failure**

Run:

```bash
pnpm --filter @dbflow/web test -- sidebar.test.tsx settings/general/page.test.tsx
```

Expected: FAIL because Settings pages and APIs do not exist and sidebar still renders
`LocaleToggle`.

- [ ] **Step 3: Add preference API and cached user locale**

```ts
export type NotificationChannel = 'SLACK' | 'TELEGRAM';
export type UserLocale = 'en' | 'ko';

export type MyIntegrationStatus = {
  locale: UserLocale;
  preferredChannel: NotificationChannel | null;
  providers: {
    slack: { available: boolean; linked: boolean; workspaceName: string | null };
    telegram: { available: boolean; linked: boolean };
  };
};

export function updateNotificationPreference(
  patch: Partial<Pick<MyIntegrationStatus, 'locale' | 'preferredChannel'>>,
) {
  return apiFetch<MyIntegrationStatus>('/integrations/me/preferences', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
```

Add `locale: UserLocale` to `User`, defaulting legacy cached users to `en` in `readUser()`.
Update `login()`'s response type to include `locale`.

- [ ] **Step 4: Build settings tabs and General page**

Use a compact two-tab navigation, not cards nested inside cards:

```tsx
const tabs = [
  { href: '/settings/general', key: 'general' },
  { href: '/settings/notifications', key: 'notifications' },
] as const;
```

The language control is a segmented `radiogroup` with `English` and `한국어`; the page has
one Save command. On success, set the cookie with `path=/; max-age=31536000; samesite=lax`,
update `UserProvider`, and call `router.refresh()`.

On successful login, write:

```ts
document.cookie = `dbflow_locale=${user.locale}; path=/; max-age=31536000; samesite=lax`;
```

before `router.push()`, so a different device immediately uses the server-persisted locale.

- [ ] **Step 5: Integrate sidebar without overwriting existing dirty work**

Before editing, inspect:

```bash
git diff -- apps/web/components/sidebar.tsx apps/web/components/sidebar.test.tsx
```

Preserve the existing inbox badge/accessibility changes. Remove the `LocaleToggle`
import/render, delete `components/locale-toggle.tsx`, and add the Settings nav item for all
roles. Add an ADMIN-only `/admin/integrations` item.

- [ ] **Step 6: Add symmetric translations and verify**

Add matching `settings.*`, `nav.settings`, and `nav.integrations` keys in both catalogs.

Run:

```bash
pnpm --filter @dbflow/web test -- sidebar.test.tsx settings/general/page.test.tsx messages.test.ts
pnpm --filter @dbflow/web exec tsc --noEmit
```

Expected: focused tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/settings-tabs.tsx 'apps/web/app/(app)/settings/layout.tsx' 'apps/web/app/(app)/settings/general/page.tsx' 'apps/web/app/(app)/settings/general/page.test.tsx' apps/web/components/sidebar.tsx apps/web/components/sidebar.test.tsx apps/web/components/locale-toggle.tsx apps/web/components/icons.tsx apps/web/lib/api.ts apps/web/lib/auth.ts apps/web/components/user-context.tsx apps/web/app/login/page.tsx apps/web/messages/en.json apps/web/messages/ko.json
git commit -m "Give personal preferences a durable home outside navigation chrome" -m "Constraint: Language selection appears only in General Settings" -m "Rejected: Keep the compact sidebar toggle | It conflicts with the approved settings model" -m "Confidence: high" -m "Scope-risk: moderate" -m "Directive: Preserve existing inbox accessibility edits when resolving sidebar changes" -m "Tested: Settings, sidebar, catalog symmetry tests and web typecheck" -m "Not-tested: Browser locale refresh transition"
```

---

### Task 11: Build Personal Notification Settings and Surface Workflow Warnings

**Files:**
- Create: `apps/web/app/(app)/settings/notifications/page.tsx`
- Create: `apps/web/app/(app)/settings/notifications/page.test.tsx`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/app/(app)/change-requests/[id]/page.tsx`
- Modify: `apps/web/app/(app)/change-requests/[id]/page.test.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/ko.json`

**Interfaces:**
- Produces: Slack and Telegram link/unlink/test API functions.
- Consumes: mutation field `notificationWarnings`.
- UI contract: provider unavailable disables link/test controls but keeps DBFlow workflow usable.

- [ ] **Step 1: Write failing notification-settings tests**

```tsx
it('미설정 provider는 unavailable로 표시하고 연결 버튼을 비활성화한다', async () => {
  api.getMyIntegrationStatus.mockResolvedValue(unavailableStatus);
  renderPage();
  expect(await screen.findByText('Unavailable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Connect Slack' })).toBeDisabled();
});

it('Slack link URL을 받아 브라우저를 이동시킨다', async () => {
  api.beginSlackLink.mockResolvedValue({ url: 'https://slack.com/openid/connect/authorize?...' });
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Connect Slack' }));
  expect(locationAssign).toHaveBeenCalledWith(expect.stringContaining('slack.com'));
});

it('연결되지 않은 채널은 preferred channel로 저장할 수 없다', async () => {
  api.getMyIntegrationStatus.mockResolvedValue(telegramOnlyStatus);
  renderPage();
  expect(await screen.findByRole('radio', { name: 'Slack' })).toBeDisabled();
});
```

- [ ] **Step 2: Write failing workflow-warning tests**

```tsx
it('성공한 submit의 알림 경고를 notice로 보여주고 workflow 실패로 표시하지 않는다', async () => {
  api.submitChangeRequest.mockResolvedValue(
    makeCr({
      status: 'SUBMITTED',
      notificationWarnings: [
        { code: 'RECIPIENT_UNLINKED', channel: 'SLACK', recipientCount: 1 },
      ],
    }),
  );
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Request review' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'The request was submitted, but 1 recipient could not be notified in Slack.',
  );
  expect(screen.queryByRole('alert')).not.toHaveTextContent('could not be notified');
});
```

- [ ] **Step 3: Confirm failures**

Run:

```bash
pnpm --filter @dbflow/web test -- settings/notifications/page.test.tsx 'change-requests/[id]/page.test.tsx'
```

Expected: FAIL because notification settings and warning handling are absent.

- [ ] **Step 4: Add exact web API functions**

```ts
export const getMyIntegrationStatus = () =>
  apiFetch<MyIntegrationStatus>('/integrations/me');
export const beginSlackLink = () =>
  apiFetch<{ url: string }>('/integrations/me/slack/link', { method: 'POST' });
export const unlinkSlack = () =>
  apiFetch<void>('/integrations/me/slack', { method: 'DELETE' });
export const testSlack = () =>
  apiFetch<{ ok: true }>('/integrations/me/slack/test', { method: 'POST' });
export const beginTelegramLink = () =>
  apiFetch<{ url: string; expiresAt: string }>('/integrations/me/telegram/link', { method: 'POST' });
export const linkTelegramManually = (chatId: string) =>
  apiFetch<{ ok: true }>('/integrations/me/telegram/manual', {
    method: 'POST',
    body: JSON.stringify({ chatId }),
  });
export const unlinkTelegram = () =>
  apiFetch<void>('/integrations/me/telegram', { method: 'DELETE' });
export const testTelegram = () =>
  apiFetch<{ ok: true }>('/integrations/me/telegram/test', { method: 'POST' });
```

- [ ] **Step 5: Build the Notifications page**

Use two unframed provider sections separated by borders. Each section includes:

- availability status
- linked/unlinked status
- connect or unlink command
- test command only when linked

Telegram additionally includes a manual chat ID disclosure panel. Preferred channel uses
two radios; an unlinked or unavailable channel is disabled.

- [ ] **Step 6: Thread warnings through action components**

Change action API types to:

```ts
export type NotificationWarning = {
  code: 'PROVIDER_UNAVAILABLE' | 'PREFERRED_CHANNEL_UNSET' | 'RECIPIENT_UNLINKED';
  channel: NotificationChannel | null;
  recipientCount: number;
};

export type ChangeRequestActionResult = ChangeRequestDetail & {
  notificationWarnings: NotificationWarning[];
};
```

Store warnings in `ChangeRequestDetailPage`, above action components, so the notice survives
the post-action detail reload and child unmount:

```tsx
const [notificationWarnings, setNotificationWarnings] = useState<NotificationWarning[]>([]);

const afterAction = useCallback(
  async (warnings: NotificationWarning[] = []) => {
    setNotificationWarnings(warnings);
    await load();
    await refreshInbox();
  },
  [load, refreshInbox],
);
```

`SubmitAction`, `DecisionAction`, and `AssigneePanel` pass
`result.notificationWarnings` to `onDone()`. Render grouped localized text near the top of
the detail page with `<InlineError tone="notice" />`; do not set the error state.

- [ ] **Step 7: Verify and commit**

Run:

```bash
pnpm --filter @dbflow/web test -- settings/notifications/page.test.tsx 'change-requests/[id]/page.test.tsx' messages.test.ts
pnpm --filter @dbflow/web exec tsc --noEmit
```

Expected: focused tests and typecheck pass.

```bash
git add 'apps/web/app/(app)/settings/notifications/page.tsx' 'apps/web/app/(app)/settings/notifications/page.test.tsx' apps/web/lib/api.ts 'apps/web/app/(app)/change-requests/[id]/page.tsx' 'apps/web/app/(app)/change-requests/[id]/page.test.tsx' apps/web/messages/en.json apps/web/messages/ko.json
git commit -m "Make messenger readiness and missed recipients visible without misreporting workflow failure" -m "Constraint: Provider failure cannot change a successful Change Request action" -m "Rejected: Toast provider errors as action failures | It invites duplicate workflow actions" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: Optional provider UI, linking controls, warning notice tests and typecheck" -m "Not-tested: External OAuth browser round trip"
```

---

### Task 12: Build Admin Integration Management and Preserve OAuth Redirects

**Files:**
- Create: `apps/web/app/(app)/admin/integrations/page.tsx`
- Create: `apps/web/app/(app)/admin/integrations/page.test.tsx`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/app/api/[...path]/route.ts:25`
- Create: `apps/web/app/api/[...path]/route.test.ts`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/ko.json`

**Interfaces:**
- Produces: `getAdminIntegrationStatus()`, `beginSlackInstall()`, `registerTelegramWebhook()`.
- Preserves: upstream callback `302` and `Location` through the Next same-origin proxy.

- [ ] **Step 1: Write failing redirect and secret-redaction tests**

```ts
it('upstream OAuth 302를 따라가지 않고 Location을 브라우저에 전달한다', async () => {
  fetchMock.mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: 'https://dbflow.example/settings/notifications?slack=linked' },
    }),
  );
  const response = await GET(request, context);
  expect(fetchMock).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ redirect: 'manual' }),
  );
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toContain('/settings/notifications');
});

it('관리 화면은 readiness와 workspace만 표시하고 secret 문자열을 렌더하지 않는다', async () => {
  api.getAdminIntegrationStatus.mockResolvedValue(adminStatus);
  renderPage(makeUser({ role: 'ADMIN' }));
  expect(await screen.findByText('DBA Workspace')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/xoxb-|bot-token|client-secret/);
});
```

- [ ] **Step 2: Confirm failures**

Run:

```bash
pnpm --filter @dbflow/web test -- 'app/api/[...path]/route.test.ts' admin/integrations/page.test.tsx
```

Expected: FAIL because the proxy follows redirects and the admin page does not exist.

- [ ] **Step 3: Preserve upstream redirects**

Modify the proxy fetch:

```ts
const upstream = await fetch(target, {
  method: req.method,
  headers,
  body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
  redirect: 'manual',
  // @ts-expect-error -- undici streaming body requirement
  duplex: 'half',
  cache: 'no-store',
});
```

- [ ] **Step 4: Add admin API and page**

```ts
export type AdminIntegrationStatus = {
  publicUrlReady: boolean;
  slack: {
    available: boolean;
    missing: string[];
    installed: boolean;
    workspaceName: string | null;
  };
  telegram: {
    available: boolean;
    missing: string[];
    webhookConfigured: boolean;
  };
};
```

The page:

- redirects non-admin users to `/dashboard`
- renders missing environment variable names but no values
- starts/restarts Slack installation through the returned URL
- registers Telegram webhook and refreshes status
- uses query result codes only for success/error banners; never renders OAuth code/state

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @dbflow/web test -- 'app/api/[...path]/route.test.ts' admin/integrations/page.test.tsx messages.test.ts
pnpm --filter @dbflow/web exec tsc --noEmit
pnpm --filter @dbflow/web build
```

Expected: focused tests, typecheck, and build pass.

```bash
git add 'apps/web/app/(app)/admin/integrations/page.tsx' 'apps/web/app/(app)/admin/integrations/page.test.tsx' apps/web/lib/api.ts 'apps/web/app/api/[...path]/route.ts' 'apps/web/app/api/[...path]/route.test.ts' apps/web/messages/en.json apps/web/messages/ko.json
git commit -m "Give administrators a secret-free view of provider readiness" -m "Constraint: OAuth callbacks traverse the same-origin Next proxy" -m "Rejected: Expose API port for callbacks | The single-port deployment contract must remain intact" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: Redirect passthrough, admin authorization UI, catalog symmetry, typecheck, web build" -m "Not-tested: Reverse-proxy header rewriting in staging"
```

---

### Task 13: Document, Verify, Stage, and Release

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/deployment.md`
- Modify: `docs/feature-checklist.md`
- Modify: `.github/workflows/ci.yml` only if the new tests require an explicit existing-script invocation

**Interfaces:**
- Produces: self-hosting configuration contract and staging runbook.
- Produces: Docker Hub release `calixjin/dbflow:0.2.0` and `calixjin/dbflow:latest` after the external staging gate passes.

- [ ] **Step 1: Add the exact optional environment contract**

```dotenv
# Public HTTPS origin used for OAuth callbacks, Telegram webhook, and CR links.
DBFLOW_PUBLIC_URL=""

# Slack app credentials. Leave all blank to disable Slack without blocking boot.
SLACK_CLIENT_ID=""
SLACK_CLIENT_SECRET=""

# Telegram bot credentials. Leave all blank to disable Telegram without blocking boot.
TELEGRAM_BOT_TOKEN=""
TELEGRAM_BOT_USERNAME=""
# 1-256 characters: A-Z, a-z, 0-9, underscore, hyphen.
TELEGRAM_WEBHOOK_SECRET=""
```

Document callback URLs:

```text
DBFLOW_PUBLIC_URL=https://staging.dbflow.example
https://staging.dbflow.example/api/integrations/slack/oauth/callback
https://staging.dbflow.example/api/integrations/slack/oidc/callback
https://staging.dbflow.example/api/integrations/telegram/webhook
```

- [ ] **Step 2: Document accepted delivery semantics and setup**

README feature list must state:

- personal Slack/Telegram action-request DMs
- user-selected default channel and locale
- active delegation fan-out
- best-effort delivery with no retries/history

`docs/deployment.md` must contain:

1. Slack app bot scope `chat:write`
2. separate install and Sign in with Slack redirect URLs
3. Telegram bot username/token/secret setup
4. HTTPS requirement
5. no-secret readiness checks
6. staging real-DM checklist

- [ ] **Step 3: Run static self-review checks**

Run:

```bash
rg -n "telegramChatId|LocaleToggle" apps/api apps/web --glob '!**/*.md'
rg -n "xoxb-|TELEGRAM_BOT_TOKEN.*(log|Logger)|message.*Logger" apps/api/src
git diff --check
```

Expected:

- no runtime `telegramChatId` reference
- no runtime `LocaleToggle` reference; the component was deleted in Task 10
- no secret/body logging pattern
- `git diff --check` returns no output

- [ ] **Step 4: Run the complete local verification matrix**

Run sequentially:

```bash
pnpm --filter @dbflow/api exec prisma validate
pnpm --filter @dbflow/api exec prisma generate
pnpm --filter @dbflow/api test
pnpm --filter @dbflow/api test:e2e
pnpm --filter @dbflow/api build
pnpm --filter @dbflow/web exec tsc --noEmit
pnpm --filter @dbflow/web test
pnpm --filter @dbflow/web build
docker compose config
docker build -t dbflow:messenger-notifications .
```

Expected: every command exits 0.

- [ ] **Step 5: Verify optional-provider boot in Docker**

Start with provider variables empty:

```bash
docker compose up -d
docker compose ps
curl --fail http://localhost:3000/api/health
```

Expected: MySQL and app are healthy; `/api/health` succeeds.

Open `/admin/integrations` as ADMIN and verify both providers show unavailable with missing
variable names and no secret values.

- [ ] **Step 6: Verify transaction survival during provider failure**

Configure a syntactically complete but unreachable provider endpoint through a test double
in automated tests, and in staging temporarily revoke the linked bot token. Submit a Change
Request and verify:

- HTTP action remains 200
- status is committed as `SUBMITTED`
- UI shows only locally knowable warning when applicable
- async provider failure emits one `notification.delivery_failed` log
- log contains channel, event type, CR ID, DBFlow recipient ID, and error category only

- [ ] **Step 7: Run the required staging HTTPS personal-DM gate**

On the dedicated staging domain:

1. Install the Slack workspace as ADMIN.
2. Link a reviewer through Sign in with Slack.
3. Send the Slack test DM.
4. Submit a CR and verify the reviewer receives one Slack DM.
5. Open the DM link and verify it reaches the correct CR.
6. Register the Telegram webhook as ADMIN.
7. Link a second reviewer through `/start <token>`.
8. Send the Telegram test DM.
9. Submit or reassign a CR and verify one Telegram DM.
10. Open the DM link and verify it reaches the correct CR.
11. Create two active delegates for one assignee and verify both delegates receive the DM
    while the original assignee does not.
12. Repeat a used Telegram start token and verify it is rejected without changing the link.

- [ ] **Step 8: Run an independent review**

Invoke `superpowers:requesting-code-review` against the complete branch. Resolve all blocking
findings, then rerun Step 4. The reviewer must specifically inspect:

- OAuth/OIDC state and nonce validation
- Telegram webhook secret and replay prevention
- encrypted token boundaries
- row-lock coverage in `submit()` and `setAssignees()`
- provider promise rejection handling
- message/log privacy
- existing dirty sidebar/inbox changes preserved

- [ ] **Step 9: Commit documentation and release readiness**

```bash
git add .env.example README.md docs/deployment.md docs/feature-checklist.md
git commit -m "Make messenger setup and delivery limits operable for self-hosters" -m "Constraint: Deployment is incomplete until both real personal DMs pass on HTTPS staging" -m "Rejected: Claim delivery guarantees | This release intentionally has no durable outbox" -m "Confidence: high" -m "Scope-risk: moderate" -m "Tested: Full API/web matrix, Docker build, optional-provider boot, staging Slack and Telegram DMs" -m "Not-tested: Long-duration provider outage recovery"
```

- [ ] **Step 10: Merge, tag, publish, and verify Docker Hub**

After CI and the staging gate pass, merge through the repository's normal PR flow, then:

```bash
git checkout main
git pull --ff-only
git tag -a v0.2.0 -m "DBFlow v0.2.0: Slack and Telegram action notifications"
git push origin v0.2.0
RUN_ID="$(gh run list --workflow docker-publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$RUN_ID" --exit-status
docker pull calixjin/dbflow:0.2.0
docker buildx imagetools inspect calixjin/dbflow:0.2.0
```

Expected:

- Docker publish workflow succeeds
- image includes `linux/amd64` and `linux/arm64`
- `calixjin/dbflow:0.2.0` and `calixjin/dbflow:latest` resolve to the release manifest

- [ ] **Step 11: Final production-shaped smoke test**

In a clean directory using `docker-compose.hub.yml` and `DBFLOW_VERSION=0.2.0`:

```bash
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d
docker compose -f docker-compose.hub.yml ps
curl --fail http://localhost:3000/api/health
```

Expected: services are healthy, migration completes, first admin can sign in, integration
status loads, and absent providers still do not block startup.

---

## Plan Self-Review

### Spec Coverage

- Personal preferred-channel DMs: Tasks 1, 5, 6, 8, 11
- Submit/review-approved/reassignment triggers: Task 9
- Multi-approver and all-active-delegate fan-out: Tasks 7 and 9
- Caller warnings versus async provider logs: Tasks 8, 9, 11
- Minimal localized messages: Tasks 7 and 10
- Slack singleton admin install and separate user OIDC: Tasks 4 and 5
- Telegram deep link, webhook secret, manual recovery: Task 6
- Optional provider boot/readiness: Tasks 2, 11, 12, 13
- Encrypted Slack token: Task 4
- Settings routes and sidebar language removal: Tasks 10 and 11
- Admin provider management: Task 12
- Full test and deployment cycle with real DMs: Task 13
- Accepted no-outbox/no-retry boundary: Global Constraints and Task 13 documentation

### Type Consistency

- Provider enum values remain `SLACK | TELEGRAM` from Prisma through API and web.
- Locale values remain lowercase `en | ko` from Prisma through cookie and templates.
- Workflow events use `REVIEW_REQUESTED | APPROVAL_REQUESTED`.
- Causes use `SUBMITTED | REVIEW_APPROVED | REASSIGNED`.
- Mutation warning property is consistently `notificationWarnings`.
- OIDC Slack user ID and Telegram chat ID are both stored as
  `UserIntegration.externalUserId`; they are never returned by status APIs.

### Execution Stop Condition

The feature is complete only after all automated checks pass, both real staging personal
DM flows pass over HTTPS, the independent review has no blocking finding, and the
multi-architecture Docker Hub image is pulled and smoke-tested from a clean deployment.
