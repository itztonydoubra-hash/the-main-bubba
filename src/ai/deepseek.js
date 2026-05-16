import OpenAI from 'openai';
import dotenv from 'dotenv';
import { BUBBA_SYSTEM_PROMPT } from '../prompts/system.js';

dotenv.config();

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

/**
 * Generate Bubba's response using DeepSeek
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

  // Format messages for DeepSeek (OpenAI-compatible format)
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
  ];

  try {
    const response = await deepseek.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      max_tokens: 1024,
      messages,
      temperature: 0.9,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('❌ DeepSeek API error:', error.message);

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
    const response = await deepseek.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      max_tokens: 256,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '[SYSTEM: Generate a proactive check-in message]' },
      ],
      temperature: 0.9,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('❌ DeepSeek API error on check-in:', error.message);
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
    const response = await deepseek.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      max_tokens: 256,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `[SYSTEM: Generate a ${type} accountability check-in message]` },
      ],
      temperature: 0.9,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error(`❌ DeepSeek API error on ${type} accountability check-in:`, error.message);

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


// ═══════════════════════════════════════════
// OPPORTUNITY MESSAGES
// ═══════════════════════════════════════════

/**
 * Generate a message introducing an opportunity to a user
 * 
 * This should feel like: "I saw this and thought about you."
 * NOT like: "NEW OPPORTUNITY ALERT"
 */
export async function generateOpportunityMessage({ userName, userContext = {}, opportunity, matchReason }) {
  let contextBlock = '';

  if (userName) {
    contextBlock += `\nThe person you're talking to goes by "${userName}".`;
  }

  if (Object.keys(userContext).length > 0) {
    contextBlock += `\n\nHere's what you know about them:\n${JSON.stringify(userContext, null, 2)}`;
  }

  contextBlock += `\n\nYou matched this opportunity to them because: ${matchReason}`;
  contextBlock += `\n\nOpportunity details:\n${JSON.stringify(opportunity, null, 2)}`;

  const systemPrompt = BUBBA_SYSTEM_PROMPT + contextBlock + `

You are sharing an opportunity you found with this person. You genuinely think it fits them based on what you know about them.

CRITICAL RULES:
- Do NOT sound like a notification or alert system
- Do NOT say "NEW OPPORTUNITY" or "ALERT" or use announcement formatting
- DO sound like a friend who saw something and immediately thought of them
- Reference WHY you think it fits them specifically (based on past conversations)
- If they tend to self-reject, preemptively counter their imposter syndrome
- Include the key details (what it is, deadline if relevant) naturally
- If there's a URL, include it at the end casually
- Keep it 2-4 short messages max
- Be excited but not performatively so

Examples of your tone:
- "Omo wait. I just saw something you'd actually be good for."
- "Okay don't dismiss this before reading it please"
- "I know you said you wanted [thing]. Look at this."
- "Before you say 'I won't get picked' — just look first."`;

  try {
    const response = await deepseek.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      max_tokens: 512,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '[SYSTEM: Generate an opportunity introduction message]' },
      ],
      temperature: 0.9,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('❌ DeepSeek API error on opportunity message:', error.message);
    return `Hey, I saw something that made me think of you. ${opportunity.title}${opportunity.url ? '\n' + opportunity.url : ''}`;
  }
}

/**
 * Generate a follow-up on an opportunity that was sent but not responded to
 */
export async function generateOpportunityFollowUp({ userName, userContext = {}, opportunityTitle, deadline }) {
  let contextBlock = '';

  if (userName) {
    contextBlock += `\nThe person you're following up with goes by "${userName}".`;
  }

  if (Object.keys(userContext).length > 0) {
    contextBlock += `\n\nHere's what you know about them:\n${JSON.stringify(userContext, null, 2)}`;
  }

  contextBlock += `\n\nYou previously sent them an opportunity: "${opportunityTitle}"`;
  if (deadline) {
    contextBlock += `\nDeadline: ${new Date(deadline).toLocaleDateString('en-NG', { weekday: 'long', month: 'short', day: 'numeric' })}`;
  }

  const systemPrompt = BUBBA_SYSTEM_PROMPT + contextBlock + `

You sent this person an opportunity a couple days ago and they haven't responded. You're gently following up. NOT nagging. NOT guilt-tripping. Just checking if they saw it, if they're interested, or if they need help with it.

Tone:
- "Did you look at that thing I sent?"
- "No pressure but did you see it?"
- "You went quiet after I sent that. Not interested or just overwhelmed?"
- "If you need help with the application just say"

Keep it to 1-2 short messages. Casual.`;

  try {
    const response = await deepseek.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      max_tokens: 256,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '[SYSTEM: Generate an opportunity follow-up message]' },
      ],
      temperature: 0.9,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('❌ DeepSeek API error on opportunity follow-up:', error.message);
    return `Hey — did you check out that ${opportunityTitle} thing I sent? No pressure, just curious.`;
  }
}

/**
 * Generate a deadline nudge for an opportunity that's closing soon
 */
export async function generateDeadlineNudge({ userName, userContext = {}, opportunityTitle, deadline, userResponse }) {
  let contextBlock = '';

  if (userName) {
    contextBlock += `\nThe person you're nudging goes by "${userName}".`;
  }

  if (Object.keys(userContext).length > 0) {
    contextBlock += `\n\nHere's what you know about them:\n${JSON.stringify(userContext, null, 2)}`;
  }

  contextBlock += `\n\nOpportunity: "${opportunityTitle}"`;
  contextBlock += `\nDeadline: ${new Date(deadline).toLocaleDateString('en-NG', { weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  contextBlock += `\nTheir response so far: ${userResponse || 'no response yet'}`;

  const systemPrompt = BUBBA_SYSTEM_PROMPT + contextBlock + `

The deadline for this opportunity is approaching (within 48 hours). You're giving them a final nudge. The energy should be "don't let this slip" but NOT aggressive.

If they said they were interested: push a bit more firmly ("You said you wanted this. The deadline is tomorrow.")
If they never responded: be lighter ("That thing closes soon. If you want it, now's the time.")

Tone:
- "That deadline is tomorrow btw."
- "Are we applying or are we doing the usual 'I'll do it later' thing"
- "Last chance on this one. Just saying."
- "Don't let fear make this decision for you."

1-2 messages max.`;

  try {
    const response = await deepseek.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      max_tokens: 256,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '[SYSTEM: Generate a deadline nudge message]' },
      ],
      temperature: 0.9,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('❌ DeepSeek API error on deadline nudge:', error.message);
    return `Hey — that ${opportunityTitle} thing closes soon. If you want it, now's the time.`;
  }
}
