# EPIC — 오프라인 프로덕션 빌드

## 사전 승인 범위
사용자의 unattended QA 승인에 따라 Google Fonts 빌드 요청을 로컬 폰트로 교체하고,
라이선스·서체 영향을 기록하며 운영 키 없는 모듈 로딩 회귀 테스트와 전체 lint/test/build를 수행한다.
버전, CI 정책, 인증/인가, git 설정은 변경하지 않는다. 커밋·PR·병합·배포는 컨트롤러 담당이다.
운영 대상 설정, 사전 검사 통과, 지정 관리자의 `배포해` 또는 `LGTM` 승인 전 병합·배포하지 않는다.

## 조사 및 의존성
- 기준: main `348b3192`. AGENTS.md/CLAUDE.md는 체크아웃에 없다.
- PR #196 후보에 해당하는 로컬 ref: `origin/fix/qa-lint-baseline`, `ea9053e8b51e5ed112b99547e245d1953e8c4b84`.
  로컬 refs만으로 PR 번호 연결은 확정할 수 없지만 동일 오프라인 폰트 변경이 존재한다.
  해당 커밋의 폰트/라이선스/로더만 재사용한다. lint·설정·API 응답 변경은 가져오지 않는다.
- main `636a2ad`가 OpenAI 초기화를 작업 실행 시점으로 이미 이동했다. 추가 구현 없이 회귀 검증한다.
- 참고: src/app/layout.tsx, globals.css, api/convert-image/route.ts, src/lib/jobManager.ts.

## 태스크
- [x] 로컬 폰트와 OFL 원문 포함, 기존 CSS 변수/가중치 유지
- [x] 폰트 무결성 및 키 없는 API 모듈 로딩/실패 처리 회귀 테스트
- [x] 전체 lint/test/build 실행 및 결과 기록 (전체 테스트 통과는 아래 제약으로 미충족)

## 보고 인계
Ainmem 카드 URL 및 생성 도구가 현재 세션에 제공되지 않았다. 외부 카드 링크를 만들거나 추정하지 않는다.
컨트롤러가 이 문서의 결과를 작업 카드 하나에 연결하고 PR을 생성한다.

## 서체·라이선스 검토
- 기존 세 가족, CSS 변수, normal 가중치 범위와 swap 유지. AgentTab/HolderModal의 Manrope 및 sans/mono 유틸리티 연결 유지.
- `fc-scan`으로 번들 가족 이름과 가변 스타일 확인. 원본 SHA-256 검증 통과.
- 원본 TTF 합계 505,704 bytes. Google subset WOFF2보다 전송량 증가. 로컬 로더의 fallback metrics가 달라질 수 있어 픽셀 동일성/CLS 무변화를 보장하지 않는다. 한글은 기존처럼 시스템 fallback 사용. 모바일·데스크톱 시각 확인은 배포 전 검사로 남긴다.
- SIL OFL 1.1 저작권/전문을 원본과 함께 보존하고 `/fonts/*-OFL.txt`로도 제공. 폰트 단독 판매 금지, 재배포 시 고지 유지. 앱 코드에 OFL 적용 의무는 없다.

## 검증 기록
- Node 24.20.0, 설치된 node_modules 사용. Yarn Corepack은 오프라인에서 다운로드 실패하여 의존성 변경 없이 `npm run`으로 같은 스크립트를 실행했다.
- `npm run lint`: 종료 0, 기존 경고 36건, 오류 0.
- 타깃: `TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx --test --test-isolation=none src/app/api/convert-image/route.test.ts src/app/fonts/fonts.test.ts`: 3/3 통과.
- `npm run test`: 38 파일 중 36 통과, 2 실패. 환경변수를 비우고 쓰기 가능한 TMPDIR로 재실행해도 동일.
  - 기존 teams-delegation-e2e: HTTP 서버 `listen 127.0.0.1`이 샌드박스 `EPERM`으로 거부됨.
  - 기존 asset-linking: 자식 CLI 종료 코드 2 검증은 통과하나 stderr가 빈 문자열이라 기대 메시지 검증 실패. 동일 CLI 직접 실행 시 기대 메시지 출력 확인.
  - 테스트 생략/약화, 네트워크 권한 확대, 임의 운영 키 주입은 하지 않았다. 전체 테스트 통과 조건은 아직 미충족.
- `env -i PATH="$PATH" HOME="$HOME" npm run build`: 종료 0. 운영 API 키 및 기타 운영 환경변수 없이 실제 전체 빌드 통과. 컴파일/타입 검사/45개 정적 페이지/최종 trace 완료.
- 빌드 산출물 `.next/static/media`의 세 TTF SHA-256이 원본과 일치함을 확인.
- `git diff --check`: 통과.

## 남은 차단 및 인계
전체 테스트의 통과 증거가 필요하다. 현재 샌드박스 권한을 넓히지 말고 컨트롤러의 기존 검증 러너에서
로컬 HTTP 통합 테스트 및 자식 CLI 출력 검증을 포함한 전체 스위트를 재실행해야 한다.
Ainmem 작업 카드 하나의 URL/쓰기 연결이 없어 카드 보고는 미수행이다.
PR은 컨트롤러가 기존 후보와의 중복 검토 후 생성한다. 커밋·push·병합·배포·버전 변경은 수행하지 않았다.

## 검증 실패 후속 수정 (사전 승인 범위)
- 컨트롤러가 보고한 OFL 파일 6개의 줄 끝 공백을 제거한다. 라이선스 문구와 폰트 바이너리는 보존한다.
- 정규화된 라이선스의 문서 해시를 갱신하고 기존 무결성 회귀 테스트 및 전체 변경분 공백 검사를 실행한다.
- 전체 lint/test/build 재검증, Ainmem 카드 업데이트 및 PR 발행은 컨트롤러 대기 사항이다.
- 후속 검증: `git diff HEAD --check` 통과(스테이징 및 작업 트리의 최종 변경분 포함). 라이선스 6개가 기존 내용에서 줄 끝 공백만 제거되었음을 확인.
- 후속 타깃 회귀 테스트: 폰트 해시/공개 라이선스 일치/공백 검사, 로컬 로더, OpenAI 키 없는 모듈 로딩 및 작업 실패 처리 3/3 통과. 전체 lint/test/build는 이번 후속 수정 후 컨트롤러 재검증 대기.
