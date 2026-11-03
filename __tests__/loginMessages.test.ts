import { LOGIN_NOTICE, describeLoginError, noRoomMessage } from '../src/services/auth/loginMessages';

describe('noRoomMessage: 방 정보 없음의 이유별 안내', () => {
  it.each([
    ['UPN not mapped in umcs_mast', '학생 정보를 찾을 수 없습니다'],
    ['No room mapped for student id', '배정된 방이 없습니다'],
    ['Room key not found in fo_room_code', '방 정보를 찾을 수 없습니다'],
  ])('%s', (reason, expected) => {
    expect(noRoomMessage(reason)).toContain(expected);
  });

  it.each([[undefined], ['something new'], ['']])('모르는 이유(%p)는 일반 안내', reason => {
    expect(noRoomMessage(reason)).toBe('방 정보가 조회되지 않았습니다.\n관리사무소에 문의해 주세요.');
  });

  it('서버 내부 용어(테이블 이름 등)를 학생에게 보여 주지 않는다', () => {
    for (const reason of ['UPN not mapped in umcs_mast', 'No room mapped for student id', 'Room key not found in fo_room_code', 'x']) {
      expect(noRoomMessage(reason)).not.toMatch(/umcs|fo_room|UPN|student id|key/i);
    }
  });
});

describe('describeLoginError: 로그인 오류를 학생이 이해할 안내로', () => {
  it.each([
    [{ code: 'access_denied', message: 'x' }],
    [{ message: 'User cancelled flow' }],
    [{ error: 'access_denied' }],
  ])('취소 (%p)', error => {
    expect(describeLoginError(error)).toEqual({ kind: 'cancelled', title: '로그인 취소', message: '로그인이 취소되었습니다.' });
  });

  it('브라우저가 없을 때', () => {
    const info = describeLoginError({ code: 'browser_not_found', message: 'No suitable browser' });
    expect(info.kind).toBe('browser');
    expect(info.message).toContain('브라우저');
  });

  it.each([
    [{ code: 'service_configuration_fetch_error', message: 'Failed to fetch configuration' }],
    [{ code: 'token_refresh_failed', message: 'Network error' }],
    [{ message: 'The Internet connection appears to be offline.' }],
    [{ message: 'The request timed out.' }],
    [{ message: 'A server with the specified hostname could not be found.' }],
  ])('네트워크 문제 (%p)', error => {
    const info = describeLoginError(error);
    expect(info.kind).toBe('network');
    expect(info.message).toContain('인터넷 연결을 확인');
  });

  describe('그 밖의 오류는 일반 안내 + 지원용 오류 코드', () => {
    it('Azure 오류 번호가 있으면 번호를 보여 준다 (조건부 액세스 차단 등 학교 IT 확인용)', () => {
      const info = describeLoginError({ code: 'E_MSAL', message: 'AADSTS53003: Access has been blocked by Conditional Access policies' });
      expect(info.kind).toBe('other');
      expect(info.message).toContain('(오류 코드: AADSTS53003)');
    });

    it('오류 코드가 있으면 보여 준다', () => {
      expect(describeLoginError({ code: 'authentication_failed', message: 'x' }).message).toContain('(오류 코드: authentication_failed)');
    });

    it('코드가 없으면 일반 안내만', () => {
      expect(describeLoginError(new Error('boom')).message).toBe('로그인 중 오류가 발생했습니다.\n다시 시도해 주세요.');
      expect(describeLoginError(undefined).message).toBe('로그인 중 오류가 발생했습니다.\n다시 시도해 주세요.');
    });

    it('이상하게 긴 코드나 특수문자가 든 코드는 보여 주지 않는다', () => {
      expect(describeLoginError({ code: 'a'.repeat(80) }).message).not.toContain('오류 코드');
      expect(describeLoginError({ code: '<script>alert(1)</script>' }).message).not.toContain('오류 코드');
    });
  });
});

describe('LOGIN_NOTICE', () => {
  it('로그인 정보를 지웠을 때와 지우지 않았을 때의 안내가 다르다', () => {
    expect(LOGIN_NOTICE.expired).toContain('다시 로그인');
    expect(LOGIN_NOTICE.autoLoginFailed).toContain('다시 시도');
  });
});
