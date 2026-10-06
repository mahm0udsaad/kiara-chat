import { useEffect, useMemo, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { radius, spacing, type } from "@/constants/theme";
import { useTheme } from "@/providers/theme-provider";
import type { GeoPoint, TrackingPoint } from "@/types/api";

/**
 * The driver's trail drawn to scale, north up, without a map library.
 *
 * Map tiles need a native module the installed apps do not have, and this has
 * to arrive over the air. So the trail is plain views: each leg a thin bar
 * rotated into place, revealed in order, with the stops pinned on top.
 *
 * Every child is centred in the canvas and moved by a transform. Transforms
 * are physical, while `left`/`right` swap under the app's forced RTL — so this
 * draws the same way round on every phone and in every language.
 */

const HEIGHT = 230;
const PADDING = 28;
/** Below this span (≈ 250 m) the trail would be zoomed into GPS noise. */
const MIN_SPAN_DEG = 0.0025;
/** Bars drawn; a longer trail is thinned evenly, ends kept. */
const MAX_SEGMENTS = 120;

type Projected = { x: number; y: number };

function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => items[Math.round(index * step)]!);
}

function projector(points: GeoPoint[], width: number) {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);
  if (maxLat - minLat < MIN_SPAN_DEG) {
    const mid = (maxLat + minLat) / 2;
    minLat = mid - MIN_SPAN_DEG / 2;
    maxLat = mid + MIN_SPAN_DEG / 2;
  }
  if (maxLng - minLng < MIN_SPAN_DEG) {
    const mid = (maxLng + minLng) / 2;
    minLng = mid - MIN_SPAN_DEG / 2;
    maxLng = mid + MIN_SPAN_DEG / 2;
  }
  // A degree of longitude shrinks with latitude; without this the trail
  // would be stretched sideways.
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = (maxLng - minLng) * kx;
  const spanY = maxLat - minLat;
  const scale = Math.min((width - PADDING * 2) / spanX, (HEIGHT - PADDING * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (HEIGHT - spanY * scale) / 2;
  return (point: GeoPoint): Projected => ({
    x: offsetX + (point.lng - minLng) * kx * scale,
    y: offsetY + (maxLat - point.lat) * scale,
  });
}

/** Absolute, centred, then placed — the only positioning used in here. */
const centred = { position: "absolute" } as const;

function Segment({
  from,
  to,
  index,
  count,
  progress,
  width,
  color,
}: {
  from: Projected;
  to: Projected;
  index: number;
  count: number;
  progress: SharedValue<number>;
  width: number;
  color: string;
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx);
  const midX = (from.x + to.x) / 2 - width / 2;
  const midY = (from.y + to.y) / 2 - HEIGHT / 2;
  const style = useAnimatedStyle(() => {
    const local = Math.min(1, Math.max(0, progress.value * count - index));
    return {
      opacity: local,
      transform: [
        { translateX: midX },
        { translateY: midY },
        { rotate: `${angle}rad` },
        { scaleX: local },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        centred,
        // +1 so neighbouring bars overlap instead of leaving a hairline gap.
        { width: length + 1, height: 4, borderRadius: 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

function Pin({
  at,
  width,
  icon,
  color,
  background,
  label,
}: {
  at: Projected;
  width: number;
  icon: IconName;
  color: string;
  background: string;
  label: string;
}) {
  const { colors } = useTheme();
  const size = 30;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        centred,
        {
          width: size,
          height: size,
          borderRadius: radius.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: background,
          borderWidth: 2,
          borderColor: colors.surface,
          transform: [{ translateX: at.x - width / 2 }, { translateY: at.y - HEIGHT / 2 }],
        },
      ]}
    >
      <IconSymbol name={icon} color={color} size={15} />
    </View>
  );
}

function LiveDot({ at, width, live }: { at: Projected; width: number; live: boolean }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!live || reduceMotion) {
      pulse.set(0);
      return;
    }
    pulse.set(withRepeat(withTiming(1, { duration: 1_600, easing: Easing.out(Easing.quad) }), -1));
    return () => cancelAnimation(pulse);
  }, [live, pulse, reduceMotion]);
  const ring = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - pulse.value),
    transform: [
      { translateX: at.x - width / 2 },
      { translateY: at.y - HEIGHT / 2 },
      { scale: 1 + pulse.value * 1.8 },
    ],
  }));
  const place = { transform: [{ translateX: at.x - width / 2 }, { translateY: at.y - HEIGHT / 2 }] };
  return (
    <>
      <Animated.View
        style={[centred, { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand }, ring]}
      />
      <View
        accessible
        accessibilityLabel="آخر موقع للسائق"
        style={[
          centred,
          {
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: colors.brand,
            borderWidth: 3,
            borderColor: colors.surface,
          },
          place,
        ]}
      />
    </>
  );
}

