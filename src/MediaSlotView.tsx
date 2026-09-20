import { requireNativeView } from 'expo';
import type { StyleProp, ViewStyle } from 'react-native';

import type { ResizeMode } from './types';

export type MediaSlotViewProps = {
  /** The FeedSession's shared object id. Fabric props can't carry the object itself. */
  session: number;
  itemId: string;
  resizeMode: ResizeMode;
  style?: StyleProp<ViewStyle>;
};

/** A surface only. Players are lent to it by the native coordinator. */
export const MediaSlotView = requireNativeView<MediaSlotViewProps>('ExpoInfiniteMedia');
