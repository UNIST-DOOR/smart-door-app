/**
 * Smart Door Manager App
 * 대학교 기숙사 BLE 도어락 제어 앱
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View, Platform, AppState, AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SplashScreen } from './src/screens/SplashScreen';
import { AzureLoginScreen } from './src/screens/auth/AzureLoginScreen';
import { DoorControlScreen } from './src/screens/control/DoorControlScreen';
import { setAuthToken, setBaseUrl, setTokenRefresher } from './src/lib/api';
import AuthService from './src/services/auth/AuthService';
import { isReauthRequiredError } from './src/services/auth/authErrors';
import { LOGIN_NOTICE, noRoomMessage } from './src/services/auth/loginMessages';
import { checkSession, UserInfo } from './src/services/auth/session';
import { checkAndHandleReinstall } from './src/utils/appVersion';
import { showUpgradeAlert } from './src/utils/store';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [showSplash, setShowSplash] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isAutoLoginInProgress, setIsAutoLoginInProgress] = useState(false);
  // 로그인 화면이 나온 이유를 알리는 안내 (로그인 정보 만료, 방 정보 없음, 자동 로그인 실패 등)
  const [loginNotice, setLoginNotice] = useState<{ message: string; retry?: boolean } | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const lastVerifyRef = useRef<number>(0);
  // 자동 로그인이 진행 중인가 (겹쳐 실행하지 않기 위함)
  const autoLoginRunningRef = useRef(false);
  // 네트워크·서버 문제 같은 일시적인 이유로 자동 로그인에 실패했는가. 저장된 로그인 정보는 그대로 있으니 앱에 돌아왔을 때 다시 시도한다.
  const retrySilentLoginRef = useRef(false);
  // 로그인 화면에서 사용자가 직접 로그인하는 중인가. 이때는 자동 로그인을 다시 시도하지 않는다.
  const interactiveLoginBusyRef = useRef(false);

  useEffect(() => {
    const DEV_EMULATOR_URL = 'http://10.0.2.2:8000'; // Android 에뮬레이터용
    const DEV_DEVICE_URL = 'http://localhost:8000'; // 실제 디바이스용 http://192.168.0.24:8000
    const PROD_BASE_URL = 'https://smartdoor-backend.unist.ac.kr';
    
    const FORCE_LOCAL = false; // 테스트 : true , 운영 : false
    const USE_EMULATOR = false; // 에뮬레이터: true, 실제 디바이스: false
    
    let TARGET_BASE_URL;
    if (FORCE_LOCAL) {
      TARGET_BASE_URL = USE_EMULATOR ? DEV_EMULATOR_URL : DEV_DEVICE_URL;
    } else {
      TARGET_BASE_URL = __DEV__ 
        ? (USE_EMULATOR ? DEV_EMULATOR_URL : DEV_DEVICE_URL)
        : PROD_BASE_URL;
    }
    
    if (TARGET_BASE_URL) {
      setBaseUrl(TARGET_BASE_URL);
    }

    // 요청 중 액세스 토큰이 만료되었거나 만료 직전이면 api 계층이 이 함수로 토큰을 갱신하고 요청을 다시 보낸다
    setTokenRefresher(() => AuthService.refreshTokens());
    return () => setTokenRefresher(null);
  }, []);

  // 저장된 로그인 정보를 지우고 로그아웃 상태로 만든다. 갑자기 로그인 화면이 나오면 학생이 당황하므로 이유를 안내로 남긴다.
  const forceLogout = async (notice: { message: string; retry?: boolean }) => {
    await AuthService.clearStoredTokens();
    setLoginNotice(notice);
    setAuthToken(null);
    setUserInfo(null);
    setIsLoggedIn(false);
  };

  // 자동로그인 시도 (스플래시 종료 후 실행)
  //
  // 저장된 로그인 정보는 "다시 로그인해야 하는 것이 확실할 때"만 지운다.
  //  - Azure 가 갱신 토큰을 명확히 거부했다 (만료, 취소 등)
  //  - 서버가 방 정보가 없다고 명확히 답했다 (퇴사, 배정 변경 등)
  // 네트워크 불안정, 서버 오류, 알 수 없는 오류에서는 지우지 않는다. 지우면 학생이 다시 로그인해야 한다.
  const trySilentLogin = async () => {
    if (autoLoginRunningRef.current) {
      return;
    }
    autoLoginRunningRef.current = true;
    retrySilentLoginRef.current = false;
    try {
      const stored = await AuthService.getStoredTokens();
      // iOS(MSAL): accountId 필수 (Keychain 계정 매칭용)
      // Android: refreshToken 필수
      if (Platform.OS === 'ios') {
        if (!(stored as any)?.accountId) {
          setLoginNotice(null); // 다시 시도할 로그인 정보가 없다
          return;
        }
      } else {
        if (!stored?.refreshToken) {
          setLoginNotice(null);
          return;
        }
      }

      // 토큰이 있을 때만 로딩 표시
      setIsAutoLoginInProgress(true);

      let tokens;
      try {
        tokens = await AuthService.refreshTokens();
      } catch (e: any) {
        if (isReauthRequiredError(e)) {
          console.log('자동 로그인: 갱신 토큰이 거부됨 (토큰 삭제):', e?.message || e);
          await AuthService.clearStoredTokens();
          setLoginNotice({ message: LOGIN_NOTICE.expired });
        } else {
          console.log('자동 로그인: 일시적인 오류 (토큰 보존):', e?.message || e);
          retrySilentLoginRef.current = true;
          setLoginNotice({ message: LOGIN_NOTICE.autoLoginFailed, retry: true });
        }
        return;
      }
      if (!tokens?.accessToken) {
        // 갱신이 성공했다는데 토큰이 없다. 이 로그인 정보로는 진행할 수 없다.
        await AuthService.clearStoredTokens();
        setLoginNotice({ message: LOGIN_NOTICE.expired });
        return;
      }
      setAuthToken(tokens.accessToken, tokens.expiresOn);

      // 백엔드로 사용자/방 정보 조회
      const check = await checkSession();
      switch (check.kind) {
        case 'ok':
          setLoginNotice(null);
          setUserInfo(check.user);
          setIsLoggedIn(true);
          break;
        case 'no_room':
          // 서버가 방 정보가 없다고 명확히 답했다
          await AuthService.clearStoredTokens();
          setLoginNotice({ message: noRoomMessage(check.reason) });
          break;
        case 'upgrade_required':
          // 앱을 업데이트하면 저장된 로그인 정보로 다시 자동 로그인된다. 지우지 않는다.
          showUpgradeAlert();
          break;
        default:
          // token_rejected, unavailable: 서버/네트워크 문제일 수 있다. 토큰은 그대로 두고 나중에 다시 시도한다.
          console.log(`자동 로그인: 확인하지 못함 (${check.kind}, 토큰 보존)`);
          retrySilentLoginRef.current = true;
          setLoginNotice({ message: LOGIN_NOTICE.autoLoginFailed, retry: true });
      }
    } catch (e: any) {
      // 예기치 못한 오류도 로그인 정보는 지우지 않는다
      console.log('자동 로그인 실패 (토큰 보존):', e?.message || e);
      retrySilentLoginRef.current = true;
      setLoginNotice({ message: LOGIN_NOTICE.autoLoginFailed, retry: true });
    } finally {
      autoLoginRunningRef.current = false;
      setIsAutoLoginInProgress(false);
    }
  };

  // 포그라운드 복귀 시 세션 재검증 (adb 강제 실행/복귀 우회 방지)
  const verifySessionOnResume = useCallback(async () => {
    // 로그인 상태가 아니면 스킵 (로그아웃 후 자동 로그인 방지)
    if (!isLoggedIn) {
      return;
    }

    // 너무 잦은 호출 방지 (3초 윈도우)
    const now = Date.now();
    if (now - lastVerifyRef.current < 3000) return;
    lastVerifyRef.current = now;

    try {
      const stored = await AuthService.getStoredTokens();
      if (!stored?.accessToken) {
        // 토큰 없으면 즉시 로그아웃 상태로
        setAuthToken(null);
        setUserInfo(null);
        setIsLoggedIn(false);
        return;
      }
      // 토큰 설정 후 서버 확인. 토큰이 만료됐으면 api 계층이 요청 전에 갱신한다.
      setAuthToken(stored.accessToken, stored.expiresOn);
      const check = await checkSession();
      switch (check.kind) {
        case 'ok':
          setUserInfo(check.user);
          setIsLoggedIn(true);
          break;
        case 'no_room':
          // 서버가 방 정보가 없다고 명확히 답했다 → 로그아웃
          await forceLogout({ message: noRoomMessage(check.reason) });
          break;
        case 'token_rejected':
          // 갱신을 시도했는데 Azure 가 갱신 토큰을 거부한 경우에만 로그아웃한다. 그 밖에는 현재 상태를 유지한다.
          if (AuthService.reauthRequired) {
            await forceLogout({ message: LOGIN_NOTICE.expired });
          }
          break;
        default:
        // upgrade_required, unavailable: 일시적인 문제일 수 있다. 현재 로그인 상태 유지
      }
    } catch (err: any) {
      // 네트워크 오류 등은 무시 (일시적 끊김 허용)
      // 현재 로그인 상태 유지
      console.log('verifySessionOnResume 오류 (상태 유지):', err);
    }
  }, [isLoggedIn]);

  // AppState 구독: active 전환 시 세션 재검증
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if ((prev === 'background' || prev === 'inactive') && next === 'active') {
        verifySessionOnResume();
        // 일시적인 오류로 자동 로그인에 실패했었다면, 앱으로 돌아왔을 때 다시 시도한다
        if (!isLoggedIn && retrySilentLoginRef.current && !interactiveLoginBusyRef.current) {
          trySilentLogin();
        }
      }
    });
    return () => {
      try { sub.remove(); } catch {}
    };
  }, [isLoggedIn, verifySessionOnResume]);

  const handleSplashFinish = async () => {
    setShowSplash(false);
    
    // 재설치 감지 및 초기화
    const wasReinstalled = await checkAndHandleReinstall();
    if (wasReinstalled) {
      // 재설치된 경우 로그인 화면으로 (자동 로그인 스킵)
      return;
    }
    
    // 스플래시 종료 후 즉시 세션 검증 + 자동로그인 시도(iOS 무소음 포함)
    verifySessionOnResume();
    trySilentLogin();
  };

  const handleLogin = (user: UserInfo) => {
    setLoginNotice(null);
    setUserInfo(user);
    setIsLoggedIn(true);
  };

  const handleLogout = async () => {
    // 자동로그인 해제: 저장된 토큰 삭제 + 메모리 토큰 해제
    try { 
      await AuthService.clearStoredTokens(); 
    } catch {}
    setAuthToken(null);
    setLoginNotice(null); // 직접 로그아웃한 경우에는 안내가 필요 없다
    setUserInfo(null);
    setIsLoggedIn(false);
  };

  // 스플래시 화면 표시
  if (showSplash) {
    return <SplashScreen onFinish={handleSplashFinish} />;
  }

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        {isLoggedIn ? (
          <DoorControlScreen onLogout={handleLogout} userInfo={userInfo} />
        ) : (
          <AzureLoginScreen 
            onSuccess={handleLogin} 
            isAutoLoginInProgress={isAutoLoginInProgress}
            onBusyChange={(busy: boolean) => {
              interactiveLoginBusyRef.current = busy;
              if (busy) {
                setLoginNotice(null); // 직접 로그인을 시작하면 이전 안내는 지운다
              }
            }}
            notice={loginNotice}
            onRetry={() => {
              trySilentLogin();
            }}
          />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
