/**
 * Smart Door Manager App
 * 대학교 기숙사 BLE 도어락 제어 앱
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SplashScreen } from './src/screens/SplashScreen';
import { AzureLoginScreen } from './src/screens/auth/AzureLoginScreen';
import { DoorControlScreen } from './src/screens/control/DoorControlScreen';
import { apiGet, setAuthToken, setBaseUrl } from './src/lib/api';
import AuthService from './src/services/auth/AuthService';

// 사용자 정보 타입 정의
interface UserInfo {
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

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [showSplash, setShowSplash] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isAutoLoginInProgress, setIsAutoLoginInProgress] = useState(false);

  useEffect(() => {
    const DEV_EMULATOR_URL = 'https://smartdoor-backend.unist.ac.kr'; // Android 에뮬레이터용
    const DEV_DEVICE_URL = 'http://192.168.0.24:8000'; // 실제 디바이스용
    const PROD_BASE_URL = 'https://smartdoor-backend.unist.ac.kr';
    
    const FORCE_LOCAL = true; // 테스트 : true , 운영 : false
    const USE_EMULATOR = true; // 에뮬레이터: true, 실제 디바이스: false
    
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
  }, []);

  // 자동로그인 시도 (스플래시 종료 후 실행)
  const trySilentLogin = async () => {
    try {
      const stored = await AuthService.getStoredTokens();
      // iOS(MSAL): Keychain 계정 기반이므로 저장 토큰이 없어도 시도
      // Android: 저장된 refreshToken 없으면 스킵
      if (Platform.OS !== 'ios' && !stored?.refreshToken) {
        return;
      }

      // 토큰이 있을 때만 로딩 표시
      setIsAutoLoginInProgress(true);

      const tokens = await AuthService.refreshTokens();
      if (!tokens?.accessToken) {
        return;
      }
      setAuthToken(tokens.accessToken);
      // 백엔드로 사용자/방 정보 조회
      const unwrap = (res: any) => (res && typeof res === 'object' && 'data' in res ? (res as any).data : res);
      const meRes = await apiGet('/api/me/');
      const roomInfoRes = await apiGet('/api/room-info/');
      const me = unwrap(meRes);
      const roomInfo = unwrap(roomInfoRes);
      if (!roomInfo?.ok || !roomInfo?.found) {
        return;
      }
      const user: UserInfo = {
        username: String(roomInfo?.upn || ''),
        name: String(me?.name || ''),
        building: String(roomInfo?.building || ''),
        room: String(roomInfo?.room || ''),
        bleId: roomInfo?.bleId ? String(roomInfo.bleId) : undefined,
        checkInDate: roomInfo?.checkInDate ? String(roomInfo.checkInDate) : undefined,
        checkInTime: roomInfo?.checkInTime ? String(roomInfo.checkInTime) : undefined,
        checkOutDate: roomInfo?.checkOutDate ? String(roomInfo.checkOutDate) : undefined,
        checkOutTime: roomInfo?.checkOutTime ? String(roomInfo.checkOutTime) : undefined,
      };
      setUserInfo(user);
      setIsLoggedIn(true);
    } catch (e) {
      // 자동로그인 실패 시 로그인 화면 유지
    } finally {
      setIsAutoLoginInProgress(false);
    }
  };

  const handleSplashFinish = () => {
    setShowSplash(false);
    // 스플래시 종료 후 자동로그인 시도
    trySilentLogin();
  };

  const handleLogin = (user: UserInfo) => {
    setUserInfo(user);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    // 자동로그인 해제: 저장된 토큰 삭제 + 메모리 토큰 해제
    try { AuthService.clearStoredTokens(); } catch {}
    setAuthToken(null);
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
