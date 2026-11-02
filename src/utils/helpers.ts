/**
 * 명령어 데이터 체크섬 계산
 * @param data 체크섬을 계산할 바이트 배열
 * @param length 계산에 포함할 바이트 수  
 * @returns 계산된 체크섬 바이트
 */
export const calculateChecksum = (data: number[], length: number): number => {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += data[i] & 0xFF;
  }
  return sum & 0xFF;
};

/**
 * 바이트 배열을 16진수 문자열로 변환 (로깅용)
 * @param bytes 바이트 배열
 * @returns 16진수 문자열 표현
 */
export const bytesToHexString = (bytes: number[]): string => {
  return bytes.map(byte => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
};

/**
 * 로그 메시지용 고유 ID 생성
 * @returns 고유한 문자열 ID
 */
export const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

/**
 * 화면 표시용 타임스탬프 포맷팅
 * @param date Date 객체
 * @returns 포맷된 시간 문자열
 */
export const formatTimestamp = (date: Date): string => {
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit', 
    second: '2-digit'
  });
};

/**
 * 기기명이 대상 접두사와 일치하는지 확인
 * @param deviceName 확인할 기기명
 * @param prefix 대상 접두사 (기본값: 'unist')
 * @returns 기기가 대상과 일치하면 true
 */
export const isTargetDevice = (deviceName: string | null, prefix: string = 'unist'): boolean => {
  return deviceName !== null && deviceName.toLowerCase().startsWith(prefix.toLowerCase());
};

/**
 * 사용자 정보 기반 기기명 생성 (동 + 호수)
 * @param building 동 정보 (예: "301동")
 * @param room 호수 정보 (예: "101")
 * @returns 기기명 (예: "unist_301101")
 */
export const generateDeviceName = (building: string, room: string): string => {
  // 동 정보에서 숫자 추출 (301동 → 301)
  const buildingNumber = building.replace(/[^0-9]/g, '');
  // 호수 정보에서 숫자 추출 (101 → 101)
  const roomNumber = room.replace(/[^0-9]/g, '');
  
  return `unist_${buildingNumber}${roomNumber}`;
};

/**
 * 동 정보로부터 공동현관문 BLE 접두사 생성
 * 예) building: "306동" → "unistdoor_306"
 */
export const generateEntrancePrefix = (building: string): string => {
  const buildingNumber = (building || '').replace(/[^0-9]/g, '');
  return `unistdoor_${buildingNumber}`;
};

/**
 * 서버가 내려준 hex 문자열을 바이트 배열로 변환 (공백/대소문자 무시)
 * @returns 형식이 올바르지 않거나 비어 있거나 64바이트를 넘으면 null
 */
export const hexToBytes = (hex: string): number[] | null => {
  const clean = (hex || '').replace(/\s+/g, '');
  if (clean.length === 0 || clean.length % 2 !== 0 || clean.length > 128 || !/^[0-9a-fA-F]+$/.test(clean)) {
    return null;
  }
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return bytes;
};
