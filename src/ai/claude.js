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

/**
 * Generate an accountability-style check-in message
 * 
 * @param {object} options
 * @param {'morning'|'evening'|'deadline'|'silence'} options.type
 * @param {string|null} options.userName
 * @param {object} options.userContext
 * @param {string[]} options.goals - List of goal titles
 * @param {string} [options.deadline] - ISO string if deadline-based
 */
export async function generateAccountabilityCheckIn({ type, userName, userContext = {}, goals = [], deadline = null }) {
  let contextBlock = '';

  if (userName) {
    contextBlock += `\nThe person you're checking in on goes by "${userName}".`;
  }

  if (Object.keys(userContext).length > 0) {
    contextBlock += `\n\nHere's what you know about them:\n${JSON.stringify(userContext, null, 2)}`;
  }

  contextBlock += `\n\nTheir active goals: ${goals.join(', ')}`;

  if (deadline) {
    contextBlock += `\nDeadline approaching: ${new Date(deadline).toLocaleDateString('en-NG', { weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  }

  const typeInstructions = {
    morning: `You are sending a MORNING accountability check-in. It's a new day. Ask what they're tackling, or reference one of their goals casually. Keep it warm, short, human. Not a task manager. Like a friend who knows what they're working on. 1-2 messages max.

Examples of your tone:
- "Morning. What's today's battle?"
- "You said you wanted to study Evidence today. We doing this?"
- "What's one thing that would make today feel less terrible?"`,

    evening: `You are sending an EVENING accountability check-in. The day is wrapping up. Ask how it went — with warmth, not judgment. Celebrate if they did something. Be gentle if they didn't. 1-2 messages max.

Examples of your tone:
- "How did today actually go?"
- "Did we survive the day? Be honest."
- "What are you proud of today, even if it's small?"`,

    deadline: `You are sending a DEADLINE reminder. Something they committed to is due soon. Nudge them — not with pressure, but with the kind of "hey don't forget" energy a real friend has. Not corporate. Not robotic. 1-2 messages max.

Examples of your tone:
- "Wasn't your submission today?"
- "That thing you said you'd finish — how's it looking?"
- "Just making sure this didn't slip. You got it?"`,

    silence: `You are reaching out because they've been quiet and they have active goals. This is NOT a guilt trip. This is a friend noticing they disappeared. Be gentle. They might be struggling. They might just be busy. Don't assume. 1-2 messages max.

Examples of your tone:
- "Hey stranger. Been thinking about you."
- "You disappeared. You okay?"
- "No pressure. Just checking. We can start again whenever."
- "Even if everything collapsed, you're still allowed to come back."`,
  };

  const systemPrompt = BUBBA_SYSTEM_PROMPT + contextBlock + `\n\n` + typeInstructions[type];

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: 'user', content: `[SYSTEM: Generate a ${type} accountability check-in message]` }],
    });

    return response.content[0].text;
  } catch (error) {
    console.error(`❌ Claude API error on ${type} accountability check-in:`, error.message);

    // Fallback messages per type
    const fallbacks = {
      morning: "Morning. What are we working on today?",
      evening: "How did today go? Be honest with me.",
      deadline: "Hey — you've got something due soon. How's it looking?",
      silence: "Haven't heard from you in a bit. You good?",
    };

    return fallbacks[type] || "Hey. Just checking in.";
  }
}
