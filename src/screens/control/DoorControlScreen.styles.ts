import { StyleSheet, Platform } from 'react-native';

export const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    position: 'relative',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 10 : 10,
    paddingBottom: 15,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(62, 194, 194, 0.2)',
  },

  // Decorative soft shapes at the top
  decorLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
    pointerEvents: 'none',
  },
  decorBlobOne: {
    position: 'absolute',
    top: -50,
    right: -60,
    width: 240,
    height: 240,
    borderRadius: 200,
    backgroundColor: '#E6F6F6',
  },
  decorBlobTwo: {
    position: 'absolute',
    top: 20,
    right: 30,
    width: 160,
    height: 160,
    borderRadius: 140,
    backgroundColor: '#D9F2F2',
  },
  helpButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 26, 83, 0.18)', // 메인 네이비와 어울리는 연한 라인
    backgroundColor: 'rgba(0, 26, 83, 0.04)', // 살짝 네이비 톤 배경으로 통일감
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    alignItems: 'center',
  },
  logo: {
    width: 120,
    height: 40,
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Chip 형태의 연결 상태 표시
  connectionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 9,
    borderWidth: 1,
    backgroundColor: '#E5E7EB',
    borderColor: '#CBD5E1',
    gap: 8,
    minWidth: 160,
  },
  connectionChipOn: {
    backgroundColor: 'rgba(68,193,196,0.12)',
    borderColor: 'rgba(68,193,196,0.35)',
  },
  connectionChipOff: {
    backgroundColor: '#E5E7EB',
    borderColor: '#CBD5E1',
  },
  connectionChipIcon: {
    width: 35,
    height: 35,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionChipSpacer: { width: 30 },
  connectionChipText: {
    flex: 1,
    textAlign: 'right',
    // Android 폰트 기본 패딩 제거로 수직 균형 개선
    includeFontPadding: false as any,
    textAlignVertical: 'center' as any,
    lineHeight: 18,
    paddingBottom: 4,
  },
  connectionChipIconOn: {
    backgroundColor: 'rgba(68,193,196,0.18)',
  },
  connectionChipIconOff: {
    backgroundColor: 'rgba(148,163,184,0.18)',
  },
  // Connection 상태 바
  connectionBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectionBar: {
    width: 130,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#94A3B8',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
  },
  connectionBarOn: {
    backgroundColor: '#22C55E', // green
  },
  connectionBarOff: {
    backgroundColor: '#94A3B8', // gray
  },
  headerRightSpacer: {
    width: 48,
    height: 24,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusDotOn: {
    backgroundColor: '#3EC2C2',
  },
  statusDotOff: {
    backgroundColor: '#6B7280',
  },
  statusText: {
    fontSize: 10,
    color: '#666666',
    fontWeight: '500',
  },
  statusTextOn: {
    color: '#44C1C4',
  },
  statusTextOff: {
    color: '#6B7280',
  },

  content: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  roomSection: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 30,
    paddingVertical: 20,
    alignItems: 'center',
  },
  roomNumberContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-start',
    alignSelf: 'stretch',
    marginBottom: 10,
  },
  roomPrefix: {
    fontSize: 16,
    fontWeight: '600',
    color: '#001A53',
  },
  roomNumber: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#001A53',
  },
  timeInfo: {
    width: '100%',
    marginTop: 10,
    marginBottom: 10,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  timeValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeValueColumn: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  timeLabel: {
    fontSize: 16,
    color: '#001A53',
    fontWeight: '600',
  },
  timeValue: {
    fontSize: 16,
    color: '#334155',
    fontWeight: '400',
  },
  timeSeparator: {
    fontSize: 16,
    color: '#94A3B8',
    marginHorizontal: 4,
  },
  timeSeparatorBlock: {
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
    alignSelf: 'center',
    marginVertical: 2,
  },
  mainButtonSection: {
    paddingHorizontal: 30,
    paddingVertical: 20,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  actionSection: {
    paddingHorizontal: 30,
    paddingVertical: 20,
    backgroundColor: '#F8FAFC',
    gap: 16,
  },
  actionRow: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
    flexDirection: 'row',
    gap: 14,
  },
  actionButton: {
    width: '100%',
    minHeight: 120,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  actionButtonPrimary: {
    backgroundColor: '#001A53',
  },
  actionButtonSecondary: {
    backgroundColor: '#3EC2C2',
  },
  actionCard: {
    flex: 1,
    minHeight: 220,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    paddingVertical: 0,
    paddingHorizontal: 0,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 6,
  },
  actionCardPrimary: {
    backgroundColor: '#001B54',
  },
  cardInnerPrimary: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: 24,
    backgroundColor: '#001B54',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 16,
  },
  actionCardSecondary: {
    backgroundColor: '#44C1C4',
  },
  actionIcon: { marginBottom: 16 },
  actionIconText: {
    fontSize: 32,
    color: '#FFFFFF',
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 액션 카드(도어락/공동현관) 전용 큰 원형 배경 - 방 도어락
  actionIconCirclePrimary: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
  },
  iconCirclePrimary: {
    backgroundColor: '#E9ECFA',
  },
  iconCircleSecondary: {
    backgroundColor: '#DBF3F3',
  },
  iconEmojiPrimary: {
    fontSize: 52,
    color: '#FFFFFF',
    paddingBottom: 4,
  },
  iconEmojiSecondary: {
    fontSize: 26,
    color: '#3CC1BE',
    paddingBottom: 4,
  },
  // 공동현관문 액션 카드 전용 큰 원형 배경 - 문의 카드와 분리
  actionIconCircleEntrance: {
    width: 84,
    height: 84,
    borderRadius: 42,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
  },
  entranceIconEmoji: {
    fontSize: 48,
    color: '#FFFFFF',
    paddingBottom: 8,
  },
  // 컨테이너 비율 기반 아이콘 이미지
  iconImagePrimary: {
    width: '80%',
    height: '80%',
    resizeMode: 'contain',
  },
  entranceIconImage: {
    width: '72%',
    height: '72%',
    resizeMode: 'contain',
  },
  actionText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  cardHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 12,
  },
  cardHeadingOnPrimary: {
    color: '#FFFFFF',
  },
  cardHeadingOnSecondary: {
    color: '#FFFFFF',
  },
  cardCaption: {
    marginTop: 4,
    fontSize: 14,
    color: '#64748B',
  },
  cardCaptionOnPrimary: {
    color: 'rgba(255,255,255,0.9)',
  },
  cardCaptionOnSecondary: {
    color: 'rgba(255,255,255,0.9)',
  },
  actionSubText: {
    marginTop: 4,
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
  },
  cardSubText: {
    marginTop: 6,
    fontSize: 12,
    color: '#7F8C8D',
  },
  instructionWrapper: {
    paddingHorizontal: 30,
    paddingTop: 10,
    marginTop: 20,
    marginBottom: 20,
  },
  instructionText: {
    fontSize: 17,
    color: '#334155',
    textAlign: 'center',
    marginBottom: 3,
  },
  instructionTextKr: {
    fontSize: 15,
    color: '#334155',
    textAlign: 'center',
    opacity: 0.9,
    marginBottom: 3,
  },
  contactSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    backgroundColor: '#F8FAFC',
  },
  contactShadow: {
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 6,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  contactTextWrap: {
    flex: 1,
    marginLeft: 12,
  },
  contactTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  contactSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748B',
  },
  // minimal style: removed status dot styles
  bottomButtons: {
    paddingHorizontal: 30,
    paddingVertical: 20,
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  frontDoorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#3EC2C2',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  buttonIcon: {
    marginRight: 15,
  },
  buttonIconText: {
    fontSize: 20,
  },
  buttonTextContainer: {
    flex: 1,
  },
  bottomButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2C3E50',
  },
  bottomButtonSubText: {
    fontSize: 14,
    fontWeight: '400',
    color: '#7F8C8D',
    marginTop: 2,
  },
  // Debug Log Section
  logSection: {
    backgroundColor: '#F8FAFC',
    marginHorizontal: 20,
    marginVertical: 20,
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  logTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2C3E50',
    marginBottom: 10,
  },
  logActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  logActionBtn: {
    backgroundColor: '#EDF2F7',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  logActionText: {
    fontSize: 12,
    color: '#2C3E50',
    fontWeight: '600',
  },
  bottomPadding: {
    height: 50,
    backgroundColor: '#F8FAFC',
  },
  // Alert와 유사한 모달 스타일
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBox: {
    width: '90%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 0,
    paddingVertical: 20,
    paddingHorizontal: 22,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 16,
    color: '#0F172A',
    lineHeight: 22,
  },
  modalActions: {
    marginTop: 16,
    alignItems: 'flex-end',
  },
  modalActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3EC2C2',
  },
  toast: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderRadius: 10,
    alignItems: 'center',
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
}); 