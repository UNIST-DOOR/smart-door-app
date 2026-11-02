// BLE 서비스 및 특성 UUID
export const BLE_UUIDS = {
  // 기본 UUID (수정불가)
  BASIC_UUID: '00002902-0000-1000-8000-00805f9b34fb',

  // 메인 UUID (데이터 송수신용)
  MAIN_UUID: '8c2e1f04-37b3-4e4e-8c1a-f2d57ab8c3b6',

  // 알림(모듈<->앱) 제어 UUID
  NOTIFY_UUID: 'a7c384d0-5fc2-41a1-bf3a-1a8d0fc167be',

  // 도어락 제어 UUID
  COMMAND_UUID: 'c5bd6ef7-94ab-4ac6-a2dc-9235d7aa22cd',

  // (옵션) 대체 서비스와 특성 UUID
  ALT_SERVICE_UUID: 'd4e5df25-f713-4ed9-9983-7db4f4452c94',
  ALT_CHAR_UUID: 'd79f1ad1-97ec-4c14-955d-10662e1f6fca',
  ALT_NOTI_SERVICE: 'd4e5df25-f713-4ed9-9983-7db4f4452c94',
  ALT_NOTI_Characteristic: 'd79f1ad1-97ec-4c14-955d-10662e1f6fca'
} as const;

// 앱 설정
export const APP_CONFIG = {
  DEVICE_NAME_PREFIX: 'unist',
  SCAN_TIMEOUT: 12000,    // 스캔 타임아웃 12초
  CONNECTION_TIMEOUT: 5000,
  MAX_RETRY_COUNT: 3,
  BYTE_SEND_DELAY: 50,    // 바이트간 전송 지연시간 (ms)
  RETRY_DELAY: 100,       // 재시도 전 지연시간 (ms)
  RESPONSE_TIMEOUT: 5000, // 방 문 열기: 마지막 바이트 전송 후 도어락 응답 대기 (ms)
  ENTRANCE_RESPONSE_TIMEOUT: 3000, // 공동현관문 응답 대기 (ms)
  // 방 문 열기 패킷을 한 번에 쓴다. 모듈 GATT door_control 길이가 64로 확장된 펌웨어에서만 true.
  // 1바이트 펌웨어 모듈에서는 false 여야 한다. (공동현관문은 항상 1바이트씩)
  BULK_WRITE: true,
  REQUEST_MTU: 247, // 한 번에 쓰려면 MTU >= 패킷 길이 + 3 이 필요하다
  CONNECT_RETRY_COUNT: 1, // GATT 연결 실패 시 정리 후 자동 재시도 횟수
  CONNECT_RETRY_DELAY: 500 // 재시도 전 대기 (ms)
} as const;
