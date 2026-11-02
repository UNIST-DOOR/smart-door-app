import type BleService from '../ble/BleService';
import { APP_CONFIG } from '../../utils/constants';
import { calculateChecksum } from '../../utils/helpers';
import { perfLog } from '../../utils/perf';

export type PacketSendResult = {
  /**
   * OK: 도어락이 성공(0x81) 응답
   * DOOR_FAIL: 도어락이 실패(0x80) 또는 알 수 없는 응답
   * NO_RESPONSE: 전송은 끝났지만 응답 없음 (서명이 틀리면 모듈은 아무 응답도 하지 않음)
   * SEND_FAIL: BLE 쓰기 실패 또는 연결 없음
   */
  result: 'OK' | 'DOOR_FAIL' | 'NO_RESPONSE' | 'SEND_FAIL';
  /** 도어락 응답 hex (공백 없음). 응답이 있을 때만 */
  responseHex?: string;
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * 도어락 모듈에 패킷을 쓰고 응답을 기다린다.
 *
 * 방 문 열기 패킷은 앱 서버가 만들고 서명해서 내려준다. 앱은 키가 없고,
 * 받은 바이트를 한 글자도 바꾸지 않고 그대로 쓴다. (패킷을 만드는 코드는 이 앱에 없다)
 */
class DoorService {
  private bleService: BleService;
  private isSending = false;
  private cancelled = false;
  private settled = false;
  private settle: ((result: PacketSendResult) => void) | null = null;

  public onInfo?: (message: string) => void;

  constructor(bleService: BleService) {
    this.bleService = bleService;

    // BLE 응답 데이터 수신 처리
    this.bleService.onDataReceived = (data: string) => {
      this.handleBleResponse(data);
    };
  }

  /**
   * 패킷을 1바이트씩 쓰고 도어락 응답을 기다린다.
   * (모듈 GATT 특성 길이가 1바이트라 한 번에 쓸 수 없다)
   */
  async sendPacket(
    bytes: number[],
    options: { responseTimeoutMs?: number; bulk?: boolean } = {}
  ): Promise<PacketSendResult> {
    const timeoutMs = options.responseTimeoutMs ?? APP_CONFIG.RESPONSE_TIMEOUT;

    if (!this.bleService.isConnected()) {
      this.onInfo?.('기기가 연결되지 않음');
      return { result: 'SEND_FAIL' };
    }
    if (this.isSending) {
      this.onInfo?.('다른 명령이 이미 전송 중입니다');
      return { result: 'SEND_FAIL' };
    }

    this.isSending = true;
    this.cancelled = false;
    this.settled = false;

    // 응답 대기를 쓰기 시작 전에 준비한다. 마지막 바이트 직후 도착한 응답을 놓치지 않기 위해서다.
    const response = new Promise<PacketSendResult>(resolve => {
      this.settle = (result: PacketSendResult) => {
        if (this.settled) {
          return;
        }
        this.settled = true;
        resolve(result);
      };
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      this.onInfo?.(`패킷 전송 시작 (${bytes.length}바이트, ${options.bulk ? '한 번에' : '1바이트씩'})`);
      const sent = options.bulk ? await this.writeAtOnce(bytes) : await this.writeBytes(bytes);
      perfLog(`바이트 쓰기 끝 (${bytes.length}바이트)`);

      if (!this.settled) {
        if (!sent) {
          return { result: 'SEND_FAIL' };
        }
        this.onInfo?.(`장치 응답 대기 중... (${timeoutMs}ms)`);
        timer = setTimeout(() => this.settle?.({ result: 'NO_RESPONSE' }), timeoutMs);
      }
      return await response;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      this.settle = null;
      this.isSending = false;
    }
  }

  /**
   * 공동현관문 열기 (0x21). 이 패킷은 서명 대상이 아니다.
   */
  async openEntrance(): Promise<boolean> {
    const data = [0xCC, 0x21, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    data[9] = calculateChecksum(data, 9);
    const sent = await this.sendPacket(data, { responseTimeoutMs: APP_CONFIG.ENTRANCE_RESPONSE_TIMEOUT });
    return sent.result === 'OK';
  }

  cancelSending(): void {
    this.cancelled = true;
    this.settle?.({ result: 'SEND_FAIL' });
  }

  isSendingCommand(): boolean {
    return this.isSending;
  }

  /**
   * 패킷 전체를 한 번의 쓰기로 보낸다. (모듈 GATT 길이 64 펌웨어, MTU 충분할 때만)
   */
  private async writeAtOnce(bytes: number[]): Promise<boolean> {
    if (this.cancelled) {
      return false;
    }
    let ok = await this.bleService.sendByteArray(bytes);
    for (let retry = 0; !ok && retry < APP_CONFIG.MAX_RETRY_COUNT; retry++) {
      if (this.cancelled || this.settled) {
        break;
      }
      await sleep(APP_CONFIG.RETRY_DELAY);
      ok = await this.bleService.sendByteArray(bytes);
    }
    return ok;
  }

  private async writeBytes(bytes: number[]): Promise<boolean> {
    for (let i = 0; i < bytes.length; i++) {
      if (this.cancelled) {
        return false;
      }
      if (this.settled) {
        return true; // 모듈이 이미 응답함 (중단)
      }

      let ok = await this.bleService.sendByte(bytes[i]);
      for (let retry = 0; !ok && retry < APP_CONFIG.MAX_RETRY_COUNT; retry++) {
        await sleep(APP_CONFIG.RETRY_DELAY);
        ok = await this.bleService.sendByte(bytes[i]);
      }
      if (!ok) {
        return false;
      }

      if (i < bytes.length - 1) {
        await sleep(APP_CONFIG.BYTE_SEND_DELAY);
      }
    }
    return true;
  }

  /**
   * BLE 응답 처리. 응답 형식: [헤더][응답코드][명령]... 응답코드 0x81 성공, 0x80 실패
   */
  private handleBleResponse(hexData: string): void {
    if (!this.settle) {
      return;
    }

    const bytes = hexData.split(' ').map(hex => parseInt(hex, 16));
    if (bytes.length < 3 || bytes.some(byte => Number.isNaN(byte))) {
      return;
    }

    const responseHex = hexData.replace(/\s+/g, '');
    perfLog('도어락 응답 수신');
    if (bytes[1] === 0x81) {
      this.onInfo?.('장치응답: 성공 (0x81)');
      this.settle({ result: 'OK', responseHex });
    } else {
      this.onInfo?.(`장치응답: 실패 (0x${bytes[1].toString(16).toUpperCase()})`);
      this.settle({ result: 'DOOR_FAIL', responseHex });
    }
  }
}

export default DoorService;
