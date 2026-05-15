import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { BUBBA_SYSTEM_PROMPT } from '../prompts/system.js';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Generate Bubba's response using Claude
 * 
 * @param {Array} conversationHistory - Array of {role, content} messages
 * @param {object} userContext - Learned info about the user (from Supabase)
 * @param {string} userName - User's display name (if known)
 * @returns {string} Bubba's response text
 */
export async function generateResponse(conversationHistory, userContext = {}, userName = null) {
  // Build context addendum for the system prompt
  let contextBlock = '';

  if (userName) {
    contextBlock += `\nThe person you're talking to goes by "${userName}".`;
  }

  if (Object.keys(userContext).length > 0) {
    contextBlock += `\n\nHere's what you know about this person from past conversations:\n${JSON.stringify(userContext, null, 2)}`;
  }

  const systemPrompt = BUBBA_SYSTEM_PROMPT + contextBlock;

  // Format messages for Claude API
  const messages = conversationHistory.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    return response.content[0].text;
  } catch (error) {
    console.error('❌ Claude API error:', error.message);

    // Fallback response if API fails
    return "I'm having a moment — something's off on my end. Give me a sec and text me again? I'm not going anywhere.";
  }
}

/**
 * Generate a proactive check-in message
 */
export async function generateCheckInMessage(userContext = {}, userName = null, reason = '') {
  let contextBlock = '';

  if (userName) {
    contextBlock += `\nThe person you're checking in on goes by "${userName}".`;
  }

  if (Object.keys(userContext).length > 0) {
    contextBlock += `\n\nHere's what you know about them:\n${JSON.stringify(userContext, null, 2)}`;
  }

  if (reason) {
    contextBlock += `\n\nReason for check-in: ${reason}`;
  }

  const systemPrompt = BUBBA_SYSTEM_PROMPT + contextBlock + `

You are proactively checking in on this person. Write a short, natural check-in message. Not clinical. Not "I'm checking in on your progress." Just a real friend who noticed they haven't heard from someone in a while. Keep it to 1-2 short messages max.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: 'user', content: '[SYSTEM: Generate a proactive check-in message]' }],
    });

    return response.content[0].text;
  } catch (error) {
    console.error('❌ Claude API error on check-in:', error.message);
    return "Hey, haven't heard from you in a bit. You good?";
  }
}
