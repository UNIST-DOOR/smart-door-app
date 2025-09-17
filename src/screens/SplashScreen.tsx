import React, { useEffect, useMemo } from 'react';
import {
  View,
  Image,
  StatusBar,
  StyleSheet,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import InAppUpdates, { IAUUpdateKind } from 'react-native-in-app-updates';

const { width, height } = Dimensions.get('window');

interface SplashScreenProps {
  onFinish: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const fadeAnim = useMemo(() => new Animated.Value(0), []);
  const scaleAnim = useMemo(() => new Animated.Value(0.8), []);

  useEffect(() => {
    // 로고 애니메이션 시작
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
    ]).start();

    let cancelled = false;

    const checkInAppUpdateAndProceed = async () => {
      try {
        if (Platform.OS === 'android') {
          const iap = new InAppUpdates(false);
          const res: any = await iap.checkNeedsUpdate();
          if (!cancelled && res?.shouldUpdate) {
            await iap.startUpdate({ updateType: IAUUpdateKind.IMMEDIATE });
            return; // 업데이트 플로우로 제어 이관
          }
        }
      } catch {
        // 실패 시 스플래시 진행
      }

      if (!cancelled) {
        setTimeout(() => {
          onFinish();
        }, 2500);
      }
    };

    checkInAppUpdateAndProceed();

    return () => {
      cancelled = true;
    };
  }, [fadeAnim, scaleAnim, onFinish]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      
      <Animated.View
        style={[
          styles.logoContainer,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Image
          source={require('../assets/wordmark_logo.jpg')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>
      
      <View style={styles.footer}>
        <View style={styles.loadingDots}>
          <View style={[styles.dot, styles.dot1]} />
          <View style={[styles.dot, styles.dot2]} />
          <View style={[styles.dot, styles.dot3]} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF', // 흰색 배경
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  logo: {
    width: width * 0.8,
    height: height * 0.3,
    maxWidth: 400,
    maxHeight: 200,
  },
  footer: {
    position: 'absolute',
    bottom: 80,
    alignItems: 'center',
  },
  loadingDots: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1B365D',
    marginHorizontal: 4,
  },
  dot1: {
    opacity: 0.3,
  },
  dot2: {
    opacity: 0.6,
  },
  dot3: {
    opacity: 1,
  },
}); 