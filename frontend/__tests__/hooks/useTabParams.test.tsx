import { renderHook } from '@testing-library/react-native';
import { useTabParam } from '../../hooks/useTabParams';

const mockUseLocalSearchParams = jest.fn<Record<string, string | string[] | undefined>, []>();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

const ALLOWED_TABS = ['overview', 'stats', 'archive'] as const;

describe('useTabParam', () => {
  beforeEach(() => {
    mockUseLocalSearchParams.mockReset().mockReturnValue({});
  });

  it('(+) returns { value, stamp } when scalar string param is in allowed list', () => {
    mockUseLocalSearchParams.mockReturnValue({ tab: 'stats', _t: '1700000001' });

    const { result } = renderHook(() => useTabParam(ALLOWED_TABS));

    expect(result.current).toEqual({ value: 'stats', stamp: '1700000001' });
  });

  it('(+) extracts first element when param and stamp are string arrays, and supports custom param names', () => {
    mockUseLocalSearchParams.mockReturnValue({
      tab: ['archive', 'overview'],
      _t: ['stamp-1', 'stamp-2'],
    });

    const { result } = renderHook(() => useTabParam(ALLOWED_TABS));
    expect(result.current).toEqual({ value: 'archive', stamp: 'stamp-1' });

    mockUseLocalSearchParams.mockReturnValue({ section: 'overview', _t: '42' });
    const { result: customNamed } = renderHook(() => useTabParam(ALLOWED_TABS, 'section'));
    expect(customNamed.current).toEqual({ value: 'overview', stamp: '42' });
  });

  it('(-) returns value: null when param is disallowed, absent, or empty', () => {
    mockUseLocalSearchParams.mockReturnValue({ tab: 'unknown-tab', _t: '77' });
    const { result: disallowed } = renderHook(() => useTabParam(ALLOWED_TABS));
    expect(disallowed.current).toEqual({ value: null, stamp: '77' });

    for (const emptyParams of [
      {},
      { tab: '', _t: '' },
      { tab: [], _t: [] },
      { tab: [''], _t: [''] },
    ]) {
      mockUseLocalSearchParams.mockReturnValue(emptyParams);
      const { result } = renderHook(() => useTabParam(ALLOWED_TABS));
      expect(result.current).toEqual({ value: null, stamp: null });
    }
  });
});
