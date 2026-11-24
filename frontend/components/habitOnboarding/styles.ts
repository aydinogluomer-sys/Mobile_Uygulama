import { StyleSheet } from 'react-native';
import { alphaHex, hexA, type Palette } from '../../lib/tokens';

export const makeStyles = (colors: Palette) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: hexA(colors.black, 0.9), justifyContent: 'flex-end' },
  container: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '92%' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  progressContainer: { flexDirection: 'row', justifyContent: 'center', padding: 16, gap: 8 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  progressDotActive: { backgroundColor: colors.accent, width: 28 },
  content: { flex: 1, padding: 20 },
  stepContent: { flex: 1 },
  stepTitle: { fontSize: 24, fontWeight: 'bold', color: colors.text, marginBottom: 6 },
  stepSubtitle: { fontSize: 14, color: colors.textDim, marginBottom: 24 },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 10 },
  input: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, fontSize: 15,
    color: colors.text, marginBottom: 14, borderWidth: 1, borderColor: colors.border,
  },
  fieldHint: { fontSize: 12, color: colors.warning, marginTop: -8, marginBottom: 12 },
  minsInfo: { fontSize: 12, color: colors.textFaint, marginTop: -6, marginBottom: 6 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  typeCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 16,
    alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  typeCardSelected: { borderColor: colors.accent, backgroundColor: colors.selectedTint },
  typeCardSelectedRed: { borderColor: colors.error, backgroundColor: colors.selectedTintError },
  typeEmoji: { fontSize: 28, marginBottom: 6 },
  typeLabel: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 2 },
  typeDesc: { fontSize: 12, color: colors.textDim, textAlign: 'center' },
  measurableSection: { marginTop: 16 },
  dirBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  dirBtnSelected: { borderColor: colors.accent, backgroundColor: colors.selectedTint },
  dirBtnText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  freqBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12,
    alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  freqBtnSelected: { borderColor: colors.accent, backgroundColor: colors.selectedTint },
  freqBtnText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  freqBtnTextSelected: { color: colors.accent },
  daysRow: { flexDirection: 'row', gap: 6 },
  dayBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 10,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  dayBtnSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  // R01.02-e: same height/hit area as dayBtn; only room for longer labels.
  wideChip: { paddingHorizontal: 4 },
  dayBtnText: { fontSize: 11, color: colors.textDim, fontWeight: '600' },
  dayBtnTextSelected: { color: colors.white },
  partBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  partBtnSelected: { borderColor: colors.accent, backgroundColor: colors.selectedTint },
  partEmoji: { fontSize: 24, marginBottom: 4 },
  partLabel: { fontSize: 12, color: colors.textDim },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  iconBtn: {
    width: 52, height: 52, backgroundColor: colors.surface, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  colorRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  colorDot: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent',
  },
  colorDotSelected: { borderColor: colors.text },
  infoBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: 10, padding: 12, gap: 10, marginBottom: 14,
  },
  infoText: { flex: 1, fontSize: 13, color: colors.textDim },
  costRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  costBtn: {
    width: 44, height: 44, backgroundColor: colors.surface, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  costBtnSelected: { backgroundColor: colors.warning, borderColor: colors.warning },
  costBtnText: { fontSize: 14, fontWeight: '600', color: colors.textDim },
  costBtnTextSelected: { color: colors.white },
  footer: {
    flexDirection: 'row', padding: 20,
    borderTopWidth: 1, borderTopColor: colors.border, gap: 12,
  },
  backButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.border,
  },
  backButtonText: { fontSize: 15, fontWeight: '600', color: colors.text },
  nextButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.accent,
  },
  nextButtonText: { fontSize: 16, fontWeight: '600', color: colors.white },
  submitButton: {
    flex: 1, flexDirection: 'row', paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  submitButtonText: { fontSize: 16, fontWeight: 'bold', color: colors.white },
  buttonDisabled: { opacity: 0.4 },

  wpBand: {
    marginHorizontal: 20, marginTop: 8, backgroundColor: colors.surface,
    borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border,
  },
  wpBandTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  wpBandLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  wpBandLabel: { fontSize: 12, fontWeight: '600' },
  wpBandScore: { fontSize: 13, fontWeight: '700' },
  wpBarBg: { height: 5, backgroundColor: colors.border, borderRadius: 3, marginBottom: 6 },
  wpBarFill: { height: 5, borderRadius: 3 },
  wpBandSub: { fontSize: 11, color: colors.textFaint },

  routingCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: 12, padding: 12, borderWidth: 1, marginTop: 14,
  },
  routingTitle: { fontSize: 14, fontWeight: '700', marginBottom: 3 },
  routingDesc: { fontSize: 12, color: colors.textDim, lineHeight: 16 },

  // Strateji adımı (Step 4)
  impactRow: { flexDirection: 'row', gap: 8 },
  impactCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 12,
    paddingHorizontal: 6, alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  impactDot: { width: 14, height: 14, borderRadius: 7, marginBottom: 8 },
  impactLabel: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 2 },
  impactDesc: { fontSize: 9, color: colors.textDim, textAlign: 'center', lineHeight: 12 },

  matrixHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  matrixCorner: { width: 56 },
  matrixColLabel: { flex: 1, fontSize: 11, color: colors.textDim, textAlign: 'center', fontWeight: '600' },
  matrixRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 8, gap: 8 },
  matrixRowLabel: { width: 56, fontSize: 11, color: colors.textDim, fontWeight: '600', alignSelf: 'center' },
  matrixCell: {
    flex: 1, borderRadius: 10, borderWidth: 1.5, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center', gap: 3,
  },
  matrixEmoji: { fontSize: 18 },
  matrixCellLabel: { fontSize: 11, color: colors.textFaint, fontWeight: '600' },

  triageCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1.5, padding: 14, marginTop: 20,
  },
  triageIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  triageEmoji: { fontSize: 22 },
  triageTitle: { fontSize: 16, fontWeight: '800', marginBottom: 2 },
  triageDesc: { fontSize: 12, color: colors.textDim, marginBottom: 3 },
  triageCost: { fontSize: 11, color: colors.textFaint },

  // İrade maliyeti dökümü (Step 5)
  costBreakdownCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: colors.border, marginTop: 20,
  },
  costHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  costHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  costHeadLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  costBigBadge: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: alphaHex(colors.warning, '22'),
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: alphaHex(colors.warning, '55'),
  },
  costBigText: { fontSize: 22, fontWeight: '800', color: colors.warning },
  costDivider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
  costRowItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  costRowLabel: { fontSize: 13, color: colors.textDim },
  costRowVal: { fontSize: 13, fontWeight: '600', color: colors.text },
  costFormulaLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  costFormulaVal: { fontSize: 13, fontWeight: '700', color: colors.warning },
  costHint: { fontSize: 11, color: colors.textFaint, marginTop: 10, lineHeight: 15 },

  // Tahmini süre (Step 5)
  minsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  minsBtn: {
    backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1, borderColor: colors.border,
  },
  minsBtnSel: { backgroundColor: alphaHex(colors.accent, '20'), borderColor: colors.accent },
  minsBtnText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
  minsBtnTextSel: { color: colors.accent },

  // Bitiş koşulu (Step 3)
  endKindBtn: {
    flex: 1, flexDirection: 'column', alignItems: 'center', gap: 5,
    backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 12,
    borderWidth: 2, borderColor: colors.border,
  },
  endKindBtnSel: { borderColor: colors.accent, backgroundColor: colors.selectedTint },
  endKindText: { fontSize: 12, color: colors.textDim, fontWeight: '600' },
  endHint: { fontSize: 12, color: colors.accent, marginTop: 10, fontWeight: '600' },
  endUnit: { fontSize: 13, color: colors.textDim, marginLeft: 10 },

  // Hatırlatıcı (Step 3)
  reminderHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  remToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 20,
    backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.border,
  },
  remToggleOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  remToggleText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },

  // Çağrışım (Step 3)
  cueChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 160,
    backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: colors.border,
  },
  cueChipSel: { backgroundColor: alphaHex(colors.accent, '20'), borderColor: colors.accent },
  cueChipText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },

  // Özet adımı (Step 7)
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  summaryIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  summaryName: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
  summaryTable: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
  summaryRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryRowLabel: { fontSize: 13, color: colors.textDim },
  summaryRowVal: { fontSize: 13, fontWeight: '700', color: colors.text, maxWidth: '55%', textAlign: 'right' },
  mirrorNoteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, paddingHorizontal: 2 },
  mirrorNoteText: { fontSize: 11, color: colors.textFaint, fontStyle: 'italic', flex: 1 },

  // Yaşam alanı çipleri (Step 1)
  areaHint: { fontSize: 11, color: colors.textFaint, marginTop: -4, marginBottom: 12, lineHeight: 16 },
  areaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  areaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: colors.border,
  },
  areaDot: { width: 9, height: 9, borderRadius: 5 },
  areaChipText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
});

export type HabitOnboardingStyles = ReturnType<typeof makeStyles>;
