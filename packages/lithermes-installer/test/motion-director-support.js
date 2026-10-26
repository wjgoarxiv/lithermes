// Valid treatments for tests that need to get past the treatment gate. They use
// fictional subjects; none is a product or release promo.
const fs = require("node:fs");
const path = require("node:path");

function typeTreatment(lines = ["A night harbor in fog", "등불이 하나씩 켜진다"], extra = {}) {
  const d = extra.durationSec ?? 8;
  const quoted = lines.map((line) => `"${line}"`).join(" ");
  return {
    request: `${quoted} 이 문장들로 타이포 영상 만들어줘`,
    genre: "type-led",
    path: "type",
    pathReason: "the supplied words are the whole film",
    style: "swiss-signal",
    register: "rich",
    idea: "밤 항구의 불빛이 한 줄씩 켜지는 호흡으로 읽힌다.",
    audience: "도서관 낭독회 관객",
    channel: "행사장 대형 화면",
    format: "16:9",
    formatReason: "a landscape hall screen",
    durationSec: d,
    beats: lines.map((_, i) => ({ t0: (d / lines.length) * i, t1: (d / lines.length) * (i + 1), purpose: `line ${i + 1}`, onScreen: "the line alone", motion: "word by word", sound: "soft pad" })),
    story: { expect: "the lines read one after another", turn: "the second line answers the first", beat: 1, payoff: "the harbor stays lit after the reading" },
    subject: { name: "밤 항구", source: "user", specifics: ["the supplied lines"] },
    visualDevices: [],
    typePlan: { faces: ["Archivo", "Pretendard"], hierarchy: "one line at a time", maxWordsOnScreen: 6 },
    palette: [{ color: "#101820", role: "night ground" }, { color: "#f2e8cf", role: "type" }, { color: "#e0a84f", role: "lamp accent" }],
    sound: { mode: "score", plan: "a house score under the lines" },
    copy: { source: "user", lines },
    inventions: [],
    ambition: "Each line should land on the pulse and leave a breath before the next.",
    ...extra,
  };
}

function writeTreatment(out, treatment) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "treatment.json"), JSON.stringify(treatment, null, 2));
  return out;
}

// A stage treatment for renderer fixtures: a fictional lighthouse keeper's
// night, 3 beats ("other" arc). Silent by design (the channel plays muted)
// unless a test sets a sound mode.
function stageTreatment({ format = "16:9", durationSec = 4, sound = null, lines = ["등대의 밤", "빛이 돈다", "새벽"], fps, register = "rich" } = {}) {
  const third = durationSec / 3;
  return {
    request: "등대지기의 하룻밤을 보여 주는 짧은 영상 만들어줘",
    genre: "other",
    path: "stage",
    pathReason: "the film draws a lighthouse and its beam",
    style: "swiss-signal",
    register,
    idea: "회전하는 빛줄기 하나가 밤바다의 시간을 잰다.",
    audience: "해양 박물관 관람객",
    channel: sound ? "박물관 전시실 화면" : "박물관 복도 무음 사이니지",
    format,
    formatReason: format === "9:16" ? "a portrait corridor screen" : "a landscape gallery screen",
    durationSec,
    ...(fps ? { fps } : {}),
    beats: [0, 1, 2].map((i) => ({ t0: i * third, t1: (i + 1) * third, purpose: ["opening", "sweep", "dawn"][i], onScreen: ["the tower at dusk", "the beam crossing the water", "the sky turning pale"][i], motion: ["the tower draws in", "the beam rotates", "the colours cross-fade"][i], sound: "none", layout: ["title", "split", "stage"][i], hero: ["the tower draws in", "the beam rotates", "the colours cross-fade"][i], transition: ["cut", "wipe", "end"][i] })),
    story: { expect: "the keeper's night passes quietly", turn: "the beam finds a boat that lost its way", beat: 1, payoff: "the dawn keeps the light the keeper made" },
    protagonist: {
      name: "소금곶 keeper", kind: "character", look: "a small oil-skinned figure beside a tall white tower, lamp scale in hand",
      acts: [
        { beat: 0, action: "the keeper climbs the tower and trims the lamp" },
        { beat: 1, action: "the keeper turns the beam toward the lost boat" },
        { beat: 2, action: "the keeper watches the dawn take the beam" },
      ],
    },
    world: {
      layers: ["the tower and the lamp room in front", "the night sea in the middle", "the sky and the far boats behind"],
      labels: ["lamp room", "beam", "tower", "salt spit", "lost boat", "dawn line"],
      camera: [{ beat: 1, move: "push-in on the beam" }, { beat: 2, move: "crane up into the dawn" }],
    },
    subject: { name: "하얀 등대 '소금곶'", source: "invented", specifics: ["a white tower on a salt spit", "kept by one keeper for sailors", "its beam turns every six seconds"] },
    visualDevices: [{ kind: "illustration", role: "subject", beats: [0, 1, 2] }, { kind: "shape", role: "support", beats: [1] }, { kind: "gradient", role: "texture", beats: [0, 1, 2] }],
    typePlan: { faces: ["Pretendard"], hierarchy: "one caption at a time", maxWordsOnScreen: 5 },
    palette: [{ color: "#0C0E13", role: "night ground" }, { color: "#0F7A82", role: "beam" }, { color: "#E9EBE4", role: "caption" }],
    sound: sound || { mode: "none", plan: "", palette: "" },
    copy: { source: "invented", lines },
    inventions: ["하얀 등대 '소금곶' (invented subject)", "all copy lines"],
    ambition: "The beam's rotation should be the film's clock and every caption should ride it.",
  };
}

module.exports = { typeTreatment, stageTreatment, writeTreatment };
