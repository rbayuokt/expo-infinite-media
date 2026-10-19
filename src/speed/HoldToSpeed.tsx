import React, { useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import type { SpeedOptions } from '../types';

type Props = {
  options: SpeedOptions;
  onRate: (rate: number, rampMs: number) => void;
  onHeld: (held: boolean) => void;
  children: ReactNode;
};

export function HoldToSpeed({ options, onRate, onHeld, children }: Props) {
  const rate = options.rate ?? 2;
  const holdDelay = options.holdDelay ?? 250;
  const rampMs = options.rampMs ?? 150;

  const gesture = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(holdDelay)
        // A swipe has to stay a swipe, so any real movement cancels the hold.
        .maxDistance(12)
        .shouldCancelWhenOutside(false)
        .onStart(() => {
          onHeld(true);
          onRate(rate, rampMs);
        })
        // Runs for every touch, so `success` separates a real hold from a tap or a swipe.
        .onFinalize((_event, success) => {
          if (!success) return;
          onHeld(false);
          onRate(1, rampMs);
        })
        .runOnJS(true),
    [holdDelay, onHeld, onRate, rate, rampMs]
  );

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.root} collapsable={false}>
        {children}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
