import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { reportError } from './crashReporting';

export const DIALOG_DEFAULT_CANCEL = 'Vazgeç';
export const DIALOG_DEFAULT_OK = 'Tamam';

export type DialogOption = {
  /** Stable key returned by actionSheet(); never shown. */
  id: string;
  label: string;
  /** Ionicons glyph name; used by the in-app sheet, ignored by the iOS system sheet. */
  icon?: string;
  destructive?: boolean;
  disabled?: boolean;
};

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

export type SheetOptions = {
  title?: string;
  message?: string;
  options: readonly DialogOption[];
  cancelText?: string;
};

/** What <DialogHost/> renders. Exported for the host and for tests only. */
export type DialogRequest =
  | {
      id: number;
      kind: 'confirm';
      title: string;
      message?: string;
      confirmText: string;
      cancelText: string;
      destructive: boolean;
      done: (accepted: boolean) => void;
    }
  | {
      id: number;
      kind: 'notify';
      title: string;
      message?: string;
      okText: string;
      done: () => void;
    }
  | {
      id: number;
      kind: 'sheet';
      title?: string;
      message?: string;
      options: readonly DialogOption[];
      cancelText: string;
      done: (pickedId: string | null) => void;
    };

type ConfirmShape = {
  title: string;
  message?: string;
  confirmText: string;
  cancelText: string;
  destructive: boolean;
};

type BrowserDialogs = {
  confirm?: (message?: string) => boolean;
  alert?: (message?: string) => void;
};

const browser = (): BrowserDialogs => (globalThis as { window?: BrowserDialogs }).window ?? {};
const joinText = (title: string, message?: string): string => (message ? `${title}\n\n${message}` : title);
const prefersSystemSheet = (): boolean =>
  Platform.OS === 'ios' && !('isPad' in Platform && Boolean(Platform.isPad));

let nextId = 1;
let epoch = 0;
let hostCount = 0;
let current: DialogRequest | null = null;
let tail: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
const openKeys = new Map<string, number>();
const openNotices = new Map<string, Promise<void>>();

const emit = (): void => {
  listeners.forEach((l) => l());
};

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCurrentDialog(): DialogRequest | null {
  return current;
}

export function registerDialogHost(): () => void {
  hostCount += 1;
  return () => {
    hostCount = Math.max(0, hostCount - 1);
  };
}

/** Called by <DialogHost/>. Settles the visible request exactly once; a second call (Esc after a press) is a no-op. */
export function settleDialog(req: DialogRequest, value?: boolean | string | null): void {
  if (current !== req) return;
  current = null;
  if (req.kind === 'confirm') req.done(value === true);
  else if (req.kind === 'sheet') req.done(typeof value === 'string' ? value : null);
  else req.done();
  emit();
}

/** Account boundary / tests: cancel what is on screen, skip what is queued, and treat late answers as "no". */
export function dismissAllDialogs(): void {
  epoch += 1;
  openKeys.clear();
  openNotices.clear();
  if (current) settleDialog(current, current.kind === 'sheet' ? null : false);
}

/** Host presentations run one at a time, in call order. Native Alerts are NOT chained (see Alert.js:137). */
function presentOnHost<T>(myEpoch: number, skipped: T, make: (done: (value: T) => void) => DialogRequest): Promise<T> {
  const job = tail.then(() => {
    if (myEpoch !== epoch) return skipped;
    return new Promise<T>((resolve) => {
      current = make(resolve);
      emit();
    });
  });
  tail = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

function confirmOnWeb(o: ConfirmShape, myEpoch: number): Promise<boolean> {
  if (hostCount > 0) {
    return presentOnHost<boolean>(myEpoch, false, (done) => ({
      id: nextId++,
      kind: 'confirm',
      ...o,
      done,
    }));
  }
  const w = browser();
  return Promise.resolve(typeof w.confirm === 'function' ? w.confirm(joinText(o.title, o.message)) : false);
}

function confirmOnNative(o: ConfirmShape): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (yes: boolean) => {
      if (!settled) {
        settled = true;
        resolve(yes);
      }
    };
    Alert.alert(
      o.title,
      o.message,
      [
        { text: o.cancelText, style: 'cancel', onPress: () => finish(false) },
        { text: o.confirmText, style: o.destructive ? 'destructive' : 'default', onPress: () => finish(true) },
      ],
      { cancelable: true, onDismiss: () => finish(false) },
    );
  });
}

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  const o: ConfirmShape = {
    title: opts.title,
    message: opts.message,
    confirmText: opts.confirmText ?? DIALOG_DEFAULT_OK,
    cancelText: opts.cancelText ?? DIALOG_DEFAULT_CANCEL,
    destructive: opts.destructive === true,
  };
  const key = `confirm\u0000${o.title}\u0000${o.message ?? ''}\u0000${o.confirmText}`;
  if (openKeys.has(key)) return Promise.resolve(false); // double tap: the second call is "no"; the action never runs twice
  const myEpoch = epoch;
  openKeys.set(key, myEpoch);
  const asked = Platform.OS === 'web' ? confirmOnWeb(o, myEpoch) : confirmOnNative(o);
  return asked
    .then(
      (yes) => yes && myEpoch === epoch,
      () => false,
    )
    .finally(() => {
      if (openKeys.get(key) === myEpoch) openKeys.delete(key);
    });
}

