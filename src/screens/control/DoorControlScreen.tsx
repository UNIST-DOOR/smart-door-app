import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity, StatusBar, Image, ActivityIndicator, Vibration, Modal, Platform, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBLE } from '../../hooks/useBLE';
import { useDoor, OpenOutcome } from '../../hooks/useDoor';
// import { LogViewer } from '../../components/ui/LogViewer'; 디버그
import { generateDeviceName } from '../../utils/helpers';
import { showUpgradeAlert } from '../../utils/store';
import { apiPost } from '../../lib/api';

import { styles } from './DoorControlScreen.styles';

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

const BLUETOOTH_OFF_MESSAGE = '블루투스가 꺼져 있습니다.\n설정에서 블루투스를 켜주세요.';
const BLUETOOTH_PERMISSION_MESSAGE =
  Platform.OS === 'ios'
    ? '도어락을 열려면 이 앱의 블루투스 사용을 허용해야 합니다.\n설정에서 블루투스를 켜 주세요.'
    : Number(Platform.Version) >= 31
    ? "도어락을 열려면 권한이 필요합니다.\n설정의 권한에서 '근처 기기'를 허용해 주세요."
    : "도어락을 열려면 권한이 필요합니다.\n설정의 권한에서 '위치'를 허용해 주세요.";

interface DoorControlScreenProps {
  onLogout: () => void;
  userInfo: UserInfo | null;
}

