/**
 * R09.06 — the routine generator: a lost answer is said as such, and sending
 * the same prompt again uses the same request id (the server replays the
 * first charge instead of taking a second one). A server answer -- success or
 * a definite refusal -- closes the attempt.
 */
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })) },
    functions: { invoke: jest.fn() },
  },
}));

import { supabase } from '../../lib/supabase';
import { useRoutineStore } from '../../store/routineStore';
import { NO_ANSWER_NOTE } from '../../lib/aiAttempt';
import { EdgeTimeoutError } from '../../lib/edgeCall';

const invoke = supabase.functions.invoke as unknown as jest.Mock;
const sentIds = () => invoke.mock.calls.map((c) => c[1].body.request_id as string);
const offline = () => ({ data: null, error: Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' }) });
const refused = () => ({ data: null, error: Object.assign(new Error('402'), { name: 'FunctionsHttpError', context: { json: async () => ({ error: 'Yetersiz Focus Point.' }) } }) });

beforeEach(() => { invoke.mockReset(); });

it('offline: says the answer was lost; the resend carries the same id', async () => {
  invoke.mockResolvedValueOnce(offline()).mockResolvedValueOnce(offline());
  await useRoutineStore.getState().generateRoutine('Sabah rutini');
  expect(useRoutineStore.getState().generateError).toBe(NO_ANSWER_NOTE);
  await useRoutineStore.getState().generateRoutine('Sabah rutini');
  const [a, b] = sentIds();
  expect(a).toBe(b);
});

it('a timeout is a lost answer too', async () => {
  invoke.mockRejectedValueOnce(new EdgeTimeoutError('AI rutin')).mockResolvedValueOnce(offline());
  await useRoutineStore.getState().generateRoutine('Akşam rutini');
  expect(useRoutineStore.getState().generateError).toBe(NO_ANSWER_NOTE);
  await useRoutineStore.getState().generateRoutine('Akşam rutini');
  const [a, b] = sentIds();
  expect(a).toBe(b);
});

it('a definite refusal from the server closes the attempt: the next tap is a new request', async () => {
  invoke.mockResolvedValueOnce(refused()).mockResolvedValueOnce(refused());
  await useRoutineStore.getState().generateRoutine('Okuma rutini');
  expect(useRoutineStore.getState().generateError).toBe('Yetersiz Focus Point.');
  await useRoutineStore.getState().generateRoutine('Okuma rutini');
  const [a, b] = sentIds();
  expect(a).not.toBe(b);
});

it('an answer closes it; a different prompt is a different request', async () => {
  invoke.mockResolvedValueOnce(offline()).mockResolvedValueOnce({ data: { error: 'Model yanıtı boş.' }, error: null }).mockResolvedValueOnce(offline()).mockResolvedValueOnce(offline());
  await useRoutineStore.getState().generateRoutine('Spor');
  await useRoutineStore.getState().generateRoutine('Spor'); // same id, server answers
  await useRoutineStore.getState().generateRoutine('Spor'); // new attempt
  await useRoutineStore.getState().generateRoutine('Yoga'); // different request
  const [a, b, c, d] = sentIds();
  expect(a).toBe(b);
  expect(c).not.toBe(b);
  expect(d).not.toBe(c);
});
