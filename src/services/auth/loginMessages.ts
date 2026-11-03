/**
 * 로그인과 관련해서 학생에게 보여 주는 안내 문구.
 * 원인별로 학생이 "무엇을 하면 되는지"를 알 수 있게 하고, 서버나 앱의 내부 용어는 보여 주지 않는다.
 */

/** 서버가 "방 정보 없음"(found: false)이라고 답한 이유별 안내 */
export const noRoomMessage = (reason?: string): string => {
  switch (reason) {
    case 'UPN not mapped in umcs_mast':
      // 이 학교 계정에 해당하는 재학 중인 학생 정보가 없다
      return '학생 정보를 찾을 수 없습니다.\n재학 중인 학생 계정인지 확인해 주세요.\n계속되면 관리사무소에 문의해 주세요.';
    case 'No room mapped for student id':
      return '배정된 방이 없습니다.\n관리사무소에 문의해 주세요.';
    case 'Room key not found in fo_room_code':
      return '방 정보를 찾을 수 없습니다.\n관리사무소에 문의해 주세요.';
    default:
      return '방 정보가 조회되지 않았습니다.\n관리사무소에 문의해 주세요.';
  }
};

/** 로그인 화면 위쪽에 보여 주는 안내 (왜 로그인 화면이 나왔는지) */
export const LOGIN_NOTICE = {
  // Azure 가 저장된 로그인 정보를 거부했다 (오래 안 쓴 경우, 비밀번호 변경 등)
  expired: '로그인 정보가 만료되어\n다시 로그인해야 합니다.',
  // 네트워크나 서버 문제로 자동 로그인을 하지 못했다. 로그인 정보는 지워지지 않았다.
  autoLoginFailed: '자동 로그인을 하지 못했습니다.\n인터넷 연결을 확인하고 다시 시도해 주세요.',
};

export type LoginErrorInfo = {
  kind: 'cancelled' | 'network' | 'browser' | 'other';
  title: string;
  message: string;
};

const NETWORK_CODES = new Set(['service_configuration_fetch_error']);
const NETWORK_TEXT = /network|offline|internet|timed? ?out|connection|hostname|unreachable|not connected|ECONN|ENOTFOUND/i;

/** 지원할 때 알아볼 수 있는 오류 코드. 학생에게 읽어 달라고 하거나 캡처를 받을 때 쓴다. */
const supportCode = (error: any): string | undefined => {
  const text = `${error?.message ?? ''} ${typeof error?.code === 'string' ? error.code : ''}`;
  const aadsts = text.match(/AADSTS\d+/i);
  if (aadsts) {
    return aadsts[0].toUpperCase();
  }
  const code = typeof error?.code === 'string' ? error.code : '';
  return /^[A-Za-z0-9_.-]{1,40}$/.test(code) ? code : undefined;
};

/** 로그인 과정에서 난 오류를 학생에게 보여 줄 안내로 바꾼다. */
export const describeLoginError = (error: any): LoginErrorInfo => {
  const code = typeof error?.code === 'string' ? error.code : '';
  // 오류 문구뿐 아니라 코드도 함께 본다 (취소가 code: 'access_denied' 로만 오는 경우가 있다)
  const raw = `${error?.error ?? ''} ${code} ${error?.message ?? ''}`;

  if (/access_denied|cancel/i.test(raw)) {
    return { kind: 'cancelled', title: '로그인 취소', message: '로그인이 취소되었습니다.' };
  }
  if (code === 'browser_not_found') {
    return {
      kind: 'browser',
      title: '로그인 실패',
      message: '로그인 화면을 열 수 없습니다.\n휴대폰의 기본 브라우저(Chrome 등)를 사용할 수 있는지 확인해 주세요.',
    };
  }
  if (NETWORK_CODES.has(code) || NETWORK_TEXT.test(raw)) {
    return {
      kind: 'network',
      title: '로그인 실패',
      message: '로그인 서버에 연결하지 못했습니다.\n인터넷 연결을 확인하고 다시 시도해 주세요.',
    };
  }
  const detail = supportCode(error);
  return {
    kind: 'other',
    title: '로그인 실패',
    message: `로그인 중 오류가 발생했습니다.\n다시 시도해 주세요.${detail ? `\n(오류 코드: ${detail})` : ''}`,
  };
};
