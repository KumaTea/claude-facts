import type { Register, Timer } from 'claude-code'

// What scrolls past between the end of a fact and its start coming round again.
const GAP = '     ***     '
// How long a long fact stands still, showing its start, before it scrolls.
const HOLD_MS = 1500
// Room the spinner line keeps for its glyph, the ellipsis and `(1m 4s · ↓ 2.1k tokens · thinking)`.
const RESERVED_COLUMNS = 50
const MIN_WIDTH = 20

// Control and format characters (escapes, bidi overrides, a BOM) could leak past a cut window; joiners stay.
const STRAY = /(?![\u200C\u200D\u{E0020}-\u{E007F}])[\p{Cc}\p{Cf}]/gu
// What draws two cells whatever its first code point: emoji, flags, a pictograph asked for as emoji.
const EMOJI = /\p{Emoji_Presentation}|\p{Regional_Indicator}|\p{Extended_Pictographic}\uFE0F/u
// What hangs on the character before it: marks, joiners, variation selectors, tag characters.
const ATTACHED = /^[\p{M}\u200C\u200D\uFE00-\uFE0F\u{E0020}-\u{E007F}]/u
const SINGLE_FLAG_HALF = /^\p{Regional_Indicator}$/u

const segmenter = typeof Intl === 'object' && 'Segmenter' in Intl ? new Intl.Segmenter() : undefined

// A spinner's fact, when it started (its hold included), and the fact dealt to follow it once the ticker shows it coming.
type Shown = { fact: string; since: number; next?: string }

// One fact per line; markdown emphasis and code ticks would show literally on the spinner.
function parseFacts(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').replace(STRAY, '').trim())
    .filter(line => line !== '' && !line.startsWith('#'))
}

// What the eye reads as one character, so the window never cuts an accent, a flag or a ZWJ emoji in two.
function graphemes(text: string): string[] {
  if (segmenter !== undefined) {
    return Array.from(segmenter.segment(text), part => part.segment)
  }
  const clusters: string[] = []
  for (const char of text) {
    const last = clusters.at(-1)
    const isJoined =
      last !== undefined &&
      (ATTACHED.test(char) || last.endsWith('\u200D') || (SINGLE_FLAG_HALF.test(last) && SINGLE_FLAG_HALF.test(char)))
    if (isJoined) clusters[clusters.length - 1] += char
    else clusters.push(char)
  }
  return clusters
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = items[i]!
    items[i] = items[j]!
    items[j] = swap
  }
  return items
}

// Cells a grapheme takes in the terminal: two for CJK, kana, Hangul, fullwidth forms and emoji.
function cellWidth(cluster: string): number {
  if (EMOJI.test(cluster)) return 2
  const code = cluster.codePointAt(0) ?? 0
  const isWide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6b) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1b000 && code <= 0x1b2ff) ||
    (code >= 0x1f200 && code <= 0x1f2ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  return isWide ? 2 : 1
}

function widthOf(text: string): number {
  return graphemes(text).reduce((sum, cluster) => sum + cellWidth(cluster), 0)
}

// Steps one time round the ticker: the fact, then the gap.
function passLength(fact: string): number {
  return graphemes(fact).length + graphemes(GAP).length
}

// The `width` cells of a ticker running `fact` round and round, after `step` graphemes have scrolled off its
// left edge. With `then`, the fact goes round `passes` times and the next fact follows the last gap in.
function marquee(fact: string, width: number, step: number, then?: { fact: string; passes: number }): string {
  const loop = [...graphemes(fact), ...graphemes(GAP)]
  const end = then === undefined ? Infinity : then.passes * loop.length
  const after = then === undefined ? [] : [...graphemes(then.fact), ...graphemes(GAP)]
  let text = ''
  let used = 0
  for (let at = step; used < width; at++) {
    const cluster = at < end ? loop[at % loop.length]! : (after[at - end] ?? ' ')
    if (used + cellWidth(cluster) > width) break
    text += cluster
    used += cellWidth(cluster)
  }
  // A wide character that did not fit leaves a cell; pad it so the line never jitters.
  return text + ' '.repeat(width - used)
}

