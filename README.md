# Background — Minimal New Tab

A Chrome extension (Manifest V3) that replaces the new tab page with a calm, minimal dashboard:

- Slowly moving near-black → midnight-blue gradient with a faint drifting glow
- Large thin clock, full date and a time-of-day greeting
- Frosted-glass **Today** and **Tasks** placeholder cards
- A **✦ Muse** input bar at the bottom; replies appear in a bubble above it

Plain HTML, CSS and JavaScript. No build step, no frameworks.

## Files

| File            | Purpose                                         |
| --------------- | ----------------------------------------------- |
| `manifest.json` | Extension manifest; overrides the new tab page  |
| `newtab.html`   | Page markup                                     |
| `styles.css`    | Background animation, glass styles, layout      |
| `clock.js`      | Clock, date and greeting                        |
| `muse.js`       | `sendMessage(history)` — Muse backend (placeholder) |
| `chat.js`       | Muse input bar, reply bubble, in-memory history |

## Load it unpacked

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (toggle in the top-right).
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Open a new tab. If Chrome asks whether to keep the change to your new tab page, choose **Keep it**.

## Making changes

Edit any file, then click the reload icon (↻) on the extension's card in `chrome://extensions` and open a new tab. Changes to HTML/CSS/JS usually show up just by opening a fresh tab; changes to `manifest.json` always need a reload.

## Connecting Muse

`chat.js` calls `sendMessage(history)` in `muse.js`, where `history` is an array of
`{ role: "user" | "assistant", content }` objects (oldest first, ending with the new
user message). It must return a `Promise<string>` with the reply, or throw on error.
Right now it returns "Muse isn't connected yet" after a short delay. History is kept in
memory only and is cleared when the tab closes.

## Notes

- The background animation and bubble transitions are turned off if your OS has *Reduce motion* enabled.
- The clock uses your system's 12/24-hour preference; the date and greeting are in English.
- Cards stack vertically on windows narrower than 720px.
