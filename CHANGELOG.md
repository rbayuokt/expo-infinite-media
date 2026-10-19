# Changelog

## 0.3.0

### Added

- **Web support.** The same import now resolves to a browser build with the same props,
  the same ref and the same callbacks. Paging is CSS scroll snap with an
  `IntersectionObserver` reporting the current page, so no scroll handler runs in JS.
  See [Web](README.md#web).
- **Three `<video>` elements serve a list of any length** on the web, current, next and
  previous, the same window the native policy keeps warm. Pages outside it hold nothing.
- **The seek bar and hold to speed up work in a browser.** The bar is a DOM bar driven by
  `requestAnimationFrame`, since Reanimated's frame callback does not run on the web, and
  holding uses pointer events. Both read the same options as on a phone.
- **`diagnostics` emits `onMetrics` on the web** every 2 s, with startup times, rebuffers,
  the decoder's dropped frames and the player counts. Byte and disk fields stay at zero.
- Benchmarks for Chrome, cold and warm, alongside the two phones.

### Changed

- `preload()` warms posters on the web. `clearCache`, `removeFromCache` and `getCacheSize`
  resolve without doing anything, because a page cannot reach the browser's HTTP cache.
- Calls no longer throw `UNSUPPORTED_PLATFORM` on the web.

### Notes

- Per item `headers` are ignored on the web. A `<video src>` cannot carry them, so use
  signed URLs or a query token.
- Sound needs one gesture. Browsers refuse to autoplay with sound, so the feed falls back
  to a muted start and turns the sound on at the first pointer down.
- A phone sized feed in a desktop window wants a column. That is a style, not a prop, and
  the README shows it.

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
