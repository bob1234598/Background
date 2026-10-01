# Background — Minimal New Tab

A Chrome extension (Manifest V3) that replaces the new tab page with a calm, minimal dashboard:

- Slowly moving near-black → midnight-blue gradient with a faint drifting glow
- Large thin clock, full date and a time-of-day greeting
- Frosted-glass **Today** (Google Calendar) and **Tasks** (Google Tasks) cards
- A **✦ Muse** input bar at the bottom; replies appear in a bubble above it

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

## Google Calendar & Tasks setup

The extension uses `chrome.identity.getAuthToken` with the scopes
`calendar.readonly` and `tasks` (see `oauth2` in `manifest.json`). One-time setup:

1. **Pin the extension ID.** Generate a key (keep `key.pem` private; it's gitignored):
   ```sh
   openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem
   openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A   # → "key" in manifest.json
   ```
   Add the output as `"key": "MIIB…"` in `manifest.json`, reload the extension and note the ID
   shown in `chrome://extensions`.
2. **Google Cloud project.** Create a project at console.cloud.google.com and enable the
   **Google Calendar API** and **Google Tasks API**.
3. **OAuth consent.** In *Google Auth Platform*: set app name and emails, audience **External**,
   leave it in **Testing**, and add your Google account as a **test user**.
4. **OAuth client.** Create a client of type **Chrome Extension** with the extension ID from step 1
   as the *Item ID*. Copy the client ID into `oauth2.client_id` in `manifest.json` and reload.

## Notes

- The background animation and bubble transitions are turned off if your OS has *Reduce motion* enabled.
- The clock uses your system's 12/24-hour preference; the date and greeting are in English.
- Cards stack vertically on windows narrower than 720px.
