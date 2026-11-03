import { apiGet, isTokenFailure } from '../../lib/api';

/**
 * 로그인 세션 확인: 서버에 내 정보(/api/me/)와 방 정보(/api/room-info/)를 물어서 결과를 분류한다.
 * 자동 로그인, 앱 복귀 시 검증, 로그인 화면이 모두 같은 기준으로 판단하게 하려고 한곳에 모았다.
 *
 * 저장된 로그인 정보를 지워도 되는 것은 'no_room' 뿐이다. 나머지는 모두 로그인 정보를 그대로 둔다.
 */

export interface UserInfo {
  username: string;
  name: string;
  room: string;
  building: string;
  bleId?: string;
  checkInDate?: string;
  checkInTime?: string;
  checkOutDate?: string;
  checkOutTime?: string;
}

export type SessionCheck =
  | { kind: 'ok'; user: UserInfo }
  // 서버가 방 정보가 없다고 명확히 답했다 (퇴사, 배정 변경 등). 지금 이 계정으로는 쓸 수 없다.
  | { kind: 'no_room'; reason?: string }
  // 앱이 최소 버전보다 낮다 (426)
  | { kind: 'upgrade_required' }
  // 토큰이 거절됐다 (갱신해서 다시 보낸 뒤에도)
  | { kind: 'token_rejected' }
  // 서버나 네트워크 문제로 확인하지 못했다. 일시적일 수 있다. (연결 실패, 500, 503, 429 등)
  | { kind: 'unavailable' };

/** 서버가 준 me/room-info 응답으로 화면에 쓸 사용자 정보를 만든다. */
export const toUserInfo = (me: any, roomInfo: any): UserInfo => ({
  username: String(roomInfo?.upn || ''),
  name: String(me?.name || ''),
  building: String(roomInfo?.building || ''),
  room: String(roomInfo?.room || ''),
  bleId: roomInfo?.bleId ? String(roomInfo.bleId) : undefined,
  checkInDate: roomInfo?.checkInDate ? String(roomInfo.checkInDate) : undefined,
  checkInTime: roomInfo?.checkInTime ? String(roomInfo.checkInTime) : undefined,
  checkOutDate: roomInfo?.checkOutDate ? String(roomInfo.checkOutDate) : undefined,
  checkOutTime: roomInfo?.checkOutTime ? String(roomInfo.checkOutTime) : undefined,
});

const unwrap = (res: any) => (res && typeof res === 'object' && 'data' in res ? res.data : res);

const isUpgradeRequired = (res: any): boolean => res?.status === 426 || unwrap(res)?.error === 'upgrade_required';

export const checkSession = async (): Promise<SessionCheck> => {
  let meRes: any;
  let roomRes: any;
  try {
    [meRes, roomRes] = await Promise.all([apiGet('/api/me/'), apiGet('/api/room-info/')]);
  } catch {
    return { kind: 'unavailable' }; // 연결 실패, 시간 초과 등
  }
  if (!meRes || !roomRes) {
    return { kind: 'unavailable' };
  }

  if (isUpgradeRequired(meRes) || isUpgradeRequired(roomRes)) {
    return { kind: 'upgrade_required' };
  }
  if (isTokenFailure(meRes) || isTokenFailure(roomRes)) {
    return { kind: 'token_rejected' };
  }

  const roomInfo = unwrap(roomRes);
  if (roomInfo?.ok && roomInfo?.found) {
    return { kind: 'ok', user: toUserInfo(unwrap(meRes), roomInfo) };
  }
  // 서버가 조회는 정상적으로 했고 "없다"(found: false)고 답한 경우만 방 정보 없음으로 본다.
  // 서버 오류(500, 503 등)는 found 값이 없으므로 여기에 해당하지 않는다.
  if (roomRes.status === 200 && roomInfo?.found === false) {
    return { kind: 'no_room', reason: typeof roomInfo?.reason === 'string' ? roomInfo.reason : undefined };
  }
  return { kind: 'unavailable' };
};
