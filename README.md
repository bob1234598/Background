# Background — Minimal New Tab

A Chrome extension (Manifest V3) that replaces the new tab page with a calm, minimal dashboard:

- Slowly moving near-black → midnight-blue gradient with a faint drifting glow
- Large thin clock, full date and a time-of-day greeting
- Frosted-glass **Today** (Google Calendar) and **Tasks** (Google Tasks) cards
- A **✦ Muse** input bar at the bottom that sends your message to muse.ai in a popup

Plain HTML, CSS and JavaScript. No build step, no frameworks.

## Files

| File            | Purpose                                         |
| --------------- | ----------------------------------------------- |
| `manifest.json` | Extension manifest; overrides the new tab page  |
| `newtab.html`   | Page markup                                     |
| `styles.css`    | Background animation, glass styles, layout      |
| `clock.js`      | Clock, date and greeting                        |
| `store.js`      | Safe wrapper around `chrome.storage.local`      |
| `google.js`     | Google sign-in (`getAuthToken`) and API requests |
| `calendar.js`   | Today card: Google Calendar events, cached      |
| `tasks.js`      | Tasks card: Google Tasks lists, complete & add, cached |
| `muse.js`       | Muse integration: popup window + clipboard      |
| `chat.js`       | Muse input bar UI                               |

## Load it unpacked

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (toggle in the top-right).
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Open a new tab. If Chrome asks whether to keep the change to your new tab page, choose **Keep it**.

## Making changes

Edit any file, then click the reload icon (↻) on the extension's card in `chrome://extensions` and open a new tab. Changes to HTML/CSS/JS usually show up just by opening a fresh tab; changes to `manifest.json` always need a reload.

## Muse

Pressing Enter in the Muse bar calls `Muse.sendMessage(text)` in `muse.js`. It currently
copies the message to the clipboard and opens your signed-in https://muse.ai in a small
popup window at the bottom-right of the screen (reusing it if it's already open), so you
can paste with ⌘V. muse.ai has no URL for pre-filling a message (`?q=` is ignored) and
can't be embedded in an iframe (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`).

To connect an API later, replace the body of `sendMessage` in `muse.js`; it returns
`{ hint, keepText }` to tell the bar what to show. `chat.js` only handles the bar UI.

## Notes

- The background animation and transitions are turned off if your OS has *Reduce motion* enabled.
- The clock uses your system's 12/24-hour preference; the date and greeting are in English.
- Cards stack vertically on windows narrower than 720px.
