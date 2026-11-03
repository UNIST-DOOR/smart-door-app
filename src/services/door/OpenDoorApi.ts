import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiPost } from '../../lib/api';
import { hexToBytes } from '../../utils/helpers';

/**
 * 앱 서버의 문 열기 API.
 *  - POST /api/door/open-packet/ : 권한 확인 후 서버가 만들고 서명한 패킷을 받는다 (1회용)
 *  - POST /api/door/open-result/ : 도어락 응답 결과를 보고한다 (참고용 로그)
 */

export type OpenPacketResponse =
  | { kind: 'ok'; requestId: string; packet: number[]; signed: boolean; bleid?: string }
  | { kind: 'upgrade_required' } // 426: 최소 버전보다 낮음
  | { kind: 'unauthorized' } // 401: 로그인 만료
  | { kind: 'forbidden'; reason?: string } // 403: 방 배정 없음, 이용기간 만료 등
  | { kind: 'rate_limited' } // 429
  | { kind: 'offline' } // 서버에 연결할 수 없음
  | { kind: 'error' };

/** 서버가 이 시간 안에 응답하지 않으면 통신 불가로 보고 문 열기를 중단한다. */
export const OPEN_PACKET_TIMEOUT_MS = 8000;

export const requestOpenPacket = async (params: {
  bleid?: string;
  retryOf?: string;
}): Promise<OpenPacketResponse> => {
  let res;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('open-packet timeout')), OPEN_PACKET_TIMEOUT_MS);
    });
    res = await Promise.race([
      apiPost('/api/door/open-packet/', { bleid: params.bleid, retryOf: params.retryOf }),
      timeout,
    ]);
  } catch {
    return { kind: 'offline' };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }

  switch (res.status) {
    case 426:
      return { kind: 'upgrade_required' };
    case 401:
      return { kind: 'unauthorized' };
    case 403: {
      const reason = res.data && typeof res.data === 'object' ? res.data.reason : undefined;
      return { kind: 'forbidden', reason: typeof reason === 'string' ? reason : undefined };
    }
    case 429:
      return { kind: 'rate_limited' };
  }

  const body = res.data;
  if (!res.ok || !body || typeof body !== 'object' || !body.ok || typeof body.requestId !== 'string') {
    return { kind: 'error' };
  }
  const packet = hexToBytes(String(body.packetHex || ''));
  if (!packet) {
    return { kind: 'error' };
  }
  return {
    kind: 'ok',
    requestId: body.requestId,
    packet,
    signed: Boolean(body.signed),
    bleid: body.bleid ? String(body.bleid) : undefined,
  };
};

export type OpenResultCode = 'OK' | 'NO_RESPONSE' | 'BLE_FAIL' | 'DOOR_FAIL';

export interface OpenResultReport {
  requestId: string;
  result: OpenResultCode;
  stage: string;
  doorResponseHex?: string;
  elapsedMs: number;
}

const PENDING_KEY = 'PENDING_OPEN_RESULTS';
const MAX_PENDING = 20;
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;

type PendingReport = OpenResultReport & { savedAt: number };
type PostOutcome = 'sent' | 'drop' | 'retry';

const postResult = async (report: OpenResultReport): Promise<PostOutcome> => {
  try {
    const res = await apiPost('/api/door/open-result/', {
      requestId: report.requestId,
      result: report.result,
      stage: report.stage,
      doorResponseHex: report.doorResponseHex,
      elapsedMs: report.elapsedMs,
    });
    if (res.ok) {
      return 'sent';
    }
    // 서버 오류, 요청 과다, 로그인 만료는 나중에 다시 보낸다. 그 외 4xx(404 등)는 다시 보내도 소용없다.
    return res.status >= 500 || res.status === 429 || res.status === 401 ? 'retry' : 'drop';
  } catch {
    return 'retry'; // 통신 불가
  }
};

const readPending = async (): Promise<PendingReport[]> => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const writePending = async (list: PendingReport[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
  } catch {
    // 저장 실패는 무시 (참고용 로그)
  }
};

let flushing = false;

/** 통신이 안 돼 저장해 둔 결과를 보낸다. 순서대로 보내다 실패하면 멈추고 나머지는 남긴다. */
export const flushPendingResults = async (): Promise<void> => {
  if (flushing) {
    return;
  }
  flushing = true;
  try {
    const now = Date.now();
    const list = (await readPending()).filter(item => now - item.savedAt <= MAX_PENDING_AGE_MS);
    const remaining: PendingReport[] = [];
    let blocked = false;
    for (const item of list) {
      if (blocked) {
        remaining.push(item);
        continue;
      }
      const outcome = await postResult(item);
      if (outcome === 'retry') {
        blocked = true;
        remaining.push(item);
      }
    }
    await writePending(remaining);
  } finally {
    flushing = false;
  }
};

/** 결과 보고. 실패하면 저장해 두었다가 나중에 보낸다. 문 열기 결과(성공/실패)에 영향을 주지 않는다. */
export const reportOpenResult = async (report: OpenResultReport): Promise<void> => {
  const outcome = await postResult(report);
  if (outcome === 'retry') {
    const list = await readPending();
    list.push({ ...report, savedAt: Date.now() });
    await writePending(list);
    return;
  }
  flushPendingResults().catch(() => {});
};
