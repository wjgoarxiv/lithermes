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

## Jev screenshots

`../jev/` holds the terminal pictures in the Jev section of the landing pages, each in a dark and a light version at twice the display size. They are rendered from the text LitHermes prints, with each real output captured from the plugin's own code and `hermes lithermes` commands in a scratch Hermes home; the captions on the pages say which is which. The terminal type is MesloLGS NF (Apache License 2.0) and the window labels use Pretendard (SIL Open Font License 1.1). Only the rendered pictures are kept, so the repository carries no font files for them. The folder sits outside the installer package.

## Motion promo

`../promo/` holds two 23 second films about LitHermes, one with English lines (`promo.mp4`) and one with Korean lines (`promo-ko.mp4`). Each is 1920×1080 at 60 fps with a generated music bed (3,163,030 and 3,097,939 bytes). The silent looping previews shown on the landing pages are 960×540 at 30 fps (`promo-preview.webp`, 1,131,232 bytes, and `promo-preview-ko.webp`, 1,087,636 bytes). Each film also has a poster, which is its terminal frame, and a reduced-motion still, which is its closing frame; the previews, posters and stills are all WebP. The films were written as a treatment first, drawn as a web page and captured frame by frame. The two pages and their treatments sit in `../promo/source/`, with the copy in a `COPY` object at the top of each page; to render one again, place its page as `stage/index.html` and its treatment as `treatment.json` in an empty folder and run the stage command of the lit-typographic-motion skill on that folder. The display and body type is Pretendard (SIL Open Font License 1.1, notice in `../promo/source/Pretendard-OFL.txt`) and the terminal text is MesloLGS NF (Apache License 2.0), both rendered into the pictures, so the repository carries no font files for them. Everything is original LitFamily artwork under the repository's [MIT license](../../../LICENSE). The films sit outside the installer package and the npm card does not embed them.

## Terminal screens

`../screens/` holds the five terminal pictures in the "What you will see on your first run" subsection of the landing pages, each in a dark and a light version at twice the display size. The install, doctor, start-and-stop and update-notice pictures are captured from the installer and from Hermes running in a scratch Hermes home, and the acknowledgement picture is built from the output of the plugin's own acknowledgement code; the captions on the pages say which is which. The terminal type is MesloLGS NF (Apache License 2.0) and the window labels use Pretendard (SIL Open Font License 1.1). Only the rendered pictures are kept, so the repository carries no font files for them. The folder sits outside the installer package.
