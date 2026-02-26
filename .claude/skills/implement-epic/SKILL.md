---
name: implement-epic
description: EPIC 문서를 읽고 Story별 태스크를 순서대로 구현한다.
argument-hint: [epic-id | file-path] (예: EPIC01, docs/desktop_view_refactoring/EPIC01-FOUNDATION.md)
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, TaskCreate, TaskUpdate, TaskList, AskUserQuestion
model: claude-opus-4-6
agent: epic-implementor
---

# EPIC 구현 스킬

## 실행 절차

### 1. EPIC 문서 로드
- `$ARGUMENTS`로 EPIC ID 또는 파일 경로를 전달받는다.
  - EPIC ID (예: `EPIC01`) → `docs/` 하위에서 해당 ID가 포함된 EPIC MD 파일을 Glob으로 검색하여 로드한다.
  - 파일 경로 (예: `docs/desktop_view_refactoring/EPIC01-FOUNDATION.md`) → 해당 경로를 직접 읽는다.
- 인자가 없으면 사용자에게 경로를 요청한다.

### 2. 의존성 확인
- EPIC 문서의 "의존성" 섹션을 확인한다.
- 선행 EPIC이 있다면, 해당 EPIC 파일을 읽어 "완료 조건" 체크박스 상태를 확인한다.
- 선행 EPIC이 미완료(`[ ]` 존재)라면 **사용자에게 질문**한다:
  > "선행 EPIC `{이름}`이 아직 완료되지 않았습니다. 선행 EPIC을 먼저 구현할까요, 현재 EPIC을 그대로 진행할까요?"

### 3. Story별 구현
각 Story에 대해:

1. **태스크 목록 확인**: Story의 체크박스 태스크를 읽는다.
2. **관련 파일 읽기**: 신규/수정 대상 파일과 참고 파일을 모두 읽는다.
3. **구현**: 태스크를 순서대로 구현한다.
   - 신규 파일: 기존 코드 패턴과 일관성을 유지한다.
   - 수정 파일: 최소 변경 원칙. 기존 동작을 깨뜨리지 않는다.
4. **체크박스 업데이트**: 완료된 태스크의 `[ ]`를 `[x]`로 변경한다.

### 4. Story 완료 후
- 해당 Story의 모든 태스크가 `[x]`인지 확인한다.
- 다음 Story로 진행한다.

### 5. EPIC 완료 후
- "완료 조건" 섹션의 체크박스를 검증하고, 충족된 항목을 `[x]`로 업데이트한다.
- 사용자에게 완료 요약을 보고한다.
- **다음 EPIC은 자동 진행하지 않는다.** 사용자가 별도로 호출해야 한다.

---

## 구현 규칙
- EPIC 문서에 "구현 규칙", "금지사항", "핵심 상수" 섹션이 있다면 반드시 따른다.
- EPIC 문서에 "참고 파일" 섹션이 있다면 구현 전 해당 파일을 읽고 패턴을 파악한다.
- EPIC 문서에 "주의사항" 섹션이 있다면 해당 내용을 준수한다.
- EPIC 문서에 없는 기능이나 변경을 임의로 추가하지 않는다.
