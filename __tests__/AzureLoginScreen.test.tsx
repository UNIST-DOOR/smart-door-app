// 이 파일을 모듈로 만든다 (다른 테스트 파일과 전역 이름이 겹치지 않게)
export {};

import React from 'react';
import { Alert, Text, TouchableOpacity } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AzureLoginScreen } from '../src/screens/auth/AzureLoginScreen';

const mockSignIn = jest.fn();
const mockClear = jest.fn();
const mockCheckSession = jest.fn();
const mockSetAuthToken = jest.fn();

jest.mock('../src/services/auth/AuthService', () => ({
  __esModule: true,
  default: {
    signInInteractive: (...a: unknown[]) => mockSignIn(...a),
    clearStoredTokens: (...a: unknown[]) => mockClear(...a),
  },
}));
jest.mock('../src/services/auth/session', () => ({ checkSession: (...a: unknown[]) => mockCheckSession(...a) }));
jest.mock('../src/lib/api', () => ({ setAuthToken: (...a: unknown[]) => mockSetAuthToken(...a) }));

const USER = { username: 'u@unist.ac.kr', name: '학생', building: '301', room: '201' };

let renderer: ReactTestRenderer.ReactTestRenderer;
let alertSpy: jest.SpyInstance;
let onSuccess: jest.Mock;
let onBusyChange: jest.Mock;

const render = async () => {
  onSuccess = jest.fn();
  onBusyChange = jest.fn();
  await act(async () => {
    renderer = ReactTestRenderer.create(<AzureLoginScreen onSuccess={onSuccess} onBusyChange={onBusyChange} />);
  });
};

const pressLogin = async () => {
  const button = renderer.root
    .findAllByType(TouchableOpacity)
    .find(b => b.findAllByType(Text).some(t => String(t.props.children).includes('로그인')))!;
  await act(async () => {
    await button.props.onPress();
  });
};

