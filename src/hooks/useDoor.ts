import { useState, useEffect, useRef, useCallback } from 'react';
import DoorService from '../services/door/DoorService';
import BleService from '../services/ble/BleService';
import {
  OpenResultCode,
  flushPendingResults,
  reportOpenResult,
  requestOpenPacket,
  OpenPacketResponse,
} from '../services/door/OpenDoorApi';
import { LogMessage, LogLevel } from '../types/door';
import { APP_CONFIG } from '../utils/constants';
import { generateId, generateEntrancePrefix } from '../utils/helpers';
import { perfLog, perfReset } from '../utils/perf';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export type OpenOutcome =
  | { status: 'OK' }
  | { status: 'UPGRADE_REQUIRED' } // 최소 버전 미만 (426)
  | { status: 'UNAUTHORIZED' } // 로그인 만료 (401)
  | { status: 'FORBIDDEN'; reason?: string } // 권한 없음 (403)
  | { status: 'RATE_LIMITED' }
  | { status: 'OFFLINE' } // 서버에서 패킷을 받아야 하므로 오프라인에서는 열 수 없음
  | { status: 'PERMISSION_DENIED' } // 앱의 블루투스(안드로이드는 위치 포함) 권한이 없음
  | { status: 'BLUETOOTH_OFF' } // 블루투스가 꺼져 있음
  | { status: 'BLE_FAIL' } // 스캔·연결·전송 실패
  | { status: 'NO_RESPONSE' } // 도어락 무응답
  | { status: 'DOOR_FAIL' } // 도어락이 실패 응답
  | { status: 'ERROR' };

const issueFailureToOutcome = (issued: Exclude<OpenPacketResponse, { kind: 'ok' }>): OpenOutcome => {
  switch (issued.kind) {
    case 'upgrade_required':
      return { status: 'UPGRADE_REQUIRED' };
    case 'unauthorized':
      return { status: 'UNAUTHORIZED' };
    case 'forbidden':
      return { status: 'FORBIDDEN', reason: issued.reason };
    case 'rate_limited':
      return { status: 'RATE_LIMITED' };
    case 'offline':
      return { status: 'OFFLINE' };
    default:
      return { status: 'ERROR' };
  }
};

