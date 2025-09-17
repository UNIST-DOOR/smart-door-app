import { EXTENDED_COMMANDS, APP_CONFIG } from '../../utils/constants';
import { calculateChecksum, getCurrentTimeComponents, parseNumberText, parseHexInput } from '../../utils/helpers';
import { SendQueueItem } from '../../types/door';
import BleService from '../ble/BleService';

interface CommandParams {
  orderText?: string;
  numberText?: string;
  cycleText?: string;
}

class DoorService {
  private bleService: BleService;
  private sendQueue: SendQueueItem[] = [];
  private isSending: boolean = false;
  private connectedDeviceName: string = '';
  
  // 응답 처리
  private waitingForResponse: boolean = false;
  private responsePromise: ((success: boolean) => void) | null = null;
  private responseTimeout: any = null;
  
  // 이벤트 콜백
  public onSendProgress?: (byte: number, remaining: number) => void;
  public onSendComplete?: () => void;
  public onSendError?: (error: string) => void;
  public onInfo?: (message: string) => void;

  constructor(bleService: BleService) {
    this.bleService = bleService;
    
    // BLE 응답 데이터 수신 처리
    this.bleService.onDataReceived = (data: string) => {
      this.handleBleResponse(data);
    };
  }

  /**
   * 연결된 기기명 설정 (외부에서 호출)
   */
  setConnectedDeviceName(deviceName: string): void {
    this.connectedDeviceName = deviceName;
    this.onInfo?.(`🔧 연결기기명 설정: ${deviceName}`);
  }

  /**
   * BLE ID 추출 (unist_306301 → 306301)
   */
  private extractBleId(): string {
    const match = this.connectedDeviceName.match(/unist_(\d+)/);
    return match ? match[1] : '000000';
  }

  /**
   * 현재 날짜 생성 (YYYYMMDD 형식)
   */
  private getCurrentDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * 추가 데이터 생성 (bleID + date + key)
   */
  private generateAdditionalData(): number[] {
    const bleId = this.extractBleId();
    const date = this.getCurrentDate();
    const key = '1';
    
    this.onInfo?.(`🔧 추가데이터 - BLE ID: ${bleId}, Date: ${date}, Key: ${key}`);
    
    const additionalData: number[] = [];
    
    // 구분자 추가
    additionalData.push(0x2F); // /
    
    // BLE ID 각 자릿수를 hex로 변환
    for (let i = 0; i < bleId.length; i++) {
      const digit = parseInt(bleId[i], 10);
      additionalData.push(digit);
    }
    
    additionalData.push(0x2F); // /
    
    // Date 각 자릿수를 hex로 변환
    for (let i = 0; i < date.length; i++) {
      const digit = parseInt(date[i], 10);
      additionalData.push(digit);
    }
    
    additionalData.push(0x2F); // /
    
    // Key 추가
    additionalData.push(parseInt(key, 10));
    
    additionalData.push(0x2F); // /
    additionalData.push(0x0D); // 종료 마커
    
    return additionalData;
  }

