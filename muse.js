// Muse backend. Swap the body of sendMessage for a real API call later;
// the UI (chat.js) only depends on this function's contract.

/**
 * Send the conversation so far and get Muse's reply.
 *
 * @param {Array<{role: "user" | "assistant", content: string}>} history
 *   Full conversation, oldest first. The last entry is the new user message.
 * @returns {Promise<string>} Muse's reply text. Throw to signal an error.
 */
async function sendMessage(history) {
  // Placeholder: simulate a short network delay.
  await new Promise((resolve) => setTimeout(resolve, 600));
  return "Muse isn't connected yet";
}
