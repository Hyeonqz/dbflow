import './config/validate-env'; // 반드시 첫 import — .env 로드 + fail-fast
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AuditExceptionFilter } from './audit/audit-exception.filter';
import { AuditService } from './audit/audit.service';

async function bootstrap() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz !== 'Asia/Seoul') {
    // eslint-disable-next-line no-console
    console.warn(
      `[dbflow] 서버 타임존이 Asia/Seoul이 아닙니다(현재: ${tz}). 적용 작업창 판정이 어긋날 수 있습니다 — TZ=Asia/Seoul로 기동하세요.`,
    );
  }

  const app = await NestFactory.create(AppModule);
  // web 프록시/리버스 프록시가 설정한 X-Forwarded-For를 신뢰해 req.ip가 실제 클라이언트 IP를 읽도록
  // (compose에서 api는 외부 미노출 — web 프록시 뒤에서만 접근되므로 신뢰 가능).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.useGlobalFilters(
    new AuditExceptionFilter(app.get(AuditService), app.get(HttpAdapterHost).httpAdapter),
  );
  const corsOrigins = process.env.DBFLOW_CORS_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins?.length ? corsOrigins : true,
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
