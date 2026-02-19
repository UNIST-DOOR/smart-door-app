import React, { useState } from 'react';
import { View, Image, Text, TouchableOpacity, StatusBar, Alert, Linking } from 'react-native';
import { styles, COLORS } from './AzureLoginScreen.styles';
import AuthService from '../../services/auth/AuthService';
import { apiGet, setAuthToken } from '../../lib/api';

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

interface Props {
	onSuccess: (user: UserInfo) => void;
	isAutoLoginInProgress?: boolean;
}

export const AzureLoginScreen: React.FC<Props> = ({ onSuccess, isAutoLoginInProgress = false }) => {
	const [loading, setLoading] = useState(false);

	// 공통: 스토어 열기 + 업그레이드 안내 (Play 스토어 앱 우선, 불가 시 웹)
	const openStore = async () => {
		const pkg = 'com.smartdoormanager';
		const marketUrl = `market://details?id=${pkg}`;
		const webUrl = `https://play.google.com/store/apps/details?id=${pkg}`;
		try {
			const canOpen = await Linking.canOpenURL(marketUrl);
			if (canOpen) {
				await Linking.openURL(marketUrl);
			} else {
				await Linking.openURL(webUrl);
			}
		} catch {
			try { await Linking.openURL(webUrl); } catch {}
		}
	};

	const showUpgradeAlert = () => {
		Alert.alert(
			'업데이트 필요',
			'사용할 수 없는 앱 버전입니다.\n스토어에서 업데이트 후 사용해 주세요.\n1.0.1이하 버전은 보안업데이트로 인하여 앱 삭제 후 재설치해주시길 바랍니다.',
			[
				{ text: '취소', style: 'cancel' },
				{ text: '스토어로 이동', onPress: openStore }
			]
		);
	};

	const handleLogin = async () => {
		if (loading || isAutoLoginInProgress) return;
		setLoading(true);
		try {
			const result = await AuthService.signInInteractive();
			// 토큰 설정 후 사용자 및 방 정보 조회
			setAuthToken(result.accessToken ?? null);
			try {
			const unwrap = (res: any) => (res && typeof res === 'object' && 'data' in res ? (res as any).data : res);
			const meRes = await apiGet('/api/me/');
			const roomInfoRes = await apiGet('/api/room-info/');
			const me = unwrap(meRes);
			const roomInfo = unwrap(roomInfoRes);
			if (!roomInfo?.ok || !roomInfo?.found) {
				if (roomInfo?.error === 'upgrade_required') {
					showUpgradeAlert();
					// 업그레이드 필요 시에도 토큰 삭제
					await AuthService.clearStoredTokens();
					return;
				}
				// 방 정보 조회 실패 시 저장된 토큰 삭제
				Alert.alert('권한 없음', '방 정보가 조회되지 않았습니다. 관리자에게 문의하세요.');
				await AuthService.clearStoredTokens();
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
				// try { Alert.alert(`환영합니다. ${user.building}동 ${user.room}호 \n${user.name}님`); } catch {}
				onSuccess(user);
			} catch (callErr: any) {
				Alert.alert('백엔드 호출 실패', callErr?.message ?? '네트워크 오류');
			}
		} catch (e: any) {
			try {
				const raw = String(e?.error || e?.message || '');
				if (/access_denied|cancel/i.test(raw)) {
					Alert.alert('로그인 취소', '로그인이 취소되었습니다.');
					return;
				}
				Alert.alert('로그인 실패', '로그인 중 오류가 발생했습니다.\n다시 시도해 주세요.');
			} catch {
				Alert.alert('로그인 실패', '로그인 중 오류가 발생했습니다.\n다시 시도해 주세요.');
			}
		} finally {
			setLoading(false);
		}
	};

	/*
	const handleLoginWithOtherAccount = async () => {
		if (loading || isAutoLoginInProgress) return;
		setLoading(true);
		try {
			const result = await (AuthService as any).signInWithPrompt?.('select_account') ?? await AuthService.signInInteractive();
			setAuthToken(result.accessToken ?? null);
			try {
				const unwrap = (res: any) => (res && typeof res === 'object' && 'data' in res ? (res as any).data : res);
				const meRes = await apiGet('/api/me/');
				const roomInfoRes = await apiGet('/api/room-info/');
				const me = unwrap(meRes);
				const roomInfo = unwrap(roomInfoRes);
				if (!roomInfo?.ok || !roomInfo?.found) {
					if (roomInfo?.error === 'upgrade_required') {
						Alert.alert(
							'업데이트 필요',
							'사용할 수 없는 앱 버전입니다.\n스토어에서 업데이트 후 사용해 주세요.',
							[
								{ text: '취소', style: 'cancel' },
								{ text: '스토어로 이동', onPress: () => {
									const marketUrl = 'market://details?id=com.smartdoormanager';
									const webUrl = 'https://play.google.com/store/apps/details?id=com.smartdoormanager';
									Linking.openURL(marketUrl).catch(() => Linking.openURL(webUrl));
								} }
							]
						);
						return;
					}
					Alert.alert('권한 없음', '방 정보가 조회되지 않았습니다. 관리자에게 문의하세요.');
					return;
				}
				const user: UserInfo = {
					username: String(roomInfo?.upn || ''),
					name: String(me?.name || ''),
					building: String(roomInfo?.building || ''),
					room: String(roomInfo?.room || ''),
					bleId: roomInfo?.bleId ? String(roomInfo.bleId) : undefined,
				};
				// try { Alert.alert(`환영합니다. ${user.building}동 ${user.room}호 \n ${user.name}님`); } catch {}
				onSuccess(user);
			} catch (callErr: any) {
				Alert.alert('백엔드 호출 실패', callErr?.message ?? '네트워크 오류');
			}
		} catch (e: any) {
			try {
				const raw = String(e?.error || e?.message || '');
				if (/access_denied|cancel/i.test(raw)) {
					Alert.alert('로그인 취소', '로그인이 취소되었습니다.');
					return;
				}
				Alert.alert('로그인 실패', '로그인 중 오류가 발생했습니다. 다시 시도해 주세요.');
			} catch {
				Alert.alert('로그인 실패', '로그인 중 오류가 발생했습니다. 다시 시도해 주세요.');
			}
		} finally {
			setLoading(false);
		}
	};
	*/

	return (
		<View style={styles.container}>
			<StatusBar barStyle="dark-content" backgroundColor={COLORS.backgroundLight} />
			<View style={styles.content}>
				<Image source={require('../../assets/wordmark_logo.jpg')} style={styles.logo} resizeMode="contain" />
				<Text style={styles.title}>UNIST Smart Door</Text>
				<Text style={styles.subtitle}>간편하게 로그인하고 서비스를 이용해보세요.</Text>

				<TouchableOpacity 
					style={[styles.loginButton, (loading || isAutoLoginInProgress) && styles.loginButtonDisabled]} 
					onPress={handleLogin} 
					disabled={loading || isAutoLoginInProgress}
				>
					<View style={styles.loginButtonInner}>
						<Text style={styles.loginButtonText}>
							{isAutoLoginInProgress ? '자동 로그인 중...' : (loading ? '로그인 중...' : '로그인')}
						</Text>
					</View>
				</TouchableOpacity>

				{/*
				<TouchableOpacity 
					style={[styles.loginButton, (loading || isAutoLoginInProgress) && styles.loginButtonDisabled, { marginTop: 12, backgroundColor: '#445968' }]} 
					onPress={handleLoginWithOtherAccount} 
					disabled={loading || isAutoLoginInProgress}
				>
					<View style={styles.loginButtonInner}>
						<Text style={styles.loginButtonText}>
							{isAutoLoginInProgress ? '자동 로그인 중...' : (loading ? '계정 선택...' : '다른 계정으로 로그인')}
						</Text>
					</View>
				</TouchableOpacity>
				*/}
			</View>
		</View>
	);
};

export default AzureLoginScreen;


