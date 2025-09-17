export const msalConfig = {
	auth: {
		clientId: 'b157dbcc-ab7d-4f22-84d4-6286abd37c3d',
		authority: 'https://login.microsoftonline.com/e8715ec0-6179-432a-a864-54ea4008adc2/v2.0',
		// Android 디버그/릴리즈가 동일 키인 현재 설정 기준
		// Azure 포털 등록값과 정확히 일치하도록 URL-encoded '='(%3D) 사용
		redirectUri: 'msauth://com.smartdoormanager/baAhzzrZeNjWnN5vOO%2FYQIGgwaY%3D',
	},
};

export const minimalScopes = ['openid','profile'];
export const fullScopes = [
	'openid',
	'profile',
	'email',
	'offline_access',
	'api://b157dbcc-ab7d-4f22-84d4-6286abd37c3d/access_as_user',
];


