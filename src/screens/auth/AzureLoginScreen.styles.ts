import { StyleSheet } from 'react-native';

// Color palette
export const COLORS = {
	backgroundDark: '#001A53',
	backgroundLight: '#FFFFFF',
	accent: '#3EC2C2',
	textOnDark: '#FFFFFF',
	textOnLight: '#111111',
};

export const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: COLORS.backgroundLight,
		justifyContent: 'center',
		alignItems: 'center',
		paddingHorizontal: 24,
	},
	content: {
		width: '100%',
		maxWidth: 420,
		alignItems: 'center',
	},
	logo: {
		width: '100%',
		height: 125,
		marginTop: -12,
		marginBottom: 28,
	},
	title: {
		fontSize: 24,
		fontWeight: '700',
		color: COLORS.textOnLight,
		textAlign: 'center',
		marginTop: 24,
		marginBottom: 8,
	},
	subtitle: {
		fontSize: 13,
		color: '#6B7280',
		textAlign: 'center',
		marginBottom: 28,
	},
	loginButton: {
		width: '100%',
		maxWidth: 420,
		backgroundColor: COLORS.accent,
		borderRadius: 10,
		paddingVertical: 14,
		paddingHorizontal: 16,
		alignItems: 'center',
		justifyContent: 'center',
		shadowColor: '#000',
		shadowOpacity: 0.05,
		shadowRadius: 6,
		elevation: 2,
	},
	loginButtonDisabled: {
		opacity: 0.7,
	},
	loginButtonInner: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
	},
	loginButtonIconWrap: {
		width: 24,
		height: 24,
		borderRadius: 12,
		backgroundColor: COLORS.backgroundDark,
		alignItems: 'center',
		justifyContent: 'center',
		marginRight: 8,
	},
	loginButtonText: {
		color: COLORS.textOnDark,
		fontSize: 16,
		fontWeight: '700',
	},
	help: {
		marginTop: 16,
		fontSize: 12,
		color: '#9CA3AF',
		textAlign: 'center',
	},
});