describe('AzureLoginScreen: 직접 로그인', () => {
  beforeEach(() => {
    mockSignIn.mockReset().mockResolvedValue({ accessToken: 'A', expiresOn: 123 });
    mockClear.mockReset().mockResolvedValue(undefined);
    mockCheckSession.mockReset().mockResolvedValue({ kind: 'ok', user: USER });
    mockSetAuthToken.mockReset();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    jest.restoreAllMocks();
  });

  it('정상: 토큰(만료 시각 포함)을 설정하고 로그인에 성공한다', async () => {
    await render();
    await pressLogin();

    expect(mockSetAuthToken).toHaveBeenCalledWith('A', 123);
    expect(onSuccess).toHaveBeenCalledWith(USER);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  });

  it('로그인하는 동안 앱에 알리고, 끝나면 해제한다 (앱이 그 사이 자동 로그인을 다시 시도하지 않게)', async () => {
    await render();
    await pressLogin();

    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  });

  it('로그인이 취소돼도 해제한다', async () => {
    mockSignIn.mockRejectedValue(Object.assign(new Error('User cancelled flow'), { code: 'access_denied' }));
    await render();
    await pressLogin();

    expect(alertSpy).toHaveBeenCalledWith('로그인 취소', '로그인이 취소되었습니다.');
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  });

  it('로그인 자체가 실패하면 일반 안내를 띄운다', async () => {
    mockSignIn.mockRejectedValue(new Error('something'));
    await render();
    await pressLogin();

    expect(alertSpy).toHaveBeenCalledWith('로그인 실패', '로그인 중 오류가 발생했습니다.\n다시 시도해 주세요.');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ['UPN not mapped in umcs_mast', '학생 정보를 찾을 수 없습니다'],
    ['No room mapped for student id', '배정된 방이 없습니다'],
    ['Room key not found in fo_room_code', '방 정보를 찾을 수 없습니다'],
    [undefined, '방 정보가 조회되지 않았습니다'],
  ])('서버가 방 정보가 없다고 명확히 답하면(%s) 이유에 맞게 안내하고 토큰을 지운다', async (reason, expected) => {
    mockCheckSession.mockResolvedValue({ kind: 'no_room', reason });
    await render();
    await pressLogin();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('로그인할 수 없음');
    expect(alertSpy.mock.calls[0][1]).toContain(expected);
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ['네트워크 문제', Object.assign(new Error('Network error'), { code: 'token_refresh_failed' }), '로그인 서버에 연결하지 못했습니다'],
    ['브라우저 없음', Object.assign(new Error('x'), { code: 'browser_not_found' }), '기본 브라우저'],
    ['조건부 액세스 차단', Object.assign(new Error('AADSTS53003: blocked by policy'), { code: 'E_MSAL' }), '(오류 코드: AADSTS53003)'],
  ])('로그인 오류를 이유별로 안내한다: %s', async (_name, error, expected) => {
    mockSignIn.mockRejectedValue(error);
    await render();
    await pressLogin();

    expect(alertSpy.mock.calls[0][0]).toBe('로그인 실패');
    expect(alertSpy.mock.calls[0][1]).toContain(expected);
    expect(mockClear).not.toHaveBeenCalled(); // 로그인 자체가 실패한 것이라 저장된 정보는 건드리지 않는다
  });

  it('서버나 네트워크 문제는 "권한 없음"이 아니라 서버 연결 실패로 안내하고 토큰을 지우지 않는다 (이전에는 지웠다)', async () => {
    mockCheckSession.mockResolvedValue({ kind: 'unavailable' });
    await render();
    await pressLogin();

    expect(alertSpy).toHaveBeenCalledWith('서버 연결 실패', '서버에서 방 정보를 가져오지 못했습니다.\n잠시 후 다시 시도해 주세요.');
    expect(alertSpy).not.toHaveBeenCalledWith('권한 없음', expect.anything());
    expect(mockClear).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('방금 로그인했는데 서버가 토큰을 거절하면 안내하고 토큰을 지운다', async () => {
    mockCheckSession.mockResolvedValue({ kind: 'token_rejected' });
    await render();
    await pressLogin();

    expect(alertSpy).toHaveBeenCalledWith('로그인 실패', '로그인 정보를 확인하지 못했습니다.\n다시 시도해 주세요.');
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('앱 업데이트가 필요하면 업데이트 안내를 띄우고 토큰을 지운다 (기존 동작)', async () => {
    mockCheckSession.mockResolvedValue({ kind: 'upgrade_required' });
    await render();
    await pressLogin();

    expect(alertSpy.mock.calls[0][0]).toBe('업데이트 필요');
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('자동 로그인 중에는 로그인 버튼이 동작하지 않는다', async () => {
    onSuccess = jest.fn();
    onBusyChange = jest.fn();
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <AzureLoginScreen onSuccess={onSuccess} onBusyChange={onBusyChange} isAutoLoginInProgress />
      );
    });
    await pressLogin();

    expect(mockSignIn).not.toHaveBeenCalled();
    expect(onBusyChange).not.toHaveBeenCalled();
  });

  describe('로그인 화면이 나온 이유 안내', () => {
    const allTexts = () => renderer.root.findAllByType(Text).map(t => String(t.props.children));
    const renderWithNotice = async (props: any) => {
      onSuccess = jest.fn();
      onBusyChange = jest.fn();
      await act(async () => {
        renderer = ReactTestRenderer.create(<AzureLoginScreen onSuccess={onSuccess} onBusyChange={onBusyChange} {...props} />);
      });
    };
    const retryButton = () =>
      renderer.root.findAllByType(TouchableOpacity).find(b => b.findAllByType(Text).some(t => /다시 시도|시도 중/.test(String(t.props.children))));

    it('안내가 없으면 아무것도 보여 주지 않는다', async () => {
      await render();
      expect(allTexts().join('|')).not.toContain('다시 시도');
    });

    it('안내를 보여 준다', async () => {
      await renderWithNotice({ notice: { message: '로그인 정보가 만료되었습니다.' } });
      expect(allTexts()).toContain('로그인 정보가 만료되었습니다.');
      expect(retryButton()).toBeUndefined(); // 다시 시도 버튼은 retry 일 때만
    });

    it('retry 안내에는 "다시 시도" 버튼이 있고, 누르면 다시 시도를 요청한다', async () => {
      const onRetry = jest.fn();
      await renderWithNotice({ notice: { message: '자동 로그인을 하지 못했습니다.', retry: true }, onRetry });

      await act(async () => {
        retryButton()!.props.onPress();
      });
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('자동 로그인을 다시 시도하는 중에는 버튼이 "시도 중..."이고 눌러도 동작하지 않는다', async () => {
      const onRetry = jest.fn();
      await renderWithNotice({ notice: { message: 'x', retry: true }, onRetry, isAutoLoginInProgress: true });

      expect(allTexts()).toContain('시도 중...');
      expect(retryButton()!.props.disabled).toBe(true);
    });

    it('onRetry 가 없으면 retry 안내여도 버튼을 만들지 않는다', async () => {
      await renderWithNotice({ notice: { message: 'x', retry: true } });
      expect(retryButton()).toBeUndefined();
    });
  });
});