  /**
   * 명령어 코드 기반 명령어 데이터 생성
   */
  private generateCommandData(command: number, params?: CommandParams): number[] {
    const commandByte = command & 0xFF; // eslint-disable-line no-bitwise
    
    // 13바이트 확장 패킷이 필요한 명령어들
    const isExtended = (EXTENDED_COMMANDS as readonly number[]).includes(command);
    const dataSize = isExtended ? 13 : 10;
    const data = new Array(dataSize).fill(0);
    
    // 공통 헤더
    data[0] = 0xCC;
    data[1] = commandByte;
    data[2] = 0x00;

    
    switch (commandByte) {
      case 0x00: {
        // 원격 도어락 닫힘 - aPW1~aPW4 (관리자 비밀번호)
        data[3] = 0x00;
        data[4] = 0x00;
        data[5] = 0x00;        // aPW1
        data[6] = 0x00;        // aPW2
        data[7] = 0x00;        // aPW3
        data[8] = 0x00;        // aPW4
        break;
      }
      
      case 0x01: {
        // 원격 도어락 열림 - aPW1~aPW4 (관리자 비밀번호) + 추가 데이터
        data[3] = 0x00;        // 지연 시간
        data[4] = 0x00;
        data[5] = 0x00;        // aPW1
        data[6] = 0x00;        // aPW2
        data[7] = 0x00;        // aPW3
        data[8] = 0x00;        // aPW4
        
        // 추가 데이터 생성 및 병합
        const additionalData = this.generateAdditionalData();
        const baseData = data.slice(0, dataSize); // 기본 10바이트
        
        // 체크섬 계산 (기본 데이터만)
        const checksumIndex = dataSize - 1;
        baseData[checksumIndex] = calculateChecksum(baseData, checksumIndex);
        
        // 기본 데이터 + 추가 데이터 병합
        const fullData = [...baseData, ...additionalData];
        
        this.onInfo?.(`🔧 기본데이터 (${baseData.length}바이트): ${baseData.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`);
        this.onInfo?.(`🔧 추가데이터 (${additionalData.length}바이트): ${additionalData.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`);
        
        return fullData;
      }
      
      case 0x02: {
        // 원격 도어락 상태 확인 - abPW1~abPW4 (관리자/BLE 비밀번호)
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x03:
      case 0x04: {
        // 예약된 명령어 - 기본 10바이트 패킷
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x06: {
        // 사용통제 설정 (카드,번호,스마트폰BLE) - aPW1~aPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x07: {
        // 사용통제 해제 (카드,번호,스마트폰BLE) - aPW1~aPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x08: {
        // 수동잠김모드 설정 - abPW1~abPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x09: {
        // 자동잠김모드 설정 - abPW1~abPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x0A: {
        // 스마트폰BLE로 도어락 문열림 - bPW1~bPW4 (BLE 비밀번호)
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x0B: {
        // 스마트폰 인증번호 설정변경 - bPW1~bPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x0D: {
        // 공장 출하시 상태로 초기화 - aPW1~aPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x0E: {
        // 슈퍼관리자 인증번호 설정변경 - aPW1~aPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x0F: {
        // 터치패드 비밀번호 설정변경(4자리) - tPW1~tPW4 (터치패드 비밀번호)
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x10: {
        // 스마트폰BLE로 도어락 문닫기 - bPW1~bPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x11: {
        // 원격 최근발생 이벤트 요청 - abPW1~abPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x12: {
        // 무음 설정: 도어록에서 소리가 나지 않음 - abPW1~abPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x13: {
        // 무음 해제: 도어록에서 소리가 발생됨 - abPW1~abPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x14: {
        // 실제 문열린 이벤트: 실제 문이 열렸던 시간 요청 - abPW1~abPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x15: {
        // 카드관련 도어락 셋팅: 호텔코드(3) + 도어락ID(2) + 층번호(1)
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x16: {
        // 카드관련 도어락 셋팅 값 조회 - aPW1~aPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x17: {
        // 터치패드 매니저비밀번호 설정변경 - tPW1~tPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x18: {
        // 터치패드 메이드비밀번호 설정변경 - tPW1~tPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x19: {
        // 비밀번호 사용자구분 확인 - 사용자구분 + tPW1~tPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x1A: {
        // 터치패드 비밀번호 설정변경(8자리) - 설정 + tPW1~tPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x1B: {
        // 터치패드 비밀번호 모드 확인 - 설정값 + tPW1~tPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x1C: {
        // 배터리 잔량 확인 - tPW1~tPW4
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x21: {
        // 공동현관문 열기 - 특별 오픈신호 (9바이트)
        data[0] = 0xCC;        // 고정 헤더
        data[1] = 0x21;        // 명령어 코드
        data[2] = 0x01;        // 특별 신호
        data[3] = 0x00;
        data[4] = 0x00;
        data[5] = 0x00;
        data[6] = 0x00;
        data[7] = 0x00;
        data[8] = 0x00;
        break;
      }
      
      case 0x05: {
        // 현재시간 설정 - 년, 월, 일, 시, 분
        const time = getCurrentTimeComponents();
        data[3] = 0x00;
        data[4] = time.year;
        data[5] = time.month;
        data[6] = time.date;
        data[7] = time.hour;
        data[8] = time.min;
        break;
      }
      
      case 0x0C: {
        // 번호키 사용가능시간 세팅 - 년, 월, 일, 시, 분
        const time = getCurrentTimeComponents();
        data[3] = 0x00;
        data[4] = time.year;
        data[5] = time.month;
        data[6] = time.date;
        data[7] = time.hour;
        data[8] = time.min;
        break;
      }
      
      case 0x1D: {
        // 13바이트 확장 패킷 - 카드 등록 (학생증 등록)
        // 순번 + 번호1~번호7 + 차수 + sum(1:12)
        const order = parseHexInput(params?.orderText || '', 0xFF);
        const numbers = parseNumberText(params?.numberText || '');
        const cycle = parseHexInput(params?.cycleText || '', 0xFF);
        
        data[3] = order;       // 순번
        for (let i = 0; i < 7; i++) {
          data[4 + i] = numbers[i];  // 번호1~번호7
        }
        data[11] = cycle;      // 차수
        break;
      }
      
      case 0x1E: {
        // 13바이트 확장 패킷 - 학생증 도어 제어 삭제
        // 순번 + 0x00(9바이트) + sum(1:12)
        const order = parseHexInput(params?.orderText || '', 0xFF);
        data[3] = order;       // 삭제할 학생증 순번
        for (let i = 4; i <= 11; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      case 0x1F: {
        // 13바이트 확장 패킷 - 학생증 전체 삭제
        // 모든 데이터 0x00 + sum(1:12)
        for (let i = 3; i <= 11; i++) {
          data[i] = 0x00;
        }
        break;
      }
      
      default: {
        // 알 수 없는 명령어 - 기본 패킷
        for (let i = 3; i <= 8; i++) {
          data[i] = 0x00;
        }
        break;
      }
    }

    // 체크섬 계산 (마지막 바이트 제외한 모든 바이트의 합)
    const checksumIndex = dataSize - 1;
    data[checksumIndex] = calculateChecksum(data, checksumIndex);
    
    return data;
  }

  /**
   * BLE 응답 데이터 처리
   */
  private handleBleResponse(hexData: string): void {
    if (!this.waitingForResponse) {
      return;
    }

    try {
      // 16진수 문자열을 바이트 배열로 변환
      const bytes = hexData.split(' ').map(hex => parseInt(hex, 16));
      
      if (bytes.length >= 3) {
        const header = bytes[0];
        const responseCode = bytes[1];  // 응답코드가 두 번째 바이트
        const command = bytes[2];       // 명령이 세 번째 바이트
        
        this.onInfo?.(`📡 응답분석: 헤더=0x${header.toString(16).toUpperCase()}, 응답코드=0x${responseCode.toString(16).toUpperCase()}, 명령=0x${command.toString(16).toUpperCase()}`);
        
        // 응답 처리
        if (responseCode === 0x81) {
          this.onInfo?.(`🎉 장치응답: 성공 (0x81)`);
          this.resolveResponse(true);
        } else if (responseCode === 0x80) {
          this.onInfo?.(`❌ 장치응답: 실패 (0x80)`);
          this.resolveResponse(false);
        } else {
          this.onInfo?.(`⚠️ 알 수 없는 응답코드: 0x${responseCode.toString(16).toUpperCase()}`);
          this.resolveResponse(false);
        }
      }
    } catch (error) {
      this.onSendError?.(`응답 처리 오류: ${error}`);
    }
  }

  /**
   * 응답 대기 완료 처리
   */
  private resolveResponse(success: boolean): void {
    this.waitingForResponse = false;
    
    if (this.responseTimeout) {
      clearTimeout(this.responseTimeout);
      this.responseTimeout = null;
    }
    
    if (this.responsePromise) {
      this.responsePromise(success);
      this.responsePromise = null;
    }
    
    // 1초 후 자동 연결 해제
    setTimeout(() => {
      this.bleService.disconnect();
      this.onInfo?.(`🔌 연결 해제 완료`);
    }, 1000);
  }

  /**
   * 매개변수와 함께 명령 전송 및 응답 대기
   */
  async sendCommand(command: number, params?: CommandParams): Promise<boolean> {
    if (!this.bleService.isConnected()) {
      this.onSendError?.('기기가 연결되지 않음');
      return false;
    }

    if (this.isSending) {
      this.onSendError?.('다른 명령이 이미 전송 중입니다');
      return false;
    }

    try {
      const data = this.generateCommandData(command, params);
      
      // 디버깅: 생성된 명령어 데이터 로그
      const hexString = data.map(byte => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
      this.onInfo?.(`🔧 전송데이터: ${hexString}`);
      
      // 큐 초기화 및 새 데이터 추가
      this.sendQueue = [];
      data.forEach(byte => {
        this.sendQueue.push({
          byte,
          retryCount: 0
        });
      });

      this.isSending = true;
      
      // 전송 완료 후 응답 대기를 위한 Promise 생성
      return new Promise(async (resolve) => {
        // onSendComplete 콜백을 임시로 재정의
        const originalOnSendComplete = this.onSendComplete;
        
        this.onSendComplete = () => {
          // 원래 콜백 호출
          originalOnSendComplete?.();
          
          // 응답 대기 시작
          this.onInfo?.(`⏳ 장치 응답 대기 중... (3초 타임아웃)`);
          this.waitForResponse(3000).then(resolve);
          
          // 원래 콜백 복원
          this.onSendComplete = originalOnSendComplete;
        };
        
        // 바이트 전송 시작
        await this.sendNextByte();
        this.onInfo?.(`✅ 명령어 0x${command.toString(16).toUpperCase()} 전송완료`);
      });
      
    } catch (error) {
      this.onSendError?.(`❌ 명령어 전송실패: ${error}`);
      return false;
    }
  }

  /**
   * 장치 응답 대기
   */
  private async waitForResponse(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.waitingForResponse = true;
      this.responsePromise = resolve;
      
      // 타임아웃 설정
      this.responseTimeout = setTimeout(() => {
        this.onInfo?.(`⏰ 응답 타임아웃 (${timeoutMs}ms)`);
        this.resolveResponse(false);
      }, timeoutMs);
    });
  }

  /**
   * 큐에서 다음 바이트 전송
   */
  private async sendNextByte(): Promise<void> {
    if (this.sendQueue.length === 0) {
      this.isSending = false;
      this.onSendComplete?.();
      return;
    }

    const queueItem = this.sendQueue.shift()!;
    const success = await this.bleService.sendByte(queueItem.byte);
    
    if (success) {
      this.onSendProgress?.(queueItem.byte, this.sendQueue.length);
      
      // 지연 후 다음 바이트 계속 전송
      setTimeout(() => {
        this.sendNextByte();
      }, APP_CONFIG.BYTE_SEND_DELAY);
      
    } else {
      // 재시도 로직
      if (queueItem.retryCount < APP_CONFIG.MAX_RETRY_COUNT) {
        queueItem.retryCount++;
        this.sendQueue.unshift(queueItem); // 큐 맨 앞으로 다시 넣기
        
        setTimeout(() => {
          this.sendNextByte();
        }, APP_CONFIG.RETRY_DELAY);
        
      } else {
        this.isSending = false;
        this.onSendError?.(`바이트 전송 실패: 0x${queueItem.byte.toString(16).toUpperCase()}`);
      }
    }
  }

  /**
   * 화면 표시용 명령어명 가져오기
   */
  getCommandName(code: number): string {
    return `0x${code.toString(16).toUpperCase().padStart(2, '0')}`;
  }

  /**
   * 확장 명령어인지 확인 (13바이트 패킷 필요)
   */
  isExtendedCommand(code: number): boolean {
    return (EXTENDED_COMMANDS as readonly number[]).includes(code);
  }

  /**
   * 현재 전송 중인지 확인
   */
  isSendingCommand(): boolean {
    return this.isSending;
  }

  /**
   * 현재 전송 작업 취소
   */
  cancelSending(): void {
    this.sendQueue = [];
    this.isSending = false;
  }

  /**
   * 빠른 명령어 메서드들 (명령어 표 기준)
   */
  async openDoor(): Promise<boolean> {
    // 0x01: 원격 도어락 열림
    return this.sendCommand(0x01);
  }

  async closeDoor(): Promise<boolean> {
    // 0x00: 원격 도어락 닫힘
    return this.sendCommand(0x00);
  }

  async checkStatus(): Promise<boolean> {
    // 0x02: 원격 도어락 상태 확인
    return this.sendCommand(0x02);
  }

  async checkBattery(): Promise<boolean> {
    // 0x1C: 배터리 잔량 확인
    return this.sendCommand(0x1C);
  }

  async setTime(): Promise<boolean> {
    // 0x05: 현재시간 설정
    return this.sendCommand(0x05);
  }

  async registerStudent(orderText: string, numberText: string, cycleText: string): Promise<boolean> {
    // 0x1D: 카드 등록 (학생증 등록) - 13바이트 확장 패킷
    return this.sendCommand(0x1D, { orderText, numberText, cycleText });
  }

  async deleteStudent(orderText: string): Promise<boolean> {
    // 0x1E: 학생증 도어 제어 삭제 - 13바이트 확장 패킷
    return this.sendCommand(0x1E, { orderText });
  }

  async deleteAllStudents(): Promise<boolean> {
    // 0x1F: 학생증 전체 삭제 - 13바이트 확장 패킷
    return this.sendCommand(0x1F);
  }
}

export default DoorService; 