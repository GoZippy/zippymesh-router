/**
 * Detect if request body contains image or audio content (for routing to vision/audio-capable models).
 */
function hasImageOrAudioInMessages(messages) {
  if (!Array.isArray(messages)) return { hasImage: false, hasAudio: false };
  let hasImage = false;
  let hasAudio = false;
  for (const msg of messages) {
    const content = msg?.content;
    if (typeof content === "string") continue;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === "image_url" || part?.type === "image") hasImage = true;
      if (part?.type === "audio" || part?.type === "input_audio") hasAudio = true;
      if (hasImage && hasAudio) return { hasImage: true, hasAudio: true };
    }
  }
  return { hasImage, hasAudio };
}

function hasImageOrAudioInContents(contents) {
  if (!Array.isArray(contents)) return { hasImage: false, hasAudio: false };
  let hasImage = false;
  let hasAudio = false;
  for (const part of contents) {
    const inline = part?.inlineData ?? part?.inline_data;
    if (inline?.mimeType?.startsWith("image/")) hasImage = true;
    if (inline?.mimeType?.startsWith("audio/")) hasAudio = true;
  }
  return { hasImage, hasAudio };
}

/**
 * @param {object} body - Request body (messages, contents, or input)
 * @returns {{ hasImage: boolean, hasAudio: boolean }}
 */
export function detectMultimodal(body) {
  if (body.messages) return hasImageOrAudioInMessages(body.messages);
  if (body.contents) return hasImageOrAudioInContents(body.contents);
  if (body.input && Array.isArray(body.input)) {
    for (const item of body.input) {
      const msg = item?.messages ?? item;
      if (Array.isArray(msg)) {
        const r = hasImageOrAudioInMessages(msg);
        if (r.hasImage || r.hasAudio) return r;
      }
    }
  }
  return { hasImage: false, hasAudio: false };
}
