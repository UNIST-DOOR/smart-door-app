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
