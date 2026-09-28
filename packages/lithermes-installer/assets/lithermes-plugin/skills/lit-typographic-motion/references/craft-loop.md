# Craft loop, look rounds and done

Both paths share one loop: treatment, author, a stills round you look at, the
film, a last look, then the done-check. A gate PASS alone is never done.

## One loop

1. **Treatment.** `treatment.md`. It is validated before every render.
2. **Author.** Stage: `stage/index.html` (`stage.md`). Type: the brief
   (`engine-contract.md`).
3. **Round 1, stills.** `$M stage --out DIR --stills-only --round 1` or
   `$M run --out DIR --stills-only --round 1`. No encode, no determinism check;
   it writes the stills set below in seconds.
4. **Look.** View the frames, answer the questions, record the round:
   `$M look --out DIR --round 1 --answers FILE`. Round 1 must name the weakest
   beat and the change you made (`change` is required). Make that change.
5. **Film.** `$M stage --out DIR --round 2` (or `run`). This renders every frame,
   the sound, the preview and poster, checks determinism and runs the gate.
6. **Last look.** View the new stills set, answer again, `look --round 2`.
   Another round is due when an answer says so (below); stop after round 3.
7. **Done.** `$M complete --out DIR` exits 0 only when every Done rule holds.

Rounds share one counter with renders: `--round N` on a render, then
`look --round N` on the stills set that render wrote. At most three.

## The stills set

Every render, stills-only or full, rewrites it:

