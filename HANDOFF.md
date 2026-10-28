# 2026-10-29 Space 동시 접속 및 허들 인수인계

브랜치: `feat/kmh/huddles`. 전체 목표는 아직 미완료이며 이 커밋은 운영 배포가 아니다.

연결별 체류 lease와 SSE 동시 접속, 인스턴스 경계, 서명된 AIN-SSO 허들 권한/멘션, 공통 허들 진입 및 Ainize 경유를 추가했다. 허들 연결 요청은 15초 제한과 이동/언마운트 취소를 적용했다.

이전 원격 native 테스트/타입/lint와 실제 두 SSO 계정의 Teams 경유 Space 권한·노트·멘션 회수 검증은 Teams 증거 문서에 있다. Space 자체 SSO 로그인/실제 패널 이동과 일부 avatar generation 경계는 미완료다.

전체 저장소 연결, 증거, 남은 작업과 실행 제약은 [AIN Teams HANDOFF.md](https://github.com/ainetwork-ai/ainteams/blob/feat/kmh/huddles/HANDOFF.md)를 참조한다. AI는 Ainize만 사용하고 STT 모델은 사용자 지정 confucius4-r2t2를 유지한다. 이 Mac에서 Docker/모델 추론/RTC·미디어 생성·디코딩·추출을 실행하지 않는다. 해당 작업은 사용자 지정 Ainize 서버에서만 한다.

비밀값·세션 쿠키·JWT·원본 미디어·개인 로그·node_modules는 Git에 넣지 않는다. 원격 서비스/세션은 재개 시 현재 상태를 확인하고 관찰 타임아웃만으로 재실행하지 않는다. 실제 운영 DB나 공유 호스트 설정을 임의로 바꾸지 않는다.
