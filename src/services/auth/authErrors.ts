/**
 * 토큰 갱신이 실패했을 때, 그 이유가 "다시 로그인해야 하는 상황"인지 "잠시 뒤 다시 시도하면 되는 상황"인지 가른다.
 *
 * 다시 로그인해야 하는 상황(true): Azure 가 갱신 토큰을 명확히 거부했다. (만료, 비활동, 취소, MFA·동의 필요 등)
 *   이때만 저장된 로그인 정보를 지운다.
 * 그 밖의 모든 오류(false): 네트워크 불안정, 서버 일시 오류, 알 수 없는 오류.
 *   토큰은 그대로 두고 나중에 다시 시도한다. 판단이 애매하면 지우지 않는다. 지웠다가 되돌릴 수는 없기 때문이다.
 *
 * 오류 모양:
 *  - 안드로이드(react-native-app-auth): 서버가 OAuth 오류를 주면 error.code 가 오류명(예: 'invalid_grant'),
 *    네트워크 오류는 code 'token_refresh_failed' + message 'Network error'.
 *  - iOS(MSAL 네이티브 모듈): code 'E_MSAL_SILENT' 하나로 오고 구분 정보는 message/userInfo 에 있다.
 */

// 오류 코드로 알 수 있는 경우
const REAUTH_CODES = new Set([
  'invalid_grant',
  'interaction_required',
  'login_required',
  'consent_required',
  'E_NOACCOUNT', // iOS: 저장된 계정을 찾을 수 없음
]);

// Azure AD 오류 번호(AADSTS) 중 다시 로그인해야 하는 것
const REAUTH_AADSTS = new Set([
  '50034', // 사용자를 찾을 수 없음
  '50053', // 계정 잠김
  '50055', // 비밀번호 만료
  '50057', // 계정 비활성화
  '50058', // 로그인된 사용자 없음
  '50076', // MFA 필요
  '50078', // MFA 만료
  '50079', // MFA 등록 필요
  '50132', // 세션 취소됨
  '50133', // 세션 만료됨
  '50173', // 새로 인증해야 함 (비밀번호 변경 등으로 토큰 취소)
  '53003', // 조건부 액세스 정책으로 차단
  '65001', // 동의 필요
  '70000', // 토큰이 유효하지 않음
  '70008', // 갱신 토큰 만료
  '700082', // 비활동으로 갱신 토큰 만료
]);

// "interaction_required", "User interaction is required", "login required" 같은 여러 표기를 모두 받는다
const REAUTH_TEXT =
  /invalid[_ ]grant|(interaction|login|consent)[_ -]?(is[_ -])?required|no refresh token|no account found/i;

const textOf = (error: any): string => {
  const parts: string[] = [];
  if (typeof error?.message === 'string') {
    parts.push(error.message);
  }
  if (error?.userInfo && typeof error.userInfo === 'object') {
    try {
      parts.push(JSON.stringify(error.userInfo));
    } catch {
      // 직렬화할 수 없으면 무시
    }
  }
  return parts.join(' ');
};

export const isReauthRequiredError = (error: any): boolean => {
  if (!error) {
    return false;
  }
  const code = typeof error.code === 'string' ? error.code : typeof error.error === 'string' ? error.error : '';
  if (REAUTH_CODES.has(code)) {
    return true;
  }
  const text = textOf(error);
  if (REAUTH_TEXT.test(text)) {
    return true;
  }
  const aadsts: string[] = text.match(/AADSTS\d+/gi) ?? [];
  return aadsts.some(found => REAUTH_AADSTS.has(found.slice('AADSTS'.length)));
};