export const useDoor = (bleService: BleService | null) => {
  const [isSending, setIsSending] = useState(false);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const doorServiceRef = useRef<DoorService | null>(null);

  // 로그에는 패킷 내용(키로 서명된 바이트)을 남기지 않는다.
  const addLog = useCallback((message: string, level: LogLevel = 'info') => {
    const newLog: LogMessage = {
      id: generateId(),
      message,
      level,
      timestamp: new Date(),
    };
    setLogs(prev => [...prev, newLog]);
  }, []);

  useEffect(() => {
    if (!bleService) return;

    const doorService = new DoorService(bleService);
    doorService.onInfo = (message: string) => addLog(message, 'info');
    doorServiceRef.current = doorService;

    return () => {
      doorService.cancelSending();
    };
  }, [bleService, addLog]);

  /**
   * 방 문 열기: 앱 서버에서 서명된 패킷 받기 → 스캔·연결 → 패킷 쓰기 → 응답 대기 → 연결 종료 → 결과 보고
   * 응답이 없으면(서명이 틀리면 모듈은 응답하지 않는다) 새 패킷을 받아 1회만 재시도한다.
   * 패킷은 1회용이라 저장하거나 다시 쓰지 않는다.
   */
  const openRoomDoor = async (options: {
    bleid?: string;
    fallbackDeviceName?: string;
  }): Promise<OpenOutcome> => {
    const doorService = doorServiceRef.current;
    if (!bleService || !doorService) {
      addLog('❌ BLE 서비스가 초기화되지 않았습니다', 'error');
      return { status: 'ERROR' };
    }

    setIsSending(true);
    bleService.onError = (message: string) => addLog(message, 'info');

    // 연결이 끝난 뒤 모듈이 안정될 때까지의 고정 대기. 연결(MTU 협상 포함)이 끝난 시점부터 잰다.
    const SETTLE_MS = 1000;

    // 도어락 검색·연결·MTU 협상. 서버 호출과 동시에 진행되며 절대 reject 되지 않는다.
    const connectDoor = async (name?: string): Promise<{ connected: boolean; mtu: number | null; readyAt: number }> => {
      let connected = false;
      try {
        connected = !!name && (await bleService.scanAndAutoConnect(name));
      } catch {
        connected = false;
      }
      perfLog(connected ? 'BLE 스캔+연결 완료' : 'BLE 연결 실패');

      let mtu: number | null = null;
      if (connected && APP_CONFIG.BULK_WRITE) {
        mtu = await bleService.requestMtu(APP_CONFIG.REQUEST_MTU);
        perfLog(`MTU 협상 (${mtu ?? '실패'})`);
      }
      return { connected, mtu, readyAt: Date.now() };
    };

    const attempt = async (retryOf?: string): Promise<{ outcome: OpenOutcome; requestId?: string }> => {
      const startedAt = Date.now();
      perfReset(retryOf ? '문 열기 재시도' : '문 열기 시작');

      // 서버 패킷 발급과 도어락 검색·연결을 동시에 시작한다. 둘 다 끝나야 패킷을 쓴다.
      // 서버가 거절하면(403, 426, 오프라인 등) 진행 중인 스캔·연결을 즉시 중단한다.
      const earlyName = options.bleid ? `unist_${options.bleid}` : options.fallbackDeviceName;
      addLog('1️⃣ 서버 패킷 요청 + 도어락 검색 동시 시작...', 'info');
      const issuing = requestOpenPacket({ bleid: options.bleid, retryOf }).then(response => {
        perfLog(`서버 패킷 응답 (${response.kind})`);
        if (response.kind !== 'ok') {
          bleService.cancelConnect();
        }
        return response;
      });
      const connecting = connectDoor(earlyName);

      const issued = await issuing;
      if (issued.kind !== 'ok') {
        addLog(`❌ 패킷 발급 실패: ${issued.kind}`, 'error');
        await connecting; // 중단이 끝나길 기다린다
        await bleService.disconnect(); // 혹시 연결됐다면 끊는다
        return { outcome: issueFailureToOutcome(issued) };
      }
      addLog(`✅ 패킷 수신 (${issued.packet.length}바이트, ${issued.signed ? '서명' : '원본'})`, 'success');

      // 서버가 찾은 bleid 가 우선이다 (앱이 가진 값은 화면 표시용 정보일 수 있음)
      const targetName = issued.bleid ? `unist_${issued.bleid}` : earlyName;
      let conn = await connecting;
      if (earlyName !== targetName) {
        // 앱이 짐작한 문과 서버가 찾은 문이 다르거나 처음에 문 이름을 몰랐던 경우(드묾): 올바른 문에 다시 연결한다
        if (conn.connected) {
          await bleService.disconnect();
        }
        conn = await connectDoor(targetName);
      }

      let result: OpenResultCode;
      let stage: string;
      let responseHex: string | undefined;

      if (!conn.connected) {
        result = 'BLE_FAIL';
        // 실패 원인 코드(예: connect:E133, connect:SCAN_TIMEOUT)를 함께 남긴다 (STAGE 는 20자 이내)
        stage = `connect${bleService.lastConnectError ? `:${bleService.lastConnectError}` : ''}`.slice(0, 20);
      } else {
        // 패킷을 한 번에 쓸 수 있는지(MTU) 확인. 부족하면 1바이트씩 쓴다.
        const bulk = conn.mtu !== null && conn.mtu >= issued.packet.length + 3;
        if (APP_CONFIG.BULK_WRITE) {
          perfLog(`패킷 쓰기 방식: ${bulk ? '한 번에 쓰기' : '1바이트씩 쓰기'}`);
        }

        // 연결 후 고정 대기. 서버 응답을 기다린 시간도 여기에 포함되므로 연결 후 1초보다 짧아지지는 않는다.
        const remaining = Math.max(0, SETTLE_MS - (Date.now() - conn.readyAt));
        if (remaining > 0) {
          await sleep(remaining);
        }
        perfLog('고정 대기 끝');

        addLog('3️⃣ 패킷 전송 중...', 'info');
        const sent = await doorService.sendPacket(issued.packet, {
          responseTimeoutMs: APP_CONFIG.RESPONSE_TIMEOUT,
          bulk,
        });
        responseHex = sent.responseHex;
        perfLog(`패킷 전송·응답 끝 (${sent.result})`);
        switch (sent.result) {
          case 'OK':
            result = 'OK';
            stage = 'response';
            break;
          case 'DOOR_FAIL':
            result = 'DOOR_FAIL';
            stage = 'response';
            break;
          case 'NO_RESPONSE':
            result = 'NO_RESPONSE';
            stage = 'response';
            break;
          default:
            result = 'BLE_FAIL';
            stage = 'write';
        }
        // 응답을 받은 경우 도어락이 문을 처리할 시간을 잠시 준 뒤 연결을 끊는다.
        if (sent.result === 'OK' || sent.result === 'DOOR_FAIL') {
          await sleep(500);
        }
      }

      await bleService.disconnect();
      perfLog('연결 종료');

      // 결과 보고는 문 열기 결과에 영향을 주지 않는다 (실패하면 저장했다가 나중에 보냄)
      reportOpenResult({
        requestId: issued.requestId,
        result,
        stage,
        doorResponseHex: responseHex,
        elapsedMs: Date.now() - startedAt,
      }).catch(() => {});

      return { outcome: { status: result } as OpenOutcome, requestId: issued.requestId };
    };

    try {
      flushPendingResults().catch(() => {});

      addLog('🔍 문 열기 시작...', 'info');
      const initialized = await bleService.initialize();
      if (!initialized) {
        addLog('❌ BLE 초기화 실패', 'error');
        // 권한 거부나 블루투스 꺼짐은 도어락 연결 실패와 해결 방법이 달라서 따로 알린다
        if (bleService.lastInitFailure === 'PERMISSION') {
          return { status: 'PERMISSION_DENIED' };
        }
        if (bleService.lastInitFailure === 'POWERED_OFF') {
          return { status: 'BLUETOOTH_OFF' };
        }
        return { status: 'BLE_FAIL' };
      }

      let current = await attempt();
      if (current.outcome.status === 'NO_RESPONSE' && current.requestId) {
        addLog('⚠️ 응답 없음 - 새 패킷으로 1회 재시도', 'warning');
        current = await attempt(current.requestId);
      }

      if (current.outcome.status === 'OK') {
        addLog('🎉 문열기 완료!', 'success');
      }
      return current.outcome;
    } catch (error) {
      addLog(`❌ 문열기 오류: ${error}`, 'error');
      return { status: 'ERROR' };
    } finally {
      setIsSending(false);
      bleService.onError = undefined;
    }
  };

  /**
   * 공동현관문 열기: 동 번호 접두사로 스캔·연결 → 0x21 전송. 이 패킷은 서명 대상이 아니다.
   */
  const openEntranceDoor = async (building: string): Promise<boolean> => {
    const doorService = doorServiceRef.current;
    if (!bleService || !doorService) {
      addLog('❌ BLE 서비스가 초기화되지 않았습니다', 'error');
      return false;
    }

    setIsSending(true);
    bleService.onError = (message: string) => addLog(message, 'info');

    try {
      addLog('🚪 공동현관문 열기 시작...', 'info');
      const initialized = await bleService.initialize();
      if (!initialized) {
        addLog('❌ BLE 초기화 실패', 'error');
        return false;
      }

      const prefix = generateEntrancePrefix(building);
      addLog(`접두사(${prefix})로 공동현관 BLE 검색 중...`, 'info');
      let connected = false;
      try {
        connected = await bleService.scanAndAutoConnectByPrefix(prefix);
      } catch {
        connected = false;
      }
      if (!connected) {
        addLog('❌ 공동현관 BLE 연결 실패(접두사 매칭)', 'error');
        return false;
      }

      await sleep(1000); // 서비스 발견 완료 대기
      const success = await doorService.openEntrance();
      addLog(success ? '🎉 공동현관문 열기 완료!' : '❌ 공동현관문 열기 명령 실패', success ? 'success' : 'error');

      await sleep(500);
      await bleService.disconnect();
      return success;
    } catch (error) {
      addLog(`❌ 공동현관문 열기 오류: ${error}`, 'error');
      return false;
    } finally {
      setIsSending(false);
      bleService.onError = undefined;
    }
  };

  const clearLogs = () => {
    setLogs([]);
    addLog('로그가 삭제되었습니다', 'info');
  };

  return {
    isSending,
    logs,
    openRoomDoor,
    openEntranceDoor,
    clearLogs,
    addLog,
  };
};