export function TripPathCanvas({
  points,
  places,
  latest,
  live,
  emptyLabel,
}: {
  points: TrackingPoint[];
  places: { start: GeoPoint | null; specialist: GeoPoint | null; client: GeoPoint | null };
  latest: GeoPoint | null;
  live: boolean;
  emptyLabel: string;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  const trail = useMemo(() => thin(points, MAX_SEGMENTS + 1), [points]);
  const stops = [places.start, places.specialist, places.client, latest].filter(
    (point): point is GeoPoint => Boolean(point),
  );
  const project = useMemo(
    () => (width > 0 && (trail.length || stops.length) ? projector([...trail, ...stops], width) : null),
    // `stops` is rebuilt each render; its members are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, trail, places.start, places.specialist, places.client, latest?.lat, latest?.lng],
  );

  // Draw the trail once when it first appears; later polls just extend it.
  const hasTrail = trail.length > 1;
  useEffect(() => {
    if (!hasTrail || !width) return;
    if (reduceMotion) {
      progress.set(1);
      return;
    }
    progress.set(withTiming(1, { duration: 1_600, easing: Easing.inOut(Easing.cubic) }));
  }, [hasTrail, width, progress, reduceMotion]);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  };

  const projected = project ? trail.map(project) : [];
  const segments = projected.slice(1).map((to, index) => ({ from: projected[index]!, to }));

  return (
    <View
      onLayout={onLayout}
      style={{
        height: HEIGHT,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        overflow: "hidden",
        backgroundColor: colors.surfaceSunken,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {project ? (
        <>
          {segments.map((segment, index) => (
            <Segment
              key={index}
              from={segment.from}
              to={segment.to}
              index={index}
              count={segments.length}
              progress={progress}
              width={width}
              color={colors.brand}
            />
          ))}
          {places.start ? (
            <Pin at={project(places.start)} width={width} icon="car" color={colors.textSecondary} background={colors.surfaceRaised} label="نقطة انطلاق السائق" />
          ) : null}
          {places.specialist ? (
            <Pin at={project(places.specialist)} width={width} icon="sparkles" color={colors.onBrandSoft} background={colors.brandSoft} label="موقع الأخصائية" />
          ) : null}
          {places.client ? (
            <Pin at={project(places.client)} width={width} icon="mappin.and.ellipse" color={colors.onSuccessSoft} background={colors.successSoft} label="موقع العميلة" />
          ) : null}
          {latest ? <LiveDot at={project(latest)} width={width} live={live} /> : null}
        </>
      ) : null}
      {!hasTrail ? (
        <View
          style={{
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
            borderRadius: radius.full,
            backgroundColor: colors.surface,
          }}
        >
          <Text style={{ ...type.caption, color: colors.textSecondary, textAlign: "center" }}>
            {emptyLabel}
          </Text>
        </View>
      ) : null}
      <Text
        style={{
          ...centred,
          ...type.caption,
          color: colors.textTertiary,
          transform: [{ translateX: width / 2 - 18 }, { translateY: -HEIGHT / 2 + 14 }],
        }}
      >
        N ↑
      </Text>
    </View>
  );
}
