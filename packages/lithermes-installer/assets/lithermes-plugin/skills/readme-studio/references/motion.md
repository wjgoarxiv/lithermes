# Local motion recipes

Select the renderer before work. Both recipes belong in a fresh task project with local dependencies and explicit assets; no workspace service, global install or other agent host is needed. Check the installed CLI help, browser/encoder availability and license. Retain the lockfile and source so interruption can resume without replacing validated inputs. Every output name is new; preflight absence and preserve failed outputs.

## Remotion, preferred when eligible

`templates/remotion/` pins Remotion and its CLI at 4.0.526 with React/React DOM 19.3.0. Review the user's eligibility at https://www.remotion.dev/docs/license before rendering; Remotion has its own license, not the product's MIT license. If eligibility is unresolved, record that prerequisite and select the alternative explicitly if suitable. Copy the entire `templates/` tree to a fresh task directory, keeping `cover-settings.json` beside the `remotion/` directory: its composition imports that local editable file. Run commands from the copied `remotion/` subdirectory.

Run `npm ci` inside the copied directory. Place `background.png`, `title-{light|dark}-ink.svg`, `subtitle-{light|dark}-ink.svg`, and `label-{light|dark}-ink.svg` in `public/`. Use the project CLI:

```sh
test ! -e cover-wide-light-v01.mp4 && ./node_modules/.bin/remotion render src/index.tsx WideLight cover-wide-light-v01.mp4 --fps 60
```

The other composition IDs are `WideDark`, `MobileLight`, `MobileDark`. They have 300 frames at 60fps, 1600x800 or 1080x1350. Use `remotion still` at frame 150 for a poster. Supply a verified existing browser path with the pinned CLI's `--browser-executable` option when required; do not weaken the host sandbox if browser launch is blocked. An authorized external local render must be labeled as such. Motion comes from the frame number, with eased entry, held type and matching end state; seeded grain does not flicker.

## HyperFrames, HTML alternative

`templates/hyperframes/` pins the published `hyperframes@0.8.51`, Apache-2.0, requiring Node 22 or newer. Verify release metadata at https://registry.npmjs.org/hyperframes/0.8.51 and its native rendering source at https://github.com/heygen-com/hyperframes/tree/d11907c3255efcf6169c2eb6a5b617284d242a38. Run `npm ci` inside the copy. Put the same asset files in `assets/`. For light or mobile output, set the HTML `data-theme`/`data-layout`, matching metadata dimensions, field and ink together, and retain each variant in a separate project directory containing a single `index.html` and its `index.motion.json`. Several root composition HTML files in one project fail the pinned linter.

```sh
./node_modules/.bin/hyperframes check . --samples 60 --no-contrast --json
test ! -e cover-v01.mp4 && ./node_modules/.bin/hyperframes render . -c index.html --fps 60 --workers 1 --output cover-v01.mp4
```

The positional argument is the project directory; `-c` selects its HTML. Use one worker and inspect the bottom edge in decoded frames. `data-no-timeline` is intentional for finite CSS animation, not a way to hide a missing scripted timeline. Preserve composition ID, five-second duration, start and dimensions, plus the `index.motion.json` descendant motion assertion. Keep reduced-motion media rules in the delivery preview; the master timeline must be seekable regardless of browser preference. Confirm the CLI's local telemetry controls before use. If check/render fails, record `MOTION_RENDER_BLOCKED`, retain source and report the failure; do not change engines silently.

## Inspect and integrate

Render all claimed variants. Verify codec, dimensions, 60fps, 300 frames and five seconds using ffprobe or equivalent engine output plus decoded frame inspection. Inspect frames 0, 150 and 299, typography contrast, crop and first/last seam. The first frame conveys identity; a short eased entry settles into readable hold. Keep blur behind content, restrained light depth and seeded/static grain.

Encode an inline preview separately. A useful starting GIF profile is 6fps, 560x280 wide or 384x480 mobile, no more than 64 colors, 30 frames per five seconds. This is a size starting point, not a guaranteed quality result. Target <=2.5 MiB per animation. If too large, try one deliberate optimization and inspect readability; retain any oversized candidate and state `INLINE_PREVIEW_SIZE_BLOCKED` if no acceptable delivery fits. Animated WebP requires its own renderer support check; a successful GIF is not proof of WebP support.

Use static reduced-motion sources before animated `<picture>` sources, ending in a static `<img>`. Include a normal link to a master. Inspect local light/dark/mobile/reduced-motion behavior at 320/390/1440 CSS pixels. Keep exact local tool/render receipts; do not claim actual GitHub/npm playback or their motion settings from an emulation. Those are separate `POST_PUBLICATION_UNVERIFIED` gates. The README and source remain useful when motion cannot play.
