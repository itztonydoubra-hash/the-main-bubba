/**
 * Image/Vision Understanding
 * 
 * When users send pictures, Bubba can see and understand them.
 * Uses DeepSeek's vision model or Groq's vision endpoint.
 * 
 * Examples:
 * - User sends a photo of their timetable → Bubba reads it
 * - User sends a screenshot of grades → Bubba understands and responds
 * - User sends a meme → Bubba reacts naturally
 * - User sends a photo of lecture notes → Bubba helps explain
 */

import OpenAI from 'openai';
import { BUBBA_SYSTEM_PROMPT } from '../prompts/system.js';

/**
 * Analyze an image and generate a response
 * 
 * @param {Buffer} imageBuffer - The image data
 * @param {string} mimeType - Image MIME type (image/jpeg, image/png, etc.)
 * @param {string} caption - Optional caption the user sent with the image
 * @param {object} userContext - User context for personalization
 * @param {string} userName - User's display name
 * @returns {string} Bubba's response about the image
 */
export async function analyzeImage(imageBuffer, mimeType, caption = '', userContext = {}, userName = null) {
  // Try Groq vision first (free), then DeepSeek
  const groqKey = process.env.GROQ_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  const apiKey = groqKey || deepseekKey;
  const baseURL = groqKey
    ? 'https://api.groq.com/openai/v1'
    : 'https://api.deepseek.com';
  const model = groqKey ? 'meta-llama/llama-4-scout-17b-16e-instruct' : 'deepseek-chat';

  if (!apiKey) {
    return null;
  }

  const client = new OpenAI({ baseURL, apiKey });

  // Convert buffer to base64
  const base64Image = imageBuffer.toString('base64');
  const imageUrl = `data:${mimeType};base64,${base64Image}`;

  // Build context
  let contextBlock = '';
  if (userName) {
    contextBlock += `\nThe person you're talking to goes by "${userName}".`;
  }
  if (Object.keys(userContext).length > 0) {
    contextBlock += `\n\nWhat you know about them:\n${JSON.stringify(userContext, null, 2)}`;
  }

  const systemPrompt = BUBBA_SYSTEM_PROMPT + contextBlock + `

The user just sent you a picture${caption ? ' with this caption: "' + caption + '"' : ''}. Look at the image and respond naturally — like a friend would if someone sent them a photo on WhatsApp.

Rules:
- If it's a screenshot of grades/results: respond emotionally first, then practically
- If it's a timetable or schedule: help them plan around it
- If it's a meme or funny image: react naturally, laugh with them
- If it's a personal photo: be warm and genuine
- If it's lecture notes: help them understand what they're looking at
- If it's something you can't make out: just say so honestly
- Keep it short — like a real text response to a photo
- Do NOT describe the image back to them ("I see a...") — just respond naturally to what's in it`;

  try {
    const response = await client.chat.completions.create({
      model,
      max_tokens: 512,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: caption || 'What do you think about this?' },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      temperature: 0.9,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('❌ Vision API error:', error.message);

    // If vision model not supported, return a friendly fallback
    if (error.message.includes('not supported') || error.message.includes('invalid_model') || error.status === 400) {
      return null; // Will trigger fallback in index.js
    }

    return null;
  }
}
