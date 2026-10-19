# Changelog

## 0.2.0

### Added

- **Hold to speed up.** `speed` makes holding anywhere on the feed play faster and
  releasing go back, with both changes eased in native code rather than jumping. Options
  cover the rate, the hold delay, the ramp, and the indicator, which can be restyled or
  replaced. See [Hold to speed up](README.md#hold-to-speed-up).
- `setRate(rate, rampMs?)` on the feed ref, and an `onRateChange` event.

### Fixed

- **Scrolling back no longer starts cold.** The post behind the current one keeps a
  prepared player on mid tier devices, not only high tier, which is what caused a spinner
  when swiping up.
- **The next post keeps its player on every tier.** It used to fall back to bytes only
  whenever the device was low tier, so budget phones started every forward swipe from
  scratch. Only a fling, a starving buffer, memory pressure or a metered connection do that
  now.
- **Android no longer misreads capable devices as low tier.** A 192 MB heap limit alone was
  enough to be classified low, which cost 4 GB devices their prepared player.
- **Android reported playback state for the wrong post.** States from a prepared next post
  were sent to JS as if they described the post on screen, and a session wide dedupe
  dropped real transitions when two posts hit the same state in a row. The practical effect
  was a loading spinner that stayed on screen while the video played fine. iOS was already
  correct.
- **Android poster to video now crossfades** over 120 ms, matching iOS, instead of cutting.
- **`preload()` warms posters on Android.** It cached video bytes and left the poster cold,
  so a preloaded post still opened on a black frame. iOS already did this.

### Changed

- Mid and high tier devices now hold up to three players, previous, current and next. Low
  tier stays at two. The benchmark tables in the README predate this.

## 0.1.0

First public release. A native paged media feed for Expo and React Native CLI, with pooled
players, preload priorities, bounded caches and a built in seek bar. AVFoundation on iOS,
Media3 on Android.