export const register: Register = (on, options) => {
  const factsFile = String(options.factsFile ?? '')
  const fixedWidth = Number(options.width) || 0
  const speedMs = Math.max(100, Number(options.speedMs) || 150)
  const rotateMs = Math.max(0, Number(options.rotateSeconds) || 0) * 1000
  const rotateLoops = Math.max(0, Math.floor(Number(options.rotateLoops) || 0))

  let facts: string[] = []
  let deck: string[] = []
  // Per spinner instance (the main loop's, a subagent's). The engine's own word can change mid-turn (empty,
  // then `Doing`), so facts follow the rotate options and the turn, never the word.
  const shown = new Map<string, Shown>()
  let ticker: Timer | undefined
  // What the ticker redraws for: every step while a fact scrolls, else once a short fact is due to change.
  let isScrolling = false
  let changesAt = Infinity

  // Deals from a shuffled deck, so every fact shows once before any repeats.
  function deal(): string {
    if (deck.length === 0) deck = shuffle([...facts])
    return deck.pop()!
  }

  // Moves on to the next fact once a short one has shown for `rotateSeconds`, or a scrolling one has gone
  // round `rotateLoops` times. The next starts where that time ran out, so a late redraw keeps the pace.
  function rotate(current: Shown, now: number, width: number): void {
    const doesScroll = widthOf(current.fact) > width
    const span = !doesScroll ? rotateMs : rotateLoops === 0 ? 0 : HOLD_MS + rotateLoops * passLength(current.fact) * speedMs
    if (span === 0 || now - current.since < span) return
    // Long overdue (the spinner was not drawn for a while): start the next fact now, not part way through.
    current.since = now - current.since < 2 * span ? current.since + span : now
    current.fact = current.next ?? deal()
    current.next = undefined
  }

  on('session.start', async ($, e, next) => {
    let path = factsFile || `${$.plugin.root}/facts.txt`
    if (path.startsWith('~/')) {
      path = `${(await $.env.get('HOME')) ?? '~'}${path.slice(1)}`
    }
    try {
      facts = parseFacts(await $.fs.read(path))
    } catch {
      facts = []
    }
    if (facts.length === 0) {
      $.ui.toast(`spinner-facts: no facts in ${path}; keeping the usual spinner words`)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      // The spinner draws once more after a turn completes, dealing the next fact early: start it from the top now.
      const now = await $.clock.now()
      for (const current of shown.values()) current.since = now
      ticker ??= $.clock.every(speedMs, async () => {
        if (isScrolling || (changesAt !== Infinity && (await $.clock.now()) >= changesAt)) {
          $.ui.invalidate('ui.render')
        }
      })
    }
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      ticker?.cancel()
      ticker = undefined
      isScrolling = false
      changesAt = Infinity
      // A fact the ticker had started to bring in goes back on top of the deck, to open a later turn.
      for (const current of shown.values()) {
        if (current.next !== undefined) deck.push(current.next)
      }
      shown.clear()
    }
    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    // `message` is a state's own text (a todo's "Running tests", "Compacting conversation"): worth keeping.
    if (e.surface !== 'terminal' || e.props.message !== null || facts.length === 0) {
      return next(e)
    }

    const now = await $.clock.now()
    let current = shown.get(e.requestId)
    if (current === undefined) {
      current = { fact: deal(), since: now }
      shown.set(e.requestId, current)
    }

    const width = fixedWidth || Math.max(MIN_WIDTH, (e.viewport?.columns ?? 110) - RESERVED_COLUMNS)
    rotate(current, now, width)
    isScrolling = widthOf(current.fact) > width
    changesAt = !isScrolling && rotateMs > 0 ? current.since + rotateMs : Infinity
    if (!isScrolling) {
      return next({ ...e, props: { ...e.props, word: current.fact } })
    }

    const step = Math.floor(Math.max(0, now - current.since - HOLD_MS) / speedMs)
    // On its last pass the fact's window reaches past its final gap: deal the fact that comes in there.
    const isLastPass = rotateLoops > 0 && step + width >= rotateLoops * passLength(current.fact)
    const then = isLastPass ? { fact: (current.next ??= deal()), passes: rotateLoops } : undefined
    const word = marquee(current.fact, width, step, then)

    return next({ ...e, props: { ...e.props, word } })
  })
}
