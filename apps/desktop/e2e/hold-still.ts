/**
 * Every click of the suite waits for its control to have come to rest (not a spec file).
 *
 * What enters the window grows into place: a Project into the sidebar, a card into a list, each on
 * a spring inside a box clipped to its height, so for a moment the control stands in a box with no
 * room, and either WebDriver refuses it (`element not interactable`) or presses what lies beneath
 * it. A spring takes a third of a second at sixty frames a second, and motion counts at most forty
 * milliseconds a frame, so on a runner short of processors, drawing three frames a second, it takes
 * seconds. WebDriverIO retries a refused click for five, which a slow enough run does not leave.
 *
 * So the click asks the page first, frame by frame: is the control where it will stay (its box the
 * same over three frames in a row), and does the middle of it receive the pointer? Only then is it
 * pressed. This is what WebDriverIO's own wait for a control to be clickable does not ask, since it
 * answers at once and the click it lets through can still land on the wrong thing; and no pause or
 * second attempt is involved, only the page's own state.
 */

import { browser } from '@wdio/globals'

/** How long a control is given to come to rest before it is pressed as it is. */
export const REST_WITHIN = 15_000

/** The wait is only said when it was long enough to matter. */
const WORTH_SAYING = 1_000

/** What the page answered about a control. */
interface Rest {
  /** Whether it came to rest in time. */
  readonly rested: boolean
  /** How long it took, in milliseconds. */
  readonly waited: number
  /** Where it stood and what received the pointer in its middle, when it did not rest. */
  readonly last: string
}

/**
 * Runs in the page. Looks at the control on every frame and answers once its box has not moved for
 * three frames and its middle is reached by the pointer, or once `within` milliseconds are gone.
 */
function comesToRest(
  handed: Node | WebdriverIO.Element,
  within: number,
  done: (rest: Rest) => void,
): void {
  // WebDriverIO hands the page the DOM node of an element it was given.
  if (!(handed instanceof HTMLElement))
    return done({ rested: false, waited: 0, last: 'no element' })
  const element = handed
  const started = performance.now()
  let box = ''
  let frames = 0
  /** Where the pointer would land in the middle of the control, and the control's box there. */
  const aim = () => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return { rect, hit, reached: hit !== null && element.contains(hit) }
  }
  const look = (): void => {
    let { rect, hit, reached } = aim()
    if (!reached) {
      // What a click does first: bring the control to the middle of what scrolls. A control under
      // the bottom edge of a thread, behind its composer, is reached only from there.
      element.scrollIntoView({ block: 'center', inline: 'center' })
      ;({ rect, hit, reached } = aim())
    }
    const here = `${rect.left},${rect.top} ${rect.width}x${rect.height}`
    frames = reached && here === box ? frames + 1 : 0
    box = here
    const waited = Math.round(performance.now() - started)
    if (frames >= 3) return done({ rested: true, waited, last: '' })
    if (waited >= within) {
      const received = hit === null ? 'nothing' : hit.tagName.toLowerCase()
      return done({ rested: false, waited, last: `at ${here}, the pointer reaches ${received}` })
    }
    requestAnimationFrame(look)
  }
  look()
}

/** Makes every `click` of the browser wait for its element to come to rest. Once per worker. */
export function holdClicksUntilAtRest(): void {
  browser.overwriteCommand(
    'click',
    async function (this: WebdriverIO.Element, click, options) {
      // The wait for the element to exist that a click makes itself, which happens after this one.
      await this.waitForExist()
      const rest = await browser.executeAsync(comesToRest, this, REST_WITHIN)
      if (!rest.rested || rest.waited >= WORTH_SAYING) {
        const said = rest.rested ? 'came to rest' : 'did not come to rest'
        console.log(`click: ${await this.selector} ${said} after ${rest.waited} ms ${rest.last}`)
      }
      return click(options)
    },
    true,
  )
}