export const DoorControlScreen: React.FC<DoorControlScreenProps> = ({ onLogout, userInfo }) => {
  const [isRoomOpening, setIsRoomOpening] = useState(false);
  const [isEntranceOpening, setIsEntranceOpening] = useState(false);
  const [autoAlertVisible, setAutoAlertVisible] = useState(false);
  const [autoAlertTitle, setAutoAlertTitle] = useState<string>('');
  const [autoAlertMessage, setAutoAlertMessage] = useState<string>('');
  // 이전 알림의 닫기 타이머가 남아 새 알림을 일찍 닫지 않도록 하나만 유지한다
  const autoAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showAutoAlert = (title: string, message: string, durationMs = 3000) => {
    setAutoAlertTitle(title);
    setAutoAlertMessage(message);
    setAutoAlertVisible(true);
    if (autoAlertTimerRef.current) {
      clearTimeout(autoAlertTimerRef.current);
    }
    autoAlertTimerRef.current = setTimeout(() => setAutoAlertVisible(false), durationMs);
  };
  useEffect(() => {
    return () => {
      if (autoAlertTimerRef.current) {
        clearTimeout(autoAlertTimerRef.current);
      }
    };
  }, []);

  // 문 열기 버튼을 연타해도 한 번에 하나만 실행되도록 누르는 즉시 잠근다.
  // (버튼 비활성화는 상태값이라 블루투스 상태 확인(await) 사이에 한 번 더 눌리는 것을 막지 못한다)
  const openingLockRef = useRef(false);
  const runExclusive = async (task: () => Promise<void>) => {
    if (openingLockRef.current) {
      return;
    }
    openingLockRef.current = true;
    try {
      await task();
    } finally {
      openingLockRef.current = false;
    }
  };

  const {
    isConnected,
    bleService,
    isInitialized,
  } = useBLE();

  const {
    isSending,
    openRoomDoor,
    openEntranceDoor,
    // logs, 디버그
    // clearLogs,
  } = useDoor(bleService);

  // 다시 로그인해야 해결되는 실패인가 (로그인 정보 만료, 방 정보가 바뀐 경우)
  const needsRelogin = (outcome: OpenOutcome): boolean =>
    outcome.status === 'UNAUTHORIZED' || (outcome.status === 'FORBIDDEN' && outcome.reason === 'bleid_mismatch');

  // 방 문 열기 실패 사유별 안내 문구
  const openFailureMessage = (outcome: OpenOutcome): string => {
    switch (outcome.status) {
      case 'FORBIDDEN':
        // 서버가 알려 주는 이유별로 학생이 무엇을 하면 되는지 안내한다
        switch (outcome.reason) {
          case 'stay_expired':
            return '기숙사 이용 기간이 만료되었습니다.';
          case 'bleid_mismatch':
            // 앱이 가진 방 정보가 서버의 최신 배정과 다르다 (방이 바뀐 경우). 다시 로그인하면 최신 정보로 바뀐다.
            return '방 정보가 변경된 것 같습니다.\n다시 로그인하면 최신 방 정보로 바뀝니다.';
          case 'not_registered':
          case 'no_room':
          case 'room_not_found':
            return '배정된 방 정보를 찾을 수 없습니다.\n관리사무소에 문의해 주세요.';
          default:
            return '문을 열 수 있는 권한이 없습니다.\n관리사무소에 문의해 주세요.';
        }
      case 'RATE_LIMITED':
        return '요청이 너무 많습니다.\n잠시 후 다시 시도해주세요.';
      case 'OFFLINE':
        return '서버와 통신하지 못했습니다.\n잠시 후 다시 시도해 주세요.\n계속되면 관리자에게 문의해 주세요.';
      case 'SERVER_ERROR':
        // 서버에 연결은 됐지만 서버가 문제를 일으켰다 (DB 연결 문제 등). 학생이 할 수 있는 건 잠시 뒤 다시 시도하는 것이다.
        return '서버에 일시적인 문제가 있습니다.\n잠시 후 다시 시도해 주세요.\n계속되면 관리자에게 문의해 주세요.';
      case 'UNAUTHORIZED':
        return '로그인 정보가 만료되었습니다.\n다시 로그인해 주세요.';
      case 'PERMISSION_DENIED':
        return BLUETOOTH_PERMISSION_MESSAGE;
      case 'BLUETOOTH_OFF':
        return BLUETOOTH_OFF_MESSAGE;
      case 'BLE_FAIL':
        return '도어락과 연결하지 못했습니다.\n도어락 가까이에서 다시 시도해주세요.';
      case 'NO_RESPONSE':
        return '도어락이 응답하지 않았습니다.\n잠시 후 다시 시도해주세요.';
      case 'DOOR_FAIL':
        return '도어락이 명령을 처리하지 못했습니다.\n다시 시도해주세요.';
      default:
        return '도어락 열기에 실패했습니다.\n다시 시도해주세요.';
    }
  };

  // 권한이 없으면 앱 설정 화면으로 보내 준다 (거부 후 "다시 묻지 않음"이면 설정에서만 바꿀 수 있다)
  const showPermissionAlert = () => {
    Alert.alert('블루투스 권한이 필요합니다', BLUETOOTH_PERMISSION_MESSAGE, [
      { text: '취소', style: 'cancel' },
      {
        text: '설정 열기',
        onPress: () => {
          Linking.openSettings().catch(() => {});
        },
      },
    ]);
  };

  /**
   * 문 열기 전 블루투스 상태 확인. 쓸 수 없으면 이유에 맞는 안내를 띄우고 false 를 돌려준다.
   * (꺼져 있음 → 켜 달라고 안내 / 권한 없음 → 설정 열기 안내)
   */
  const checkBluetoothBeforeOpen = async (): Promise<boolean> => {
    if (!bleService) {
      // 앱을 막 켠 직후 블루투스 준비가 끝나기 전. 예전에는 이때도 "블루투스가 꺼져 있습니다"가 떴다.
      Alert.alert('알림', '블루투스를 준비하는 중입니다.\n잠시 후 다시 시도해 주세요.');
      return false;
    }
    let issue = await bleService.getBluetoothIssue();
    if (issue === 'PERMISSION' && Platform.OS === 'android') {
      // 안드로이드는 처음 한 번 거부했을 뿐이면 여기서 시스템 권한 창을 다시 띄울 수 있다
      const granted = await bleService.requestBlePermissions();
      issue = granted ? await bleService.getBluetoothIssue() : 'PERMISSION';
    }
    if (issue === 'PERMISSION') {
      showPermissionAlert();
      return false;
    }
    if (issue === 'POWERED_OFF') {
      Alert.alert('알림', BLUETOOTH_OFF_MESSAGE);
      return false;
    }
    return true;
  };

  // fo_door_tran 일시 포맷팅(IDATE+ITIME / ODATE+OTIME)
  const formatDoorTran = (dateStr?: string, timeStr?: string) => {
    if (!dateStr && !timeStr) return '정보 없음';
    const d = (dateStr || '').replace(/[^0-9]/g, '');
    const t = (timeStr || '').replace(/[^0-9]/g, '');
    // YYYYMMDD → YYYY-MM-DD
    const dFmt = d.length === 8 ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : (d || '');
    // HHMMSS → HH:MM (초는 생략)
    const tFmt = t.length >= 4 ? `${t.slice(0,2)}:${t.slice(2,4)}` : (t || '');
    const both = [dFmt, tFmt].filter(Boolean).join(' ');
    return both || '정보 없음';
  };

  // 만료 판단용: fo_door_tran의 날짜/시간을 Date로 변환
  const doorTranToDate = (dateStr?: string, timeStr?: string): Date | null => {
    if (!dateStr) return null;
    const d = (dateStr || '').replace(/[^0-9]/g, '');
    if (d.length !== 8) return null;
    const year = parseInt(d.slice(0, 4), 10);
    const month = parseInt(d.slice(4, 6), 10) - 1; // 0-based
    const day = parseInt(d.slice(6, 8), 10);
    let hour = 0;
    let min = 0;
    if (timeStr) {
      const t = timeStr.replace(/[^0-9]/g, '');
      if (t.length >= 2) hour = parseInt(t.slice(0, 2), 10);
      if (t.length >= 4) min = parseInt(t.slice(2, 4), 10);
      // '24:00' 같은 케이스 보정: 해당 일자 말일로 처리
      if (hour === 24 && min === 0) {
        hour = 23; min = 59;
      }
    }
    return new Date(year, month, day, hour, min, 0, 0);
  };

  const isStayExpired = (): boolean => {
    const outAt = doorTranToDate(userInfo?.checkOutDate, userInfo?.checkOutTime);
    if (!outAt) return false; // 정보 없으면 막지 않음
    const now = new Date();
    return now.getTime() > outAt.getTime();
  };

  // 동 → 관리실 동/전화번호 매핑 규칙
  const resolveOfficeForBuilding = (buildingStr?: string): { officeBuilding: number | null; phone: string | null } => {
    const num = parseInt((buildingStr || '').replace(/[^0-9]/g, ''), 10);
    if (Number.isNaN(num)) {
      return { officeBuilding: null, phone: null };
    }
    let office: number | null = null;
    if (num >= 301 && num <= 305) {
      office = 302;
    } else if (num >= 306 && num <= 307) {
      office = 307;
    } else if (num >= 308 && num <= 309) {
      office = 308;
    }
    const phoneMap: Record<number, string> = {
      302: '052-217-6971',
      307: '052-217-4267',
      308: '052-217-6940',
    };
    const phone = office ? phoneMap[office] : null;
    return { officeBuilding: office, phone };
  };

  const openDoorFlow = async () => {
    // 이용 기간 만료 차단
    if (isStayExpired()) {
      Alert.alert('알림', '기숙사 이용 기간이 만료되었습니다.');
      return;
    }
    // 블루투스 상태 확인 (꺼짐 / 권한 없음을 구분해 안내)
    if (!(await checkBluetoothBeforeOpen())) {
      return;
    }
    // 햅틱 피드백 (안전하게 실행)
    try {
      setIsRoomOpening(true);
      Vibration.vibrate(50);
    } catch (error) {
      // 권한 없거나 애뮬레이터일 때 무시
    }
    
    try {
      // BLE 서비스 초기화 대기 (최대 5초)
      if (!isInitialized || !bleService) {
        // 최대 5초 동안 초기화 완료 대기
        for (let i = 0; i < 50; i++) {
          if (isInitialized && bleService) {
            break;
          }
          await new Promise(resolve => setTimeout(() => resolve(undefined), 100));
        }
        
        // 여전히 초기화되지 않았으면 오류
        if (!isInitialized || !bleService) {
          Alert.alert('오류', '도어락과 통신할 준비가 되지 않았습니다.\n앱을 다시 실행해 주세요.');
          return;
        }
      }

      // 사용자 정보 기반으로 기기명 생성 (bleId 우선, 없으면 동/호 기반). 없으면 오류 처리
      if (!userInfo) {
        Alert.alert('오류', '사용자 방 정보가 없습니다. 다시 로그인해 주세요.');
        return;
      }
      let deviceName: string | null = null;
      if (userInfo.bleId && userInfo.bleId.trim()) {
        deviceName = `unist_${userInfo.bleId.replace(/[^0-9]/g, '')}`;
      } else if (userInfo.building && userInfo.room) {
        deviceName = generateDeviceName(userInfo.building, userInfo.room);
      } else {
        Alert.alert('오류', '동/호 정보가 없습니다. 관리자에게 문의하세요.');
        return;
      }
      
      // 문 열기 실행 (서버에서 서명 패킷 받기 → 스캔·연결 → 전송)
      const outcome = await openRoomDoor({
        bleid: userInfo.bleId?.replace(/[^0-9]/g, '') || undefined,
        fallbackDeviceName: deviceName,
      });

      if (outcome.status === 'OK') {
        showAutoAlert('성공', '도어락이 열렸습니다!');

        // 기존 문 열림 로그(mqtt_cmd_log). 서명 문열기 로그(BLE_OPEN_LOG)는 서버가 따로 남긴다.
        apiPost('/api/door/log/', {
          platform: Platform.OS,
          doorType: 'door',
        }).catch(err => console.warn('[로그] 도어락 로그 전송 실패:', err));
      } else if (outcome.status === 'UPGRADE_REQUIRED') {
        showUpgradeAlert();
      } else if (outcome.status === 'PERMISSION_DENIED') {
        showPermissionAlert();
      } else if (needsRelogin(outcome)) {
        // 다시 로그인해야 해결되는 경우에는 안내 창에서 바로 다시 로그인할 수 있게 한다
        Alert.alert('실패', openFailureMessage(outcome), [
          { text: '닫기', style: 'cancel' },
          {
            text: '다시 로그인',
            onPress: () => {
              onLogout();
            },
          },
        ]);
      } else {
        Alert.alert('실패', openFailureMessage(outcome));
      }
    } catch (error) {
      // 원인은 개발자용 로그로만 남기고, 학생에게는 알아볼 수 있는 문구를 보여 준다
      console.warn('[문열기] 예기치 않은 오류:', error);
      Alert.alert('오류', '문을 여는 중 문제가 발생했습니다.\n다시 시도해 주세요.');
    } finally {
      setIsRoomOpening(false);
    }
  };
  const handleOpenDoor = () => runExclusive(openDoorFlow);



  const frontDoorFlow = async () => {
    // 이용 기간 만료 차단
    if (isStayExpired()) {
      Alert.alert('알림', '기숙사 이용 기간이 만료되었습니다.');
      return;
    }
    // 블루투스 상태 확인 (꺼짐 / 권한 없음을 구분해 안내)
    if (!(await checkBluetoothBeforeOpen())) {
      return;
    }
    // 햅틱 피드백 (안전하게 실행)
    try {
      setIsEntranceOpening(true);
      Vibration.vibrate(50);
    } catch (error) {
      // 권한 없거나 애뮬레이터일 때 무시
    }
    
    try {
      // BLE 서비스 초기화 대기 (최대 5초)
      if (!isInitialized || !bleService) {
        // 최대 5초 동안 초기화 완료 대기
        for (let i = 0; i < 50; i++) {
          if (isInitialized && bleService) {
            break;
          }
          await new Promise(resolve => setTimeout(() => resolve(undefined), 100));
        }
        
        // 여전히 초기화되지 않았으면 오류
        if (!isInitialized || !bleService) {
          Alert.alert('오류', '도어락과 통신할 준비가 되지 않았습니다.\n앱을 다시 실행해 주세요.');
          return;
        }
      }

      // 로그인 사용자 building(동) 기반 접두사로 공동현관 탐색
      if (!userInfo || !userInfo.building) {
        Alert.alert('오류', '동(Building) 정보가 없습니다. 다시 로그인해 주세요.');
        return;
      }

      // 공동현관문 열기 실행 (접두사 스캔 → 연결 → 전송 → 연결 종료)
      const success = await openEntranceDoor(userInfo.building);

      if (success) {
        showAutoAlert('성공', '공동현관문이 열렸습니다!');

        // 백엔드에 로그 전송 (비동기, 실패해도 무시)
        apiPost('/api/door/log/', {
          platform: Platform.OS,
          doorType: 'relay',
        }).catch(err => console.warn('[로그] 공동현관문 로그 전송 실패:', err));
      } else if (bleService?.lastInitFailure === 'PERMISSION') {
        // 문 열기 직전에 권한이 사라진 드문 경우
        showPermissionAlert();
      } else if (bleService?.lastInitFailure === 'POWERED_OFF') {
        Alert.alert('알림', BLUETOOTH_OFF_MESSAGE);
      } else {
        Alert.alert('실패', '공동현관문 열기에 실패했습니다.\n다시 시도해주세요.');
      }
    } catch (error) {
      // 원인은 개발자용 로그로만 남기고, 학생에게는 알아볼 수 있는 문구를 보여 준다
      console.warn('[공동현관문] 예기치 않은 오류:', error);
      Alert.alert('오류', '공동현관문을 여는 중 문제가 발생했습니다.\n다시 시도해 주세요.');
    } finally {
      setIsEntranceOpening(false);
    }
  };
  const handleFrontDoorOpen = () => runExclusive(frontDoorFlow);

  const handleInquiry = () => {
    const { officeBuilding, phone } = resolveOfficeForBuilding(userInfo?.building);
    const line = officeBuilding
      ? `${officeBuilding}동 관리사무소 번호 : ${phone || '정보 없음'}`
      : '관리사무소 번호 : 1588-0000';
    Alert.alert(
      '문의하기',
      `${line}`,
      [
        { text: '확인', style: 'default' }
      ]
    );
  };

  const checkInDisplay = formatDoorTran(userInfo?.checkInDate, userInfo?.checkInTime);
  const checkOutDisplay = formatDoorTran(userInfo?.checkOutDate, userInfo?.checkOutTime);

  // 로그아웃 처리
  const handleLogout = () => {
    Alert.alert(
      '로그아웃',
      '정말 로그아웃 하시겠습니까?',
      [
        { text: '취소', style: 'cancel' },
        { text: '로그아웃', onPress: async () => await onLogout(), style: 'destructive' }
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeContainer}> 
      <StatusBar
        barStyle="dark-content"
        backgroundColor="#FFFFFF"
        translucent={false}
      />
      
      <View style={styles.container}>
        {/* Decorative soft blobs */}
        <View style={styles.decorLayer}>
          <View style={styles.decorBlobOne} />
          <View style={styles.decorBlobTwo} />
        </View>
        {/* 헤더 */}
        <View style={styles.header}>
        <TouchableOpacity 
          style={styles.helpButton} 
          onPress={handleInquiry} 
          accessibilityLabel="문의하기"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="phone-outline" size={24} color="#001A53" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Image 
            source={require('../../assets/unist.png')} 
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
        <TouchableOpacity 
          style={styles.helpButton} 
          onPress={handleLogout} 
          accessibilityLabel="로그아웃"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="logout-variant" size={22} color="#001A53" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={true}>
        {/* 방 정보 */}
        <View style={styles.roomSection}>
          <View style={styles.roomNumberContainer}>
            <Text style={styles.roomPrefix}>Room </Text>
            <Text style={styles.roomNumber}>
              {userInfo ? `${userInfo.building}동 ${userInfo.room}호` : '정보 없음'}
            </Text>
          </View>

          {/* 이름*/}
          <View style={styles.roomNumberContainer}>
            <Text style={styles.roomPrefix}>Name </Text>
            <Text style={styles.roomNumber}>
              {userInfo ? `${(userInfo.name || userInfo.username) ?? ''}` : '정보 없음'}
            </Text>
          </View>
          
          <View style={styles.timeInfo}>
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>Access Period</Text>
              <View style={styles.timeValueColumn}>
                <Text style={styles.timeValue}>{checkInDisplay}</Text>
                <Text style={styles.timeSeparatorBlock}>~</Text>
                <Text style={styles.timeValue}>{checkOutDisplay}</Text>
              </View>
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>Connection</Text>
              <View style={[
                styles.connectionChip,
                isConnected ? styles.connectionChipOn : styles.connectionChipOff
              ]}>
                <View style={[
                  styles.connectionChipIcon,
                  isConnected ? styles.connectionChipIconOn : styles.connectionChipIconOff
                ]}>
                  <Icon name={isConnected ? 'bluetooth' : 'bluetooth-off'} size={24} color={isConnected ? '#44C1C4' : '#64748B'} />
                </View>
                <Text style={[styles.timeValue, isConnected ? styles.statusTextOn : styles.statusTextOff, styles.connectionChipText]}>
                  {isConnected ? '연결됨' : '대기 중'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* 문열림 버튼 */}
        <View style={styles.actionRow}>

          {/* 공동현관문 카드 */}
          <TouchableOpacity 
            style={[styles.actionCard, styles.actionCardSecondary]}
            onPress={handleFrontDoorOpen}
            disabled={isSending || isEntranceOpening}
            >
            {isEntranceOpening ? (
              <ActivityIndicator size="large" color="#001B54" />
            ) : (
            <View style={styles.actionIcon}>
              <View style={styles.actionIconCircleEntrance}>
                <Image source={require('../../assets/slidedoor_icon.png')} style={styles.entranceIconImage} />
              </View>
            </View>
            )}
            <Text style={[styles.cardHeading, styles.cardHeadingOnSecondary]}>{isEntranceOpening ? '여는 중…' : '공동현관문 열기'}</Text>
            {!isEntranceOpening && (
              <Text style={[styles.cardCaption, styles.cardCaptionOnSecondary]}>Open Entrance Door</Text>
            )}
          </TouchableOpacity>

          
          {/* 방 도어락 카드 */}
          <TouchableOpacity
            style={[styles.actionCard, styles.actionCardPrimary]}
            onPress={handleOpenDoor}
            disabled={isSending || isRoomOpening}
          >
            <View style={styles.cardInnerPrimary}>
              {isRoomOpening ? (
                <ActivityIndicator size="large" color="#44C1C4" />
              ) : (
                <View style={styles.actionIcon}>
                  <View style={styles.actionIconCirclePrimary}>
                    <Image source={require('../../assets/doorlock_icon.png')} style={styles.iconImagePrimary} />
                  </View>
                </View>
              )}
              <Text style={[styles.cardHeading, styles.cardHeadingOnPrimary]}>
                {isRoomOpening ? '여는 중…' : '도어락 열기'}
              </Text>
              {!isRoomOpening && (
                <Text style={[styles.cardCaption, styles.cardCaptionOnPrimary]}>Open Door Lock</Text>
              )}
            </View>
          </TouchableOpacity>


        </View>


        {/* 버튼 클릭 안내 문구 */}
        <View style={styles.instructionWrapper}>
          <Text style={styles.instructionTextKr}>
            버튼을 클릭하여 문을 열어주세요
          </Text>
          <Text style={styles.instructionText}>
            Click the button to open the door
          </Text>
        </View>

        {/* 문의 카드 제거됨 */}

        {/* 디버그 로그 */}
        {/* <View style={styles.logSection}>
          <Text style={styles.logTitle}>Debug Log</Text>
          <View style={styles.logActions}>
            <TouchableOpacity style={styles.logActionBtn} onPress={clearLogs}>
              <Text style={styles.logActionText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.logActionBtn}
              onPress={() => {
                try {
                  copyLogsToClipboard();
                  Alert.alert('알림', '로그가 클립보드에 복사되었습니다.');
                } catch {}
              }}
            >
              <Text style={styles.logActionText}>Copy</Text>
            </TouchableOpacity>
          </View>
          <LogViewer logs={logs} />
        </View> */}

        {/* 하단 패딩 */}
        <View style={styles.bottomPadding} />
      </ScrollView>
      </View>

      {/* Auto-close Alert-like modal */}
      <Modal transparent visible={autoAlertVisible} animationType="fade" onRequestClose={() => setAutoAlertVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{autoAlertTitle}</Text>
            <Text style={styles.modalMessage}>{autoAlertMessage}</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setAutoAlertVisible(false)}>
                <Text style={styles.modalActionText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