function noticeOnWeb(title: string, message: string | undefined, okText: string, myEpoch: number): Promise<void> {
  if (hostCount > 0) {
    return presentOnHost<void>(myEpoch, undefined, (done) => ({
      id: nextId++,
      kind: 'notify',
      title,
      message,
      okText,
      done,
    }));
  }
  const w = browser();
  if (typeof w.alert === 'function') w.alert(joinText(title, message));
  return Promise.resolve();
}

function noticeOnNative(title: string, message: string | undefined, okText: string): Promise<void> {
  return new Promise<void>((resolve) => {
    Alert.alert(title, message, [{ text: okText, onPress: () => resolve() }], {
      cancelable: true,
      onDismiss: () => resolve(),
    });
  });
}

export function notify(title: string, message?: string, okText: string = DIALOG_DEFAULT_OK): Promise<void> {
  const key = `${title}\u0000${message ?? ''}`;
  const open = openNotices.get(key);
  if (open) return open; // identical message queued or showing: one dialog, both callers resolve together
  const myEpoch = epoch;
  const shown = (Platform.OS === 'web' ? noticeOnWeb(title, message, okText, myEpoch) : noticeOnNative(title, message, okText))
    .catch(() => undefined)
    .finally(() => {
      if (openNotices.get(key) === shown) openNotices.delete(key);
    });
  openNotices.set(key, shown);
  return shown;
}

function sheetOnIOS(opts: SheetOptions, cancelText: string): Promise<string | null> {
  const labels = [...opts.options.map((x) => x.label), cancelText];
  const indexesOf = (pick: (x: DialogOption) => boolean): number[] =>
    opts.options.flatMap((x, i) => (pick(x) ? [i] : []));
  return new Promise<string | null>((resolve) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: opts.title,
        message: opts.message,
        options: labels,
        cancelButtonIndex: labels.length - 1,
        destructiveButtonIndex: indexesOf((x) => x.destructive === true),
        disabledButtonIndices: indexesOf((x) => x.disabled === true),
      },
      (index) => resolve(index >= 0 && index < opts.options.length ? opts.options[index].id : null),
    );
  });
}

function sheetOnHost(opts: SheetOptions, cancelText: string, myEpoch: number): Promise<string | null> {
  if (hostCount === 0) {
    reportError(new Error('dialog host is not mounted'), 'manual', 'dialog-no-host'); // constant text: never the user's labels
    return Promise.resolve(null);
  }
  return presentOnHost<string | null>(myEpoch, null, (done) => ({
    id: nextId++,
    kind: 'sheet',
    title: opts.title,
    message: opts.message,
    options: opts.options,
    cancelText,
    done,
  }));
}

/** More than three choices, or any menu. Resolves the picked option id, or null on cancel/back/scrim/Esc. */
export function actionSheet(opts: SheetOptions): Promise<string | null> {
  if (opts.options.length === 0) return Promise.resolve(null);
  const cancelText = opts.cancelText ?? DIALOG_DEFAULT_CANCEL;
  const key = `sheet\u0000${opts.title ?? ''}\u0000${opts.options.map((x) => x.id).join(',')}`;
  if (openKeys.has(key)) return Promise.resolve(null);
  const myEpoch = epoch;
  openKeys.set(key, myEpoch);
  const picked = prefersSystemSheet() ? sheetOnIOS(opts, cancelText) : sheetOnHost(opts, cancelText, myEpoch);
  return picked
    .then(
      (id) => (myEpoch === epoch ? id : null),
      () => null,
    )
    .finally(() => {
      if (openKeys.get(key) === myEpoch) openKeys.delete(key);
    });
}