- `stills/beat-NN-fF.png`: the midpoint frame of every beat (stage: the
  treatment's beats; type: every shot);
- `stills/strip-NN-fF.png`: one transition strip per cut, the frames 6 before,
  at and 6 after the cut side by side;
- `sheet/contact.png`: 12 frames spread evenly over the film;
- `poster.png` after a full render;
- `stills/stills.json`: the list, each file's SHA-256, the round, the mode and
  the SHA-256 of the render's `manifest.json`.

The type path also keeps `sheet/cuts.png` (four frames around every cut).

## Viewing pixels

Look with `vision_analyze` (the `vision` toolset), one call per PNG you name.
Only files passed to it count as viewed. OCR output or pixel statistics may be
recorded under `aids`; they never count as viewed. When the plugin's tool hook
is live it records each `vision_analyze` call on a stills file; the done-check
then requires every frame your last round lists to appear there.

If no image tool is reachable in this session, record the round with
`"blocked": "no-vision-tool"`. The done-check then ends with `DONE_UNVIEWED`,
and the reply must say in plain words that nobody viewed the frames.

## The answers file

```text
{
  "viewed": ["stills/beat-01-f90.png", "sheet/contact.png", ...],
  "change": "<round 1: the weakest beat and what you changed>",
  "answers": [
    { "q": 1, "verdict": "yes|no", "by": "blind|self", "stranger": "<the stranger's sentence, verbatim>", "frame": "sheet/contact.png", "observed": "<a concrete visible detail>" },
    { "q": 2, "verdict": "yes|no", "frame": "stills/beat-02-f270.png", "observed": "<...>" }
  ],
  "aids": ["<optional OCR or statistics, never counted as viewed>"]
}
```

`look` refuses a frame that is not in the latest stills set, and an answer
whose `observed` is a bare yes or no: it must be at least one sentence naming a
concrete visible detail in that frame. It stamps the round with the SHA-256 of
the current manifest and of each listed frame. Only `look` writes `look.json`.

## The questions

1. "A stranger would say this film is for: <...>". Ask a fresh `delegate_task`
   subagent that gets only the contact sheet and the beat stills, never the
   request or the treatment. Record its sentence verbatim with `by: blind`, and
   `verdict: yes` when it matches the treatment's subject. Without a subagent,
   answer yourself with `by: self`.
2. Does every beat show its `onScreen` plan?
3. Is the craft at the level `ambition` asks for (transitions, rhythm, depth,
   hierarchy)?
4. Is any request text, meta label, placeholder, file name or internal term on
   screen?
5. Does the ending land?
6. Does the sound follow the cuts? Answer from `sound-cues.json`.
7. Name one thing a skilled motion designer, given only the request, would have
   shown that this film does not (`verdict: named` or `none`). If you can name
   one, revise.
8. Is any element on screen without a job in its beat?
9. Could every copy line be pasted unchanged into a film about a different
   subject? If yes, rewrite the copy from `subject.specifics`.

Another round is required after a "no" on 1, 2, 3, 5 or 6, a "yes" on 4, 8 or
9, or a named Q7. After round 3, deliver with the open items stated plainly.

## Done

`$M complete --out DIR` exits 0 and writes `done.json` only when all hold:

- the gate passed on the final full render;
- `treatment.json` still validates;
- at least 2 look rounds: round 1 on a stills-only set with a `change`, and a
  last round on the final render;
- the last round's manifest SHA-256 equals the final render's;
- the last round viewed the poster, the contact sheet, every beat midpoint and
  every transition strip of that render;
- when the tool hook is live, each of those frames appears in a
  `vision_analyze` call.

It also compares the final treatment with the first valid one and records
`downgraded` when `durationSec` dropped by more than 20 %, fewer beats carry a
subject device, `sound.mode` became `none` without a user request, or `path`
went from stage to type. A downgrade never counts as a fix; the reply names it.

## Reply

The activation line stays exactly where the route puts it. Below it: no second
banner and no emoji. Plain words, no internal names (no path, preset, gate,
beat or treatment jargon). Then:

- one line on the defaults you chose;
- a label on every invention and on a generated sound bed;
- one plain line on what was checked: flash safety, legibility, and that the
  frames were looked at (or that nobody could look at them);
- where the copy lives (the `COPY` object in `stage/index.html`, or
  `brief.json`) and the one command that re-renders;
- any downgrade and any open look item.

## Gates by path

A BLOCKED exit (10, 11, 12, 14, 15) stops the loop at any round; see
`runtime.md`. A flash failure (MO-C-03) withholds every export in `withheld/`
on either path: say the render is withheld pending a fix.

The stage gate is in `stage.md`. The type path gate follows.

## Gate table

Numbers marked provisional are the spec's own proposed defaults; they are
enforced as written and labelled provisional in every report.

| Rule | What fails |
|---|---|
| MO-C-01 | a frame with no look pass that drew |
| MO-C-02 | a software renderer not labelled with samples lowered |
| MO-C-03 | more than 3 general or 3 red flashes in any 1 s window of the master (non-looping) or of the exact preview frames (looping) |
| MO-C-04 | glyph ink outside 96-1824 x 54-1026 |
| MO-C-05 (provisional) | a non-type graphic outside 48-1872 x 27-1053 |
| MO-C-06 (provisional size split) | body type under 4.5:1 or large type under 3:1 at a sampled settled frame |
| MO-C-07/08 (provisional) | a unit under its reading floor, or a line over 17 characters per second |
| MO-C-09 | a cut frame whose fresh-process re-render differs (a hardware-only mismatch that matches under SwiftShader is a warning) |
| MO-C-10/11/12 | under 1920x1080, 30 fps or 3 s; tags other than yuv420p, bt709, tv |
| MO-C-13 (provisional) | preview over 3 MB or poster over 1 MB (MP4 over 100 MB per 10 s only warns) |
| MO-C-14 (provisional) | a reduced-motion still with less than 0.9x the ink of the final text frame |
| MO-C-25 (provisional) | display tracking past -0.04 em, or negative tracking on the machine or body voice |
| MO-C-26 | wrapped lines under the line-height floors |
| MO-C-27 | a Latin paragraph card outside 60-75 characters |
| MO-C-29 (provisional) | a third saturated colour cluster, or the accent in more than one timeline entry or on more than 10% of frames |
| MO-D-02 (provisional) | frame-time p95 over 40 ms (250 ms on software GL); delivers anyway |
| MO-D-03 (provisional) | an empty, near-black run longer than twice the scene's 2-beat floor (plus 1 s at the film's ends) |
| MO-D-04 (provisional) | a codepoint missing from its font; this fails before any frame renders |

The report then lists every other enforced engine rule (encode tags, sampling,
seeds, event ceiling, pass caps, software downgrade, Hangul fonts and tracking,
line breaks, stroke fonts) with PASS or FAIL.

## Report format

`gate-report.txt` opens with the outputs, the preset and why, duration, fps and
resolution, the GLSL passes per shot, and the WebGL2 renderer with its launch
flags. Then `QA gate: PASS|FAIL`, one line per rule in the order of the table
above, the other enforced rules, the craft round (`N / 3 max`), how many frames
`look.json` lists as viewed (a gate rerun keeps that count), the frame egress
path, and the failed rule ids. A
withheld render says so in the outputs line and in its last line.
