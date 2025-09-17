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
 * 시간 동기화 명령어용 현재 시간 컴포넌트 가져오기
 */
export const getCurrentTimeComponents = () => {
  const now = new Date();
  return {
    year: now.getFullYear() % 100,  // 2자리 년도
    month: now.getMonth() + 1,      // 1-12
    date: now.getDate(),            // 1-31
    hour: now.getHours(),           // 0-23
    min: now.getMinutes()           // 0-59
  };
};

/**
 * 숫자 텍스트를 16진수 바이트 배열로 파싱
 * @param numberText "11 22 33 44 55 66 1" 형태의 입력 텍스트
 * @returns 최대 7개의 16진수 바이트 배열, 부족한 부분은 0xFF로 패딩
 */
export const parseNumberText = (numberText: string): number[] => {
  if (!numberText.trim()) {
    return Array(7).fill(0xFF);
  }
  
  // 공백 제거 및 짝수 길이 보장
  const cleanText = numberText.replace(/\s/g, '');
  const paddedText = cleanText.length % 2 !== 0 ? cleanText + 'F' : cleanText;
  
  // 바이트 쌍으로 변환하고 최대 7바이트 추출
  const bytePairs = paddedText.match(/.{1,2}/g) || [];
  const numbers = bytePairs.slice(0, 7).map(pair => {
    const parsed = parseInt(pair, 16);
    return isNaN(parsed) ? 0xFF : parsed;
  });
  
  // 7바이트까지 0xFF로 패딩
  while (numbers.length < 7) {
    numbers.push(0xFF);
  }
  
  return numbers;
};

/**
 * 16진수 문자열 입력을 숫자로 파싱 
 * @param text 16진수 형식의 입력 텍스트
 * @param defaultValue 파싱 실패시 기본값
 * @returns 파싱된 숫자 또는 기본값
 */
export const parseHexInput = (text: string, defaultValue: number = 0xFF): number => {
  if (!text.trim()) return defaultValue;
  
  const padded = text.padStart(2, '0');
  const parsed = parseInt(padded, 16);
  return isNaN(parsed) ? defaultValue : parsed;
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