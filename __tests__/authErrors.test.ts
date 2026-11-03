import { isReauthRequiredError } from '../src/services/auth/authErrors';

describe('isReauthRequiredError: 다시 로그인해야 하는 오류인가', () => {
  describe('다시 로그인해야 한다 (true) — 이때만 저장된 로그인 정보를 지운다', () => {
    it.each([
      [
        '안드로이드: 갱신 토큰 만료(invalid_grant)',
        { code: 'invalid_grant', message: 'Invalid Grant: AADSTS70008: The provided authorization code or refresh token has expired' },
      ],
      [
        '안드로이드: 비활동으로 만료',
        { code: 'invalid_grant', message: 'AADSTS700082: The refresh token has expired due to inactivity.' },
      ],
      // iOS 는 오류 코드가 E_MSAL_SILENT 하나라 Azure 오류 번호(AADSTS)로만 알 수 있다
      [
        'iOS: 비활동으로 갱신 토큰 만료(AADSTS700082) — 몇 달 안 쓴 학생',
        { code: 'E_MSAL_SILENT', message: 'AADSTS700082: The refresh token has expired due to inactivity.' },
      ],
      ['iOS: 갱신 토큰 만료(AADSTS70008)', { code: 'E_MSAL_SILENT', message: 'AADSTS70008: The provided refresh token has expired.' }],
      ['iOS: MFA 필요(AADSTS50076)', { code: 'E_MSAL_SILENT', message: 'AADSTS50076: Due to a configuration change, you must use MFA.' }],
      ['안드로이드: 상호작용 필요', { code: 'interaction_required', message: 'Interaction required' }],
      ['안드로이드: 로그인 필요', { code: 'login_required', message: 'x' }],
      ['안드로이드: 동의 필요', { code: 'consent_required', message: 'x' }],
      ['안드로이드: 갱신 토큰이 저장돼 있지 않음', new Error('No refresh token')],
      ['iOS: 저장된 계정 없음', { code: 'E_NOACCOUNT', message: 'No account found for accountId' }],
      ['iOS: 상호작용 필요(문구)', { code: 'E_MSAL_SILENT', message: 'User interaction is required' }],
      ['iOS: 상호작용 필요(MSAL 문구)', { code: 'E_MSAL_SILENT', message: 'interaction_required: AADSTS50076' }],
      [
        'iOS: 비밀번호 변경 등으로 토큰이 취소됨(userInfo 에만 있음)',
        {
          code: 'E_MSAL_SILENT',
          message: 'The operation couldn’t be completed.',
          userInfo: { MSALErrorDescriptionKey: 'AADSTS50173: The provided grant has expired due to it being revoked' },
        },
      ],
      ['세션 만료(AADSTS50133)', { code: 'E_MSAL_SILENT', message: 'AADSTS50133: Session expired' }],
      ['조건부 액세스 차단(AADSTS53003)', { message: 'AADSTS53003: Access has been blocked by Conditional Access policies' }],
      ['계정 비활성화(AADSTS50057)', { message: 'AADSTS50057: The user account is disabled.' }],
    ])('%s', (_name, error) => {
      expect(isReauthRequiredError(error)).toBe(true);
    });
  });

  describe('잠시 뒤 다시 시도하면 된다 (false) — 로그인 정보를 지우면 안 된다', () => {
    it.each([
      ['안드로이드: 네트워크 오류', { code: 'token_refresh_failed', message: 'Network error' }],
      ['안드로이드: 설정 조회 실패', { code: 'service_configuration_fetch_error', message: 'Failed to fetch configuration' }],
      ['안드로이드: 응답 해석 실패', { code: 'token_refresh_failed', message: 'JSON deserialization error' }],
      ['iOS: 인터넷 연결 없음', { code: 'E_MSAL_SILENT', message: 'The Internet connection appears to be offline.' }],
      ['iOS: 서버를 찾을 수 없음', { code: 'E_MSAL_SILENT', message: 'A server with the specified hostname could not be found.' }],
      [
        'iOS: 시간 초과(userInfo 포함)',
        { code: 'E_MSAL_SILENT', message: 'The request timed out.', userInfo: { NSURLErrorKey: 'https://login.microsoftonline.com' } },
      ],
      ['fetch 네트워크 실패', new TypeError('Network request failed')],
      ['시간 초과', new Error('token refresh timeout')],
      ['갱신 중 로그아웃(우리 코드의 오류)', new Error('Signed out during token refresh')],
      ['Azure 일시 장애(AADSTS90033)', { message: 'AADSTS90033: A Microsoft Services Internal Error' }],
      ['설정 오류(AADSTS50011, 재로그인으로 해결되지 않음)', { message: 'AADSTS50011: The redirect URI does not match' }],
      ['번호가 길어서 다른 오류(AADSTS7000822)', { message: 'AADSTS7000822: something else' }],
      ['알 수 없는 오류', new Error('something unexpected')],
      ['코드만 있는 알 수 없는 오류', { code: 'E_INIT' }],
    ])('%s', (_name, error) => {
      expect(isReauthRequiredError(error)).toBe(false);
    });

    it.each([[null], [undefined], ['문자열 오류'], [42], [{}]])('이상한 값(%p)도 지우지 않는다', error => {
      expect(isReauthRequiredError(error)).toBe(false);
    });

    it('직렬화할 수 없는 userInfo 가 있어도 예외 없이 false', () => {
      const circular: any = {};
      circular.self = circular;
      expect(isReauthRequiredError({ code: 'E_MSAL_SILENT', message: 'x', userInfo: circular })).toBe(false);
    });
  });
});
