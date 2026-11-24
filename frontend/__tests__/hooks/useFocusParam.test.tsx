import { act, renderHook } from '@testing-library/react-native';
import { useFocusParam } from '../../hooks/useFocusParam';

const mockSetParams = jest.fn<void, [Record<string, unknown>]>();
const mockUseRouter = jest.fn<Record<string, unknown>, []>();
const mockUseLocalSearchParams = jest.fn<{ focus?: string | string[] }, []>();

jest.mock('expo-router', () => ({
  useRouter: () => mockUseRouter(),
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

describe('useFocusParam', () => {
  beforeEach(() => {
    mockSetParams.mockReset();
    mockUseRouter.mockReset().mockReturnValue({ setParams: mockSetParams });
    mockUseLocalSearchParams.mockReset().mockReturnValue({});
  });

  it('(+) extracts trimmed id from scalar string focus search param', () => {
    mockUseLocalSearchParams.mockReturnValue({ focus: '  habit-42  ' });

    const { result } = renderHook(() => useFocusParam());

    expect(result.current.id).toBe('habit-42');
  });

  it('(+) extracts trimmed id from first element of string-array focus search param', () => {
    mockUseLocalSearchParams.mockReturnValue({ focus: ['  task-99 ', 'task-100'] });

    const { result } = renderHook(() => useFocusParam());

    expect(result.current.id).toBe('task-99');
  });

  it('(-) returns null when focus param is absent, empty, or whitespace-only', () => {
    for (const params of [
      {},
      { focus: '' },
      { focus: '   \t  ' },
      { focus: [] },
      { focus: ['   ', 'fallback-ignored'] },
    ]) {
      mockUseLocalSearchParams.mockReturnValue(params);
      const { result } = renderHook(() => useFocusParam());
      expect(result.current.id).toBeNull();
    }
  });

  it('(+) consume() clears focus param via router.setParams({ focus: undefined }) and safely guards missing setParams', () => {
    mockUseLocalSearchParams.mockReturnValue({ focus: 'note-7' });
    const { result } = renderHook(() => useFocusParam());

    act(() => {
      result.current.consume();
    });

    expect(mockSetParams).toHaveBeenCalledTimes(1);
    expect(mockSetParams).toHaveBeenCalledWith({ focus: undefined });

    mockUseRouter.mockReturnValue({});
    const { result: withoutSetParams } = renderHook(() => useFocusParam());

    expect(() => {
      act(() => {
        withoutSetParams.current.consume();
      });
    }).not.toThrow();
  });
});
