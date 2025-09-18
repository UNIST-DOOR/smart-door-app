유니스트 도어락제어 (리엑트 네이티브)

도어락열기 버튼 클릭(DoorControlScreen.tsx)
->
자동 문열기 로직 (useDoor.ts (커스텀 훅))
->
BLE 탐색 & 연결 (BleService.ts)  - scanAndAutoConnect
->
서비스/특성 발견(BleService.ts) - connectToDevice
->
0x01 명령 전송 (DoorService.ts) 
->
응답 수신 & 처리 (BleService.ts)
->
UI 상태 업데이트 (DoorControlScreen.tsx)
# smart-door-app

## iOS 릴리스/배포 체크리스트

- 운영 설정 전환: `App.tsx`의 운영 플래그 확인
  - `FORCE_LOCAL = false` (프로덕션 API 사용)
- 빌드 번호 증가(매 업로드마다 필수)
  - Xcode > Targets `SmartDoorManager` > General > Identity > Build +1
  - 또는: `cd ios && agvtool next-version -all`
- Archive/Upload (Xcode 16)
  - Scheme: Release
  - Product > Clean Build Folder → Archive → Distribute App (App Store Connect)
- TestFlight
  - 빌드 “관리”에서 암호화 문서 답변 또는 `Info.plist`에 다음 키 추가(권장)
    ```xml
    <key>ITSAppUsesNonExemptEncryption</key>
    <false/>
    ```
  - 내부(Internal)는 즉시, 외부(External)는 베타 심사 승인 후 테스트 가능

## Hermes 커스텀 빌드 유지(우리 프로젝트 전용 커스텀)

- Build Phases 마지막에 Run Script 추가(이미 추가되어 있음)
  ```sh
  set -e
  HERMES_DSYM="${PODS_ROOT}/hermes-engine/destroot/Library/Frameworks/ios/hermes.framework.dSYM"
  DEST="${DWARF_DSYM_FOLDER_PATH}"
  if [ -d "$HERMES_DSYM" ]; then
    rsync -a "$HERMES_DSYM" "$DEST"
  fi
  ```
- RN 0.80의 Hermes 빌드 스크립트에 다음이 반영됨(패치로 고정)
  - `hermes.framework/Info.plist`에 `MinimumOSVersion` 주입
  - `dsymutil`로 `hermes.framework.dSYM` 생성
- node_modules 재설치 시 수정이 사라지지 않도록 `patch-package` 적용
  1) 한 번 실행(이미 적용됨):
     ```bash
     npx patch-package react-native
     ```
  2) 결과 파일: `patches/react-native+0.80.0.patch` (Git 커밋 필수)
  3) `package.json`에 postinstall 스크립트가 있어 설치 후 자동 적용됨
     ```json
     { "scripts": { "postinstall": "patch-package" } }
     ```
- React Native 버전 업 시
  - 패치가 맞지 않을 수 있음 → RN 업데이트 후 다시 `npx patch-package react-native` 실행해 새 패치 생성

## 환경/도구 요구 사항

- Node 24.x (nvm 권장)
- Homebrew + `cmake`, `make` 설치
- Xcode 16.x (iOS 18 SDK)
- iOS/Pods: `cd ios && pod install --repo-update`

## 서명/빌드 메모

- Signing
  - Debug: Apple Development
  - Release: Apple Distribution (자동 서명 권장)
- 빌드 태깅 예시: `git tag ios-1.0.0-build11`

## 문제 해결 요약

- 업로드에서 `hermes.framework dSYM`/`MinimumOSVersion` 오류 발생 시
  - 위 Run Script 유지, 패치 유지, Clean → Archive 재시도
