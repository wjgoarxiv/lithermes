# README artwork

The outlined ASCII mark preserves the copyable LitHermes banner. Its glyph paths
use JetBrains Mono; the original [SIL Open Font License notice](./JetBrainsMono-OFL.txt)
is retained alongside the SVG. The Ignition poster,
MP4 film, and animated GIF are original LitFamily artwork, covered by the repository's
[MIT license](../../../LICENSE).

The two local [Shields](https://shields.io/) badges describe the source candidate and
MIT license. They do not query npm or claim a published release or passing CI. The
candidate badge uses dark lettering on orange for readable contrast.

The navigation uses these three Lucide icons, with their strokes changed to Ignition
lime. Their geometry comes from the pinned upstream revision:

- [book-open](https://github.com/lucide-icons/lucide/blob/2bfb9bb1bae5d74f6a9f81640ddd8bccc2c71860/icons/book-open.svg)
- [play](https://github.com/lucide-icons/lucide/blob/2bfb9bb1bae5d74f6a9f81640ddd8bccc2c71860/icons/play.svg)
- [shield-check](https://github.com/lucide-icons/lucide/blob/2bfb9bb1bae5d74f6a9f81640ddd8bccc2c71860/icons/shield-check.svg)

The complete upstream [Lucide and Feather license notices](./Lucide-LICENSE.txt)
accompany the icons. These documentation assets are outside the installer package.

The current landing pages open with one motion cover: the five armory robot panels power
on in turn, the LitHermes robot wakes, then LITFAMILY and KEEP THE WORK LIT. light up.
`../cover-motion.webp` is the 960×640 looping animated WebP (1,787,274 bytes, SHA-256
`83f0361043b21e5aba1fdbc34737efc55f329eb36f76db6cddc6d40ad87301c7`), and
`../cover-motion-still.webp` is its fully lit hold frame, served when reduced motion is
preferred (116,970 bytes, SHA-256
`8f9165e78ae6789242b4f49f47dc741ffaad23195d528260536e04ad14fe981b`). The package copies
under `readme-assets/` are byte-identical.

The earlier static v5 armory WebP stays at `../cover.webp` (SHA-256
`c125a3ff2ebe1a62535bd159b9a8b277f72002a6bb95ea22015a4f8849a4e3ea`), but the landing pages
no longer show it and the npm package no longer ships a copy. The retained `cover.svg` remains the editable, low-bandwidth vector
fallback. These WebPs are local candidate assets, not proof of npm or GitHub availability.
