import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const LONG = 'Jeff Dean once shifted a bit so hard it ended up on another computer.'
const OTHER = 'Compilers do not warn Jeff Dean. Jeff Dean warns compilers, and they thank him for it.'
const GAP = ' '.repeat(5) + '***' + ' '.repeat(5)
const SPINNER = {
  plugin: 'spinner-facts',
  surface: 'terminal',
  component: 'Spinner',
  requestId: 'main',
  props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
} as const

// Stands in for the engine: answers the facts file and draws the spinner word it is handed.
function engine(on: On, file: string): string[] {
  const words: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('fs.read', () => ({ value: file }))
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    words.push(e.props.word)
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.word}</Text>
  })
  return words
}

test('a ~/ path in factsFile is read from the home folder', { options: { factsFile: '~/my-facts.txt' } }, async ($, on) => {
  mock.env(on, { HOME: '/home/someone' })
  const read: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('fs.read', ($, e) => {
    read.push(e.path)
    return { value: 'Mine.\n' }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(read).toEqual(['/home/someone/my-facts.txt'])
})

test('with no factsFile set, the bundled facts.txt is read', async ($, on) => {
  const read: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('fs.read', ($, e) => {
    read.push(e.path)
    return { value: 'Mine.\n' }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(read).toHaveLength(1)
  expect(read[0]!.endsWith('/facts.txt')).toBe(true)
})

test('by default a short fact is replaced after 60 seconds', async ($, on) => {
  const clock = mock.clock(on)
  const words = engine(on, 'First fact.\nSecond fact.\n')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  await $.ui.mount(SPINNER)
  const first = words.at(-1)
  await clock.advance(59_900)
  expect(words.at(-1)).toBe(first)

  await clock.advance(200)
  expect([first, words.at(-1)].sort()).toEqual(['First fact.', 'Second fact.'])
})

test('a fact that fits replaces the word whole, markdown stripped', async ($, on) => {
  mock.clock(on)
  const words = engine(on, '# a comment\n\nJeff Dean has `binary` readability. (**TRUE**)\n')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  await $.ui.mount(SPINNER)

  expect(words.at(-1)).toBe('Jeff Dean has binary readability. (TRUE)')
})

test('a long fact holds, then scrolls one character per step', { options: { width: 20, speedMs: 100 } }, async ($, on) => {
  const clock = mock.clock(on)
  const words = engine(on, LONG + '\n')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  await $.ui.mount(SPINNER)
  expect(words.at(-1)).toBe(LONG.slice(0, 20))

  await clock.advance(1000)
  expect(words.at(-1)).toBe(LONG.slice(0, 20))

  await clock.advance(800)
  expect(words.at(-1)).toBe(LONG.slice(3, 23))
})

test('the ticker wraps round through the gap', { options: { width: 20, speedMs: 100 } }, async ($, on) => {
  const clock = mock.clock(on)
  const words = engine(on, LONG + '\n')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  await $.ui.mount(SPINNER)
  await clock.advance(1500 + 100 * (LONG.length - 5))

  const word = words.at(-1)!
  expect(word).toHaveLength(20)
  expect(word.startsWith(LONG.slice(-5))).toBe(true)
  expect(word.endsWith('Je')).toBe(true)
})

test('a short fact is replaced after rotateSeconds', { options: { rotateSeconds: 10 } }, async ($, on) => {
  const clock = mock.clock(on)
  const words = engine(on, 'First fact.\nSecond fact.\n')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  await $.ui.mount(SPINNER)
  const first = words.at(-1)
  await clock.advance(9900)
  expect(words.at(-1)).toBe(first)

  await clock.advance(200)
  expect([first, words.at(-1)].sort()).toEqual(['First fact.', 'Second fact.'])
})

test('rotateSeconds 0 keeps a short fact all turn', { options: { rotateSeconds: 0 } }, async ($, on) => {
  const clock = mock.clock(on)
  const words = engine(on, 'First fact.\nSecond fact.\n')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  await $.ui.mount(SPINNER)
  const first = words.at(-1)
  await clock.advance(60_000)

  expect(words.at(-1)).toBe(first)
})

test('after rotateLoops passes the next fact follows the gap in, then holds', { options: { width: 20, speedMs: 100, rotateLoops: 1 } }, async ($, on) => {
  const clock = mock.clock(on)
  const words = engine(on, `${LONG}\n${OTHER}\n`)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  await $.ui.mount(SPINNER)
  const [current, coming] = words.at(-1) === LONG.slice(0, 20) ? [LONG, OTHER] : [OTHER, LONG]
  // Five steps before the fact's end: its tail, the gap, and the next fact arriving behind it.
  await clock.advance(1500 + 100 * (current.length - 5))
  expect(words.at(-1)).toBe(current.slice(-5) + GAP + coming.slice(0, 2))

  // One pass is the fact and its gap: then the next fact stands at the left edge.
  await clock.advance(100 * (5 + GAP.length))
  expect(words.at(-1)).toBe(coming.slice(0, 20))

  await clock.advance(1500)
  expect(words.at(-1)).toBe(coming.slice(0, 20))

  await clock.advance(200)
  expect(words.at(-1)).toBe(coming.slice(2, 22))
})

test('rotateLoops 0 keeps a scrolling fact going round all turn', { options: { width: 20, speedMs: 100, rotateLoops: 0 } }, async ($, on) => {
  const clock = mock.clock(on)
  const words = engine(on, `${LONG}\n${OTHER}\n`)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  await $.ui.mount(SPINNER)
  const current = words.at(-1) === LONG.slice(0, 20) ? LONG : OTHER
  await clock.advance(1500 + 100 * (3 * (current.length + GAP.length) + 3))

  expect(words.at(-1)).toBe(current.slice(3, 23))
})

test('the fact stays when the engine changes its word mid-turn', async ($, on) => {
  mock.clock(on)
  const words = engine(on, 'First fact.\nSecond fact.\n')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  const ui = await $.ui.mount({ ...SPINNER, props: { ...SPINNER.props, word: '' } })
  const first = words.at(-1)
  await ui.redraw({ ...SPINNER.props, word: 'Doing', mode: 'tool-use' })

  expect(words.at(-1)).toBe(first)
})

test('each turn deals the next fact', async ($, on) => {
  mock.clock(on)
  const words = engine(on, 'First fact.\nSecond fact.\n')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  const ui = await $.ui.mount(SPINNER)
  const first = words.at(-1)
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.turn.start({ text: 'again', turnId: 't2' })
  await ui.redraw({ ...SPINNER.props, word: 'Baking' })

  expect([first, words.at(-1)].sort()).toEqual(['First fact.', 'Second fact.'])
})

test('a fact dealt between turns starts from the top when the turn starts', { options: { width: 20 } }, async ($, on) => {
  const clock = mock.clock(on)
  const words = engine(on, LONG + '\n')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  const ui = await $.ui.mount(SPINNER)
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await ui.redraw()
  await clock.advance(5000)
  await $.turn.start({ text: 'again', turnId: 't2' })
  await ui.redraw()

  expect(words.at(-1)).toBe(LONG.slice(0, 20))
})

test('a status message is left alone', async ($, on) => {
  mock.clock(on)
  const words = engine(on, LONG + '\n')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.ui.mount({ ...SPINNER, props: { ...SPINNER.props, message: 'Running tests' } })

  expect(words.at(-1)).toBe('Sauteing')
})

// Mounts the spinner over a one-fact file and answers the word drawn after `ms` of scrolling.
async function drawn($: Parameters<Parameters<typeof test>[1] & {}>[0], on: On, file: string, ms = 0) {
  const clock = mock.clock(on)
  const words = engine(on, file)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.ui.mount(SPINNER)
  if (ms > 0) await clock.advance(ms)
  return words.at(-1)!
}

test('wide characters count two cells', { options: { width: 10 } }, async ($, on) => {
  expect(await drawn($, on, '杰夫迪恩证明了P等于NP\n')).toBe('杰夫迪恩证')
})

test('a wide character that would straddle the edge is left out and padded', { options: { width: 9, speedMs: 100 } }, async ($, on) => {
  // One step in: 'Jeffジェ' takes 8 cells, so 'フ' would straddle the 9th.
  expect(await drawn($, on, 'JJeffジェフ・ディーンはコンパイラに警告しない\n', 1500 + 100)).toBe('Jeffジェ ')
})

test('decomposed accents stay on their letter', { options: { width: 5 } }, async ($, on) => {
  const e = 'e\u0301'
  expect(await drawn($, on, `${e.repeat(8)}\n`)).toBe(e.repeat(5))
})

test('ZWJ sequences, skin tones and flags are one two-cell grapheme each', { options: { width: 7 } }, async ($, on) => {
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
  const thumb = '\u{1F44D}\u{1F3FD}'
  const flag = '\u{1F1EF}\u{1F1F5}'
  expect(await drawn($, on, `${family}a${thumb}${flag}b${family}\n`)).toBe(`${family}a${thumb}${flag}`)
})

test('an emoji asked for with VS16 counts two cells', { options: { width: 4 } }, async ($, on) => {
  // Counted as one cell, 'yo' would fit after it.
  expect(await drawn($, on, 'I\u2764\uFE0Fyou all\n')).toBe('I\u2764\uFE0Fy')
})

test('escapes and bidi controls are stripped, joiners kept', async ($, on) => {
  const file = '\uFEFFred \u001b[31malert\u001b[0m \u202Eevil\u202C \u{1F468}\u200D\u{1F4BB}\n'
  expect(await drawn($, on, file)).toBe('red [31malert[0m evil \u{1F468}\u200D\u{1F4BB}')
})
