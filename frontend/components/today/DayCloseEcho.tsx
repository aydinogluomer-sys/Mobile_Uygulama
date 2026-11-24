import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useThemedStyles } from '../../hooks/useThemeColors';
import { accountEpoch } from '../../lib/accountScope';
import { dayCloseEchoLine, loadDayClose, type DayCloseRecord } from '../../lib/dayClose';
import { currentUser } from '../../lib/session';
import { font, space, type Palette } from '../../lib/tokens';

export type DayCloseEchoProps = {
  record?: DayCloseRecord | null;
  now?: Date;
};

export default function DayCloseEcho(props: DayCloseEchoProps = {}): React.JSX.Element | null {
  const s = useThemedStyles(makeStyles);
  const { record, now } = props;
  const hasExplicitRecord = record !== undefined;

  const [loadedLine, setLoadedLine] = useState<string | null>(null);

  useEffect(() => {
    if (hasExplicitRecord) return;
    let alive = true;
    const epoch = accountEpoch();

    void (async () => {
      const user = await currentUser();
      if (!alive || epoch !== accountEpoch() || !user?.id) {
        if (alive && epoch === accountEpoch()) {
          setLoadedLine((prev) => (prev === null ? prev : null));
        }
        return;
      }
      const saved = await loadDayClose(user.id);
      if (!alive || epoch !== accountEpoch()) return;
      const computed = dayCloseEchoLine(saved, new Date());
      setLoadedLine((prev) => (prev === computed ? prev : computed));
    })();

    return () => {
      alive = false;
    };
  }, [hasExplicitRecord]);

  const line = hasExplicitRecord
    ? dayCloseEchoLine(record ?? null, now ?? new Date())
    : loadedLine;

  if (!line) return null;

  return (
    <Text style={s.echo} accessibilityRole="text">
      {line}
    </Text>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    echo: {
      ...font.caption,
      color: c.textDim,
      marginTop: space.xs,
    },
  });
