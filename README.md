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

## 새 Mac에서 클론 후 iOS 배포하기(전체 절차)

1) 필수 설치
- App Store에서 Xcode 16.x 설치 후 실행해 약관/컴포넌트 완료
- Homebrew 설치
  ```bash
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ```
- 도구 설치
  ```bash
  brew install nvm cmake make cocoapods
  ```
- Node(LTS 이상) 설치 및 사용
  ```bash
  mkdir -p ~/.nvm && echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc && echo 'source "$(brew --prefix nvm)/nvm.sh"' >> ~/.zshrc && source ~/.zshrc
  nvm install --lts && nvm use --lts
  node -v && npm -v
  ```

2) 저장소 클론 & 의존성 설치
```bash
git clone <REPO_URL>
cd smart-door-app
npm ci                  # postinstall로 Hermes 패치 자동 적용
cd ios && pod install --repo-update
```

3) 서명(코드사이닝) 설정
- Xcode > Settings… > Accounts에서 Apple ID 로그인
- UNIST 팀 선택 → Manage Certificates… → [+]로
  - Apple Development
  - Apple Distribution
  두 인증서 생성(각 항목에 열쇠 아이콘 있어야 함)
- 프로젝트 열기: `ios/SmartDoorManager.xcworkspace`
- TARGETS `SmartDoorManager` > Signing & Capabilities
  - Automatically manage signing 체크, Team=UNIST
  - Debug=Development, Release=Distribution(자동)

4) 운영 빌드 준비
- `ios/SmartDoorManager/Info.plist`에 아래 키가 있어야 함(본 저장소에는 반영됨)
  ```xml
  <key>ITSAppUsesNonExemptEncryption</key>
  <false/>
  ```
- `App.tsx` 운영 플래그 확인: `FORCE_LOCAL=false`

5) Archive & Upload
- Xcode 상단 Scheme=Release
- Product > Clean Build Folder
- 필요 시 Build 번호 +1(General > Identity > Build)
- Product > Archive → Distribute App → App Store Connect → Upload

6) TestFlight
- App Store Connect > My Apps > 앱 > TestFlight
- 빌드 Processing 완료 후
  - 내부(Internal): 사용자 추가 즉시 테스트 가능
  - 외부(External): 그룹 생성 → 베타 심사 제출 → 승인 후 메일/링크 배포

7) Hermes 커스텀 확인(문제 시)
- Build Phases 마지막에 `Copy Hermes dSYM` Run Script 존재
- `patches/react-native+*.patch`와 `package.json`의 `postinstall`이 커밋되어 있어야 함

git clone → npm ci → cd ios && pod install → Xcode에서 팀/서명만 연결 → Archive/Upload → TestFlight
