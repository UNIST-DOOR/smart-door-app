import { Platform, NativeModules } from 'react-native';
import { msalConfig, fullScopes } from './msalConfig';
import { authorize, refresh } from 'react-native-app-auth';
import { Buffer } from 'buffer';
import { AuthStorage, StoredTokens } from './AuthStorage';

export type AuthResult = {
	accessToken?: string;
	idToken?: string;
	refreshToken?: string;
	expiresOn?: number;
};

const appAuthConfig = {
	issuer: 'https://login.microsoftonline.com/e8715ec0-6179-432a-a864-54ea4008adc2/v2.0',
	clientId: msalConfig.auth.clientId,
	redirectUrl: Platform.OS === 'android'
		? msalConfig.auth.redirectUri
		: 'msauth.org.reactjs.smartdoormanager://auth',
	scopes: fullScopes,
};

class AuthService {
	public async signInInteractive(): Promise<AuthResult> {
		// iOS: MSAL 네이티브 사용 (공식 권장)
		if (Platform.OS === 'ios' && (NativeModules as any)?.MSALModule?.signInInteractive) {
			try {
				const MSALModule = (NativeModules as any).MSALModule;
				// MSAL iOS 권장 형식: v2.0 제거된 권한 URL
				const authority = msalConfig.auth.authority.replace(/\/v2\.0$/, '');
				// MSAL에서는 OIDC 기본 스코프(openid, profile, offline_access)를 전달하지 않음
				const reserved = new Set(['openid','profile','offline_access']);
				const msalScopes = (fullScopes || []).filter((s) => !reserved.has(s));
				const res = await MSALModule.signInInteractive({
					clientId: msalConfig.auth.clientId,
					redirectUri: 'msauth.org.reactjs.smartdoormanager://auth',
					authority,
					scopes: msalScopes,
				});
				const tokens: AuthResult = {
					accessToken: res?.accessToken,
					idToken: res?.idToken,
					expiresOn: typeof res?.expiresOn === 'number' ? res.expiresOn : undefined,
					refreshToken: 'msal',
				};
				// iOS: accountId를 저장해 silent 시 계정 탐색에 활용
				try { if ((res as any)?.accountId) { (tokens as any).accountId = (res as any).accountId; } } catch {}
				try { await AuthStorage.setTokens(tokens as StoredTokens); } catch {}
				return tokens;
			} catch (e: any) {
				console.error('❌[MSAL] 로그인 실패:', e?.message ?? e);
				throw e;
			}
		}

		const result = await authorize({
			...(appAuthConfig as any),
		});

		try {
			const idToken: string | undefined = (result as any).idToken;
			if (idToken) {
				const parts = idToken.split('.');
				if (parts.length >= 2) {
					const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
					const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
					JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
				}
			}
		} catch {}
		const tokens: AuthResult = {
			accessToken: (result as any).accessToken,
			idToken: (result as any).idToken,
			refreshToken: (result as any).refreshToken,
			expiresOn: (result as any).accessTokenExpirationDate ? new Date((result as any).accessTokenExpirationDate).getTime() : undefined,
		};
		try { await AuthStorage.setTokens(tokens as StoredTokens); } catch {}
		return tokens;
	}

	public async signInWithPrompt(prompt: 'login' | 'select_account'): Promise<AuthResult> {
		const result = await authorize({
			...(appAuthConfig as any),
			additionalParameters: { prompt },
		});

		try {
			const idToken: string | undefined = (result as any).idToken;
			if (idToken) {
				const parts = idToken.split('.');
				if (parts.length >= 2) {
					const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
					const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
					JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
				}
			}
		} catch {}

		const tokens: AuthResult = {
			accessToken: (result as any).accessToken,
			idToken: (result as any).idToken,
			refreshToken: (result as any).refreshToken,
			expiresOn: (result as any).accessTokenExpirationDate ? new Date((result as any).accessTokenExpirationDate).getTime() : undefined,
		};
		try { await AuthStorage.setTokens(tokens as StoredTokens); } catch {}
		return tokens;
	}

	public async refreshTokens(): Promise<AuthResult> {
		// iOS: MSAL 무소음 갱신
		if (Platform.OS === 'ios' && (NativeModules as any)?.MSALModule?.acquireTokenSilent) {
			const MSALModule = (NativeModules as any).MSALModule;
			const authority = msalConfig.auth.authority.replace(/\/v2\.0$/, '');
			// MSAL에서는 OIDC 기본 스코프(openid, profile, offline_access)를 전달하지 않음
			const reserved = new Set(['openid','profile','offline_access']);
			const msalScopes = (fullScopes || []).filter((s) => !reserved.has(s));
			const stored = (await AuthStorage.getTokens()) as StoredTokens | null;
			const res = await MSALModule.acquireTokenSilent({
				clientId: msalConfig.auth.clientId,
				redirectUri: 'msauth.org.reactjs.smartdoormanager://auth',
				authority,
				scopes: msalScopes,
				accountId: (stored as any)?.accountId,
			});
			const tokens: AuthResult = {
				accessToken: res?.accessToken,
				idToken: res?.idToken,
				refreshToken: stored?.refreshToken ?? 'msal',
				expiresOn: typeof res?.expiresOn === 'number' ? res.expiresOn : undefined,
			};
			try { if ((res as any)?.accountId) { (tokens as any).accountId = (res as any).accountId; } } catch {}
			await AuthStorage.setTokens(tokens as StoredTokens);
			return tokens;
		}

		// Android: 기존 refresh 유지
		const stored = await AuthStorage.getTokens();
		if (!stored?.refreshToken) throw new Error('No refresh token');
		const res = await refresh(appAuthConfig as any, { refreshToken: stored.refreshToken } as any);
		const tokens: AuthResult = {
			accessToken: (res as any).accessToken,
			idToken: (res as any).idToken,
			refreshToken: (res as any).refreshToken || stored.refreshToken,
			expiresOn: (res as any).accessTokenExpirationDate ? new Date((res as any).accessTokenExpirationDate).getTime() : undefined,
		};
		await AuthStorage.setTokens(tokens as StoredTokens);
		return tokens;
	}

	public async getStoredTokens(): Promise<AuthResult | null> {
		return (await AuthStorage.getTokens()) as AuthResult | null;
	}

	public async clearStoredTokens(): Promise<void> {
		try {
			if (Platform.OS === 'ios' && (NativeModules as any)?.MSALModule?.signOut) {
				const MSALModule = (NativeModules as any).MSALModule;
				await MSALModule.signOut({});
			}
		} catch {}
		await AuthStorage.clearTokens();
	}

	public getConfig() {
		return {
			clientId: msalConfig.auth.clientId,
			authority: msalConfig.auth.authority,
			redirectUri:
				Platform.OS === 'android'
					? msalConfig.auth.redirectUri
					: 'msauth.org.reactjs.smartdoormanager://auth',
			scopes: fullScopes,
		};
	}
}

export default new AuthService();


