import MorphingPillTabs from './motion/MorphingPillTabs';

export type Segment<T extends string> = { key: T; label: string };

/**
 * The switcher the three hub tabs (Plan, İçgörüler, Profil) use to pick which
 * surface they are showing — now upgraded with fluid spring-sliding pill motion.
 */
export default function SegmentedTabs<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <MorphingPillTabs
      segments={segments}
      value={value}
      onChange={onChange}
      variant="filled"
      scrollable
    />
  );
}
