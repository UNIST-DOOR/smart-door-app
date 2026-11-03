// 이 파일을 모듈로 만든다 (다른 테스트 파일과 전역 이름이 겹치지 않게)
export {};

import React from 'react';
import { AppState } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { LOGIN_NOTICE } from '../src/services/auth/loginMessages';

// ── 가짜들 ───────────────────────────────────────────────────
const mockGetStoredTokens = jest.fn();
const mockRefreshTokens = jest.fn();
const mockClearStoredTokens = jest.fn();
const mockReauth = { value: false };
const mockCheckSession = jest.fn();
const mockShowUpgradeAlert = jest.fn();
const mockSetAuthToken = jest.fn();
let mockLoginProps: any;
let mockDoorProps: any;
let mockScreen: 'login' | 'door' | undefined; // 지금 보이는 화면

jest.mock('../src/services/auth/AuthService', () => ({
  __esModule: true,
  default: {
    getStoredTokens: (...a: unknown[]) => mockGetStoredTokens(...a),
    refreshTokens: (...a: unknown[]) => mockRefreshTokens(...a),
    clearStoredTokens: (...a: unknown[]) => mockClearStoredTokens(...a),
    get reauthRequired() {
      return mockReauth.value;
    },
  },
}));
jest.mock('../src/services/auth/session', () => ({
  ...jest.requireActual('../src/services/auth/session'),
  checkSession: (...a: unknown[]) => mockCheckSession(...a),
}));
jest.mock('../src/lib/api', () => ({
  setAuthToken: (...a: unknown[]) => mockSetAuthToken(...a),
  setBaseUrl: jest.fn(),
  setTokenRefresher: jest.fn(),
  apiGet: jest.fn(),
}));
jest.mock('../src/utils/appVersion', () => ({ checkAndHandleReinstall: async () => false }));
jest.mock('../src/utils/store', () => ({ showUpgradeAlert: (...a: unknown[]) => mockShowUpgradeAlert(...a) }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
}));
jest.mock('../src/screens/SplashScreen', () => ({
  SplashScreen: ({ onFinish }: any) => {
    require('react').useEffect(() => {
      onFinish(); // 스플래시를 바로 끝낸다
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
  },
}));
jest.mock('../src/screens/auth/AzureLoginScreen', () => ({
  AzureLoginScreen: (props: any) => {
    mockLoginProps = props;
    mockScreen = 'login';
    return null;
  },
}));
jest.mock('../src/screens/control/DoorControlScreen', () => ({
  DoorControlScreen: (props: any) => {
    mockDoorProps = props;
    mockScreen = 'door';
    return null;
  },
}));

// ── 도우미 ───────────────────────────────────────────────────
const USER = {
  username: 'student@unist.ac.kr',
  name: '학생',
  building: '301',
  room: '201',
  bleId: '301201',
};
// 테스트 환경은 iOS 로 동작한다: 자동 로그인은 accountId 가 있어야 시작한다
const STORED = { accessToken: 'old', refreshToken: 'msal', accountId: 'acc', expiresOn: Date.now() - 1000 };
const FRESH = { accessToken: 'NEW', expiresOn: Date.now() + 3600 * 1000 };

const networkError = () => Object.assign(new Error('The Internet connection appears to be offline.'), { code: 'E_MSAL_SILENT' });
const refreshTokenRejected = () => Object.assign(new Error('AADSTS700082: expired due to inactivity'), { code: 'invalid_grant' });

let appStateHandler: (state: string) => void;
let renderer: ReactTestRenderer.ReactTestRenderer;

const flush = async () => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};

const startApp = async () => {
  await act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  await flush();
};

/** 앱을 백그라운드로 보냈다가 돌아온다 (3초 이상 지난 것처럼) */
const backgroundThenForeground = async () => {
  await act(async () => {
    jest.advanceTimersByTime(4000);
    appStateHandler('background');
    appStateHandler('active');
  });
  await flush();
};

describe('App 로그인 세션: 로그인 정보를 지우는 조건', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    mockGetStoredTokens.mockReset().mockResolvedValue(STORED);
    mockRefreshTokens.mockReset().mockResolvedValue(FRESH);
    mockClearStoredTokens.mockReset().mockResolvedValue(undefined);
    mockCheckSession.mockReset().mockResolvedValue({ kind: 'ok', user: USER });
    mockShowUpgradeAlert.mockReset();
    mockSetAuthToken.mockReset();
    mockReauth.value = false;
    mockLoginProps = undefined;
    mockDoorProps = undefined;
    mockScreen = undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: any) => {
      appStateHandler = handler;
      return { remove: jest.fn() };
    }) as any);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('앱을 켤 때 자동 로그인', () => {
    it('정상: 로그인되어 문 열기 화면으로 간다', async () => {
      await startApp();

      expect(mockDoorProps?.userInfo).toEqual(USER);
      expect(mockSetAuthToken).toHaveBeenCalledWith('NEW', FRESH.expiresOn);
      expect(mockClearStoredTokens).not.toHaveBeenCalled();
    });

    it('저장된 로그인 정보가 없으면 아무것도 하지 않는다', async () => {
      mockGetStoredTokens.mockResolvedValue(null);
      await startApp();

      expect(mockRefreshTokens).not.toHaveBeenCalled();
      expect(mockClearStoredTokens).not.toHaveBeenCalled();
      expect(mockScreen).toBe('login');
    });

    it('네트워크가 불안정해서 갱신에 실패해도 로그인 정보를 지우지 않는다 (이전에는 여기서 지워졌다)', async () => {
      mockRefreshTokens.mockRejectedValue(networkError());
      await startApp();

      expect(mockClearStoredTokens).not.toHaveBeenCalled();
      expect(mockCheckSession).not.toHaveBeenCalled();
      expect(mockScreen).toBe('login'); // 로그인 화면에 머문다
    });

    it('Azure 가 갱신 토큰을 거부하면 로그인 정보를 지운다', async () => {
      mockRefreshTokens.mockRejectedValue(refreshTokenRejected());
      await startApp();

      expect(mockClearStoredTokens).toHaveBeenCalledTimes(1);
      expect(mockScreen).toBe('login');
    });

    it('갱신은 됐는데 토큰이 비어 있으면 지운다', async () => {
      mockRefreshTokens.mockResolvedValue({ accessToken: undefined });
      await startApp();

      expect(mockClearStoredTokens).toHaveBeenCalledTimes(1);
    });

    it('저장소를 읽다가 예기치 않은 오류가 나도 지우지 않는다', async () => {
      mockGetStoredTokens.mockRejectedValue(new Error('keystore error'));
      await startApp();

      expect(mockClearStoredTokens).not.toHaveBeenCalled();
    });

    it.each([['unavailable'], ['token_rejected']])('서버 확인 결과가 %s 이면 지우지 않는다', async kind => {
      mockCheckSession.mockResolvedValue({ kind });
      await startApp();

      expect(mockClearStoredTokens).not.toHaveBeenCalled();
      expect(mockScreen).toBe('login');
    });

    it('서버가 방 정보가 없다고 명확히 답하면 지운다', async () => {
      mockCheckSession.mockResolvedValue({ kind: 'no_room', reason: 'No room mapped for student id' });
      await startApp();

      expect(mockClearStoredTokens).toHaveBeenCalledTimes(1);
      expect(mockScreen).toBe('login');
    });

    it('앱 업데이트가 필요하면 안내하고 로그인 정보는 지우지 않는다 (업데이트 후 바로 자동 로그인된다)', async () => {
      mockCheckSession.mockResolvedValue({ kind: 'upgrade_required' });
      await startApp();

      expect(mockShowUpgradeAlert).toHaveBeenCalledTimes(1);
      expect(mockClearStoredTokens).not.toHaveBeenCalled();
      expect(mockScreen).toBe('login');
    });
  });

  describe('앱으로 돌아왔을 때 세션 확인', () => {
    beforeEach(async () => {
      await startApp(); // 로그인된 상태에서 시작
      expect(mockDoorProps?.userInfo).toEqual(USER);
      mockClearStoredTokens.mockClear();
      mockCheckSession.mockClear();
    });

    it('정상이면 그대로 유지하고 정보를 새로 받는다', async () => {
      mockCheckSession.mockResolvedValue({ kind: 'ok', user: { ...USER, room: '202' } });
      await backgroundThenForeground();

      expect(mockDoorProps.userInfo.room).toBe('202');
      expect(mockScreen).toBe('door');
      expect(mockClearStoredTokens).not.toHaveBeenCalled();
    });

    it('저장된 토큰을 만료 시각과 함께 api 계층에 전달한다 (만료되었으면 요청 전에 갱신되게)', async () => {
      mockGetStoredTokens.mockResolvedValue({ ...STORED, accessToken: 'stored', expiresOn: 12345 });
      await backgroundThenForeground();

      expect(mockSetAuthToken).toHaveBeenCalledWith('stored', 12345);
    });

    it('토큰이 거절됐어도 Azure 가 갱신 토큰을 거부한 게 아니면 로그인을 유지한다 (이전에는 여기서 로그아웃됐다)', async () => {
      mockCheckSession.mockResolvedValue({ kind: 'token_rejected' });
      mockReauth.value = false;
      await backgroundThenForeground();

      expect(mockClearStoredTokens).not.toHaveBeenCalled();
      expect(mockScreen).toBe('door'); // 로그인 화면으로 쫓겨나지 않는다
    });

    it('Azure 가 갱신 토큰을 거부했다면 로그아웃한다', async () => {
      mockCheckSession.mockResolvedValue({ kind: 'token_rejected' });
      mockReauth.value = true;
      await backgroundThenForeground();

      expect(mockClearStoredTokens).toHaveBeenCalledTimes(1);
      expect(mockScreen).toBe('login');
    });

    it('서버가 방 정보가 없다고 명확히 답하면 로그아웃한다', async () => {
      mockCheckSession.mockResolvedValue({ kind: 'no_room' });
      await backgroundThenForeground();

      expect(mockClearStoredTokens).toHaveBeenCalledTimes(1);
      expect(mockScreen).toBe('login');
    });

    it.each([['unavailable'], ['upgrade_required']])('서버 확인 결과가 %s 이면 로그인을 유지한다', async kind => {
      mockCheckSession.mockResolvedValue({ kind });
      await backgroundThenForeground();

      expect(mockClearStoredTokens).not.toHaveBeenCalled();
      expect(mockScreen).toBe('door');
    });

    it('확인 중 예외가 나도 로그인을 유지한다', async () => {
      mockCheckSession.mockRejectedValue(new Error('boom'));
      await backgroundThenForeground();

      expect(mockClearStoredTokens).not.toHaveBeenCalled();
      expect(mockScreen).toBe('door');
    });

    it('저장된 토큰이 없어졌으면 로그아웃 상태로 만든다 (지울 것은 없다)', async () => {
      mockGetStoredTokens.mockResolvedValue(null);
      await backgroundThenForeground();

      expect(mockClearStoredTokens).not.toHaveBeenCalled();
      expect(mockCheckSession).not.toHaveBeenCalled();
      expect(mockScreen).toBe('login');
    });
  });

  describe('일시적인 오류로 자동 로그인에 실패했을 때 다시 시도', () => {
    it('앱으로 돌아오면 다시 시도해서 로그인된다', async () => {
      mockRefreshTokens.mockRejectedValueOnce(networkError());
      await startApp();
      expect(mockScreen).toBe('login');

      mockRefreshTokens.mockResolvedValue(FRESH); // 네트워크가 돌아왔다
      await backgroundThenForeground();

      expect(mockRefreshTokens).toHaveBeenCalledTimes(2);
      expect(mockScreen).toBe('door');
      expect(mockDoorProps?.userInfo).toEqual(USER);
      expect(mockClearStoredTokens).not.toHaveBeenCalled();
    });

    it('서버 오류로 실패한 뒤에도 돌아오면 다시 시도한다', async () => {
      mockCheckSession.mockResolvedValueOnce({ kind: 'unavailable' });
      await startApp();
      expect(mockScreen).toBe('login');

      await backgroundThenForeground();

      expect(mockScreen).toBe('door');
      expect(mockDoorProps?.userInfo).toEqual(USER);
    });

    it('이미 로그인 정보를 지운 경우(갱신 토큰 거부)에는 다시 시도하지 않는다', async () => {
      mockRefreshTokens.mockRejectedValue(refreshTokenRejected());
      await startApp();
      mockGetStoredTokens.mockResolvedValue(null); // 지웠으니 저장된 것이 없다

      await backgroundThenForeground();

      expect(mockRefreshTokens).toHaveBeenCalledTimes(1);
    });

    it('앱 업데이트 안내를 띄운 뒤에는 돌아올 때마다 안내를 반복하지 않는다', async () => {
      mockCheckSession.mockResolvedValue({ kind: 'upgrade_required' });
      await startApp();
      await backgroundThenForeground();

      expect(mockShowUpgradeAlert).toHaveBeenCalledTimes(1);
      expect(mockRefreshTokens).toHaveBeenCalledTimes(1);
    });

    it('사용자가 로그인 화면에서 직접 로그인하는 중이면 다시 시도하지 않는다', async () => {
      mockRefreshTokens.mockRejectedValueOnce(networkError());
      await startApp();

      await act(async () => {
        mockLoginProps.onBusyChange(true); // 직접 로그인 시작 (브라우저가 열리며 앱이 백그라운드로 간다)
      });
      await backgroundThenForeground();
      expect(mockRefreshTokens).toHaveBeenCalledTimes(1);

      await act(async () => {
        mockLoginProps.onBusyChange(false); // 직접 로그인이 끝났다
      });
      await backgroundThenForeground();
      expect(mockRefreshTokens).toHaveBeenCalledTimes(2);
    });

    it('로그아웃한 뒤에는 돌아와도 자동 로그인하지 않는다', async () => {
      await startApp();
      expect(mockDoorProps?.userInfo).toEqual(USER);

      mockGetStoredTokens.mockResolvedValue(null); // 로그아웃하면 저장된 정보가 없다
      await act(async () => {
        await mockDoorProps.onLogout();
      });
      mockRefreshTokens.mockClear();

      await backgroundThenForeground();

      expect(mockRefreshTokens).not.toHaveBeenCalled();
      expect(mockScreen).toBe('login');
    });

    it('다시 시도가 진행 중일 때 앱이 또 돌아와도 겹쳐서 시도하지 않는다', async () => {
      mockRefreshTokens.mockRejectedValueOnce(networkError());
      await startApp();

      let finishRefresh!: (value: unknown) => void;
      mockRefreshTokens.mockReturnValue(new Promise(resolve => {
        finishRefresh = resolve;
      })); // 느린 갱신
      await act(async () => {
        jest.advanceTimersByTime(4000);
        appStateHandler('background');
        appStateHandler('active'); // 다시 시도 시작
        appStateHandler('background');
        appStateHandler('active'); // 진행 중에 또 돌아옴
      });
      await flush();

      expect(mockRefreshTokens).toHaveBeenCalledTimes(2); // 처음 한 번 + 다시 시도 한 번뿐
      await act(async () => {
        finishRefresh(FRESH);
      });
      await flush();
      expect(mockScreen).toBe('door');
    });
  });

  describe('로그인 화면이 나온 이유 안내 (갑자기 로그인 화면이 나와도 이유를 알 수 있게)', () => {
    it('앱을 켰을 때 갱신 토큰이 거부되면 "로그인 정보 만료" 안내를 보여 준다', async () => {
      mockRefreshTokens.mockRejectedValue(refreshTokenRejected());
      await startApp();

      expect(mockLoginProps.notice).toEqual({ message: LOGIN_NOTICE.expired });
    });

    it('일시적인 오류로 자동 로그인을 못 했으면 "다시 시도" 안내를 보여 주고, 누르면 다시 시도한다', async () => {
      mockRefreshTokens.mockRejectedValueOnce(networkError());
      await startApp();
      expect(mockLoginProps.notice).toEqual({ message: LOGIN_NOTICE.autoLoginFailed, retry: true });

      mockRefreshTokens.mockResolvedValue(FRESH);
      await act(async () => {
        mockLoginProps.onRetry();
      });
      await flush();

      expect(mockRefreshTokens).toHaveBeenCalledTimes(2);
      expect(mockScreen).toBe('door');
    });

    it.each([['unavailable'], ['token_rejected']])('서버 확인 결과가 %s 이면 "다시 시도" 안내를 보여 준다', async kind => {
      mockCheckSession.mockResolvedValue({ kind });
      await startApp();

      expect(mockLoginProps.notice).toEqual({ message: LOGIN_NOTICE.autoLoginFailed, retry: true });
    });

    it.each([
      ['UPN not mapped in umcs_mast', '학생 정보를 찾을 수 없습니다'],
      ['No room mapped for student id', '배정된 방이 없습니다'],
    ])('서버가 방 정보 없음(%s)이라고 답하면 이유에 맞는 안내를 보여 준다', async (reason, expected) => {
      mockCheckSession.mockResolvedValue({ kind: 'no_room', reason });
      await startApp();

      expect(mockLoginProps.notice.message).toContain(expected);
      expect(mockLoginProps.notice.retry).toBeUndefined(); // 다시 시도해도 소용없다
    });

    it('로그인 정보가 없는 처음 사용자에게는 안내를 보여 주지 않는다', async () => {
      mockGetStoredTokens.mockResolvedValue(null);
      await startApp();

      expect(mockLoginProps.notice).toBeNull();
    });

    it('앱 업데이트 안내만 띄우고 로그인 화면 안내는 만들지 않는다', async () => {
      mockCheckSession.mockResolvedValue({ kind: 'upgrade_required' });
      await startApp();

      expect(mockShowUpgradeAlert).toHaveBeenCalledTimes(1);
      expect(mockLoginProps.notice).toBeNull();
    });

    it('다시 시도해서 로그인되면 안내가 사라진다', async () => {
      mockRefreshTokens.mockRejectedValueOnce(networkError());
      await startApp();
      expect(mockLoginProps.notice).not.toBeNull();

      mockRefreshTokens.mockResolvedValue(FRESH);
      await backgroundThenForeground();

      expect(mockScreen).toBe('door');
      await act(async () => {
        await mockDoorProps.onLogout(); // 직접 로그아웃
      });
      expect(mockLoginProps.notice).toBeNull(); // 이전 안내가 남아 있지 않다
    });

    it('다시 시도할 로그인 정보가 이미 없으면 안내를 지운다', async () => {
      mockRefreshTokens.mockRejectedValueOnce(networkError());
      await startApp();
      expect(mockLoginProps.notice.retry).toBe(true);

      mockGetStoredTokens.mockResolvedValue(null); // 그 사이 로그인 정보가 사라졌다
      await act(async () => {
        mockLoginProps.onRetry();
      });
      await flush();

      expect(mockLoginProps.notice).toBeNull();
    });

    it('직접 로그인을 시작하면 이전 안내를 지운다', async () => {
      mockRefreshTokens.mockRejectedValueOnce(networkError());
      await startApp();
      expect(mockLoginProps.notice).not.toBeNull();

      await act(async () => {
        mockLoginProps.onBusyChange(true);
      });

      expect(mockLoginProps.notice).toBeNull();
    });

    describe('로그인된 상태에서 앱으로 돌아왔는데 로그아웃된 경우', () => {
      beforeEach(async () => {
        await startApp();
        expect(mockScreen).toBe('door');
      });

      it('Azure 가 갱신 토큰을 거부했다면 "로그인 정보 만료" 안내와 함께 로그아웃한다', async () => {
        mockCheckSession.mockResolvedValue({ kind: 'token_rejected' });
        mockReauth.value = true;
        await backgroundThenForeground();

        expect(mockScreen).toBe('login');
        expect(mockLoginProps.notice).toEqual({ message: LOGIN_NOTICE.expired });
      });

      it('방 정보가 없어졌다면 그 이유와 함께 로그아웃한다', async () => {
        mockCheckSession.mockResolvedValue({ kind: 'no_room', reason: 'No room mapped for student id' });
        await backgroundThenForeground();

        expect(mockScreen).toBe('login');
        expect(mockLoginProps.notice.message).toContain('배정된 방이 없습니다');
      });

      it('학생이 직접 로그아웃하면 안내는 필요 없다', async () => {
        await act(async () => {
          await mockDoorProps.onLogout();
        });

        expect(mockScreen).toBe('login');
        expect(mockLoginProps.notice).toBeNull();
      });
    });
  });
});
