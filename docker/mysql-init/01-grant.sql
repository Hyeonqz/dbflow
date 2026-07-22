-- 로컬/개발 전용: prisma migrate dev 의 shadow DB 생성/삭제 권한 부여.
--
-- 운영(production)에서는 `prisma migrate deploy` 만 사용하며, deploy 는
-- shadow DB 를 만들지 않으므로 이 전역 권한이 필요하지 않습니다.
-- (운영 DB 계정에는 이런 광범위한 권한을 부여하지 마십시오.)
--
-- 기본 mysql 이미지는 MYSQL_USER 에게 MYSQL_DATABASE 스키마 권한만 주기 때문에,
-- migrate dev 가 shadow DB(임시 데이터베이스)를 CREATE/DROP 하려다 P3014 로 실패합니다.
-- 이 스크립트는 컨테이너 최초 기동 시(/docker-entrypoint-initdb.d) 1회 실행되어
-- dbflow 유저에게 shadow DB 생성/삭제 권한을 부여합니다.

GRANT ALL PRIVILEGES ON *.* TO 'dbflow'@'%';
FLUSH PRIVILEGES;
