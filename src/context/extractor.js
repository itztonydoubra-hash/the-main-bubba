/**
 * Context Extractor
 * 
 * Automatically extracts useful information from user messages
 * and saves it to their Supabase profile. This makes Bubba smarter
 * over time without the user having to explicitly tell her things.
 * 
 * Extracts:
 * - Interests (tech law, writing, public speaking, etc.)
 * - Academic info (year, faculty, courses, CGPA)
 * - Personal info (family situation, relationship status, mental health)
 * - Goals mentioned casually
 * - Preferences (communication style, time of day active)
 */

import { updateUserContext, upsertUserInterest } from '../db/supabase.js';
import { createGoal } from '../db/supabase.js';

// ═══════════════════════════════════════════
// INTEREST DETECTION
// ═══════════════════════════════════════════

const INTEREST_PATTERNS = [
  // Law specializations
  { pattern: /\b(tech law|legal tech|technology law)\b/i, interest: 'tech_law', strength: 'high' },
  { pattern: /\b(human rights|civil liberties)\b/i, interest: 'human_rights', strength: 'high' },
  { pattern: /\b(international law|public international)\b/i, interest: 'international_law', strength: 'high' },
  { pattern: /\b(corporate law|company law|commercial law)\b/i, interest: 'corporate_law', strength: 'high' },
  { pattern: /\b(criminal law|criminal justice)\b/i, interest: 'criminal_law', strength: 'medium' },
  { pattern: /\b(environmental law|climate law)\b/i, interest: 'environmental_law', strength: 'high' },
  { pattern: /\b(family law|matrimonial)\b/i, interest: 'family_law', strength: 'medium' },
  { pattern: /\b(intellectual property|IP law|copyright|trademark)\b/i, interest: 'ip_law', strength: 'high' },
  { pattern: /\b(maritime law|admiralty)\b/i, interest: 'maritime_law', strength: 'high' },
  { pattern: /\b(oil and gas|petroleum law|energy law)\b/i, interest: 'energy_law', strength: 'high' },

  // Skills and activities
  { pattern: /\b(moot|mooting|moot court)\b/i, interest: 'moot', strength: 'high' },
  { pattern: /\bi (love|like|enjoy) writing\b/i, interest: 'writing', strength: 'high' },
  { pattern: /\b(public speaking|debate|debating)\b/i, interest: 'public_speaking', strength: 'high' },
  { pattern: /\b(research|legal research)\b/i, interest: 'research', strength: 'medium' },
  { pattern: /\b(freelanc|side hustle|making money)\b/i, interest: 'freelancing', strength: 'medium' },
  { pattern: /\b(content creat|social media|youtube)\b/i, interest: 'content_creation', strength: 'medium' },
  { pattern: /\b(coding|programming|developer|software)\b/i, interest: 'tech', strength: 'medium' },

  // Opportunity preferences
  { pattern: /\b(remote|work from home|online)\b.*\b(work|job|opportunity)\b/i, interest: 'remote', strength: 'medium' },
  { pattern: /\b(international|abroad|overseas)\b.*\b(opportunity|exposure|experience)\b/i, interest: 'international_exposure', strength: 'high' },
  { pattern: /\b(scholarship|funding|financial aid)\b/i, interest: 'scholarship', strength: 'medium' },
  { pattern: /\b(internship|pupilage|clerkship)\b/i, interest: 'internship', strength: 'high' },
];

// ═══════════════════════════════════════════
// CONTEXT DETECTION
// ═══════════════════════════════════════════

const CONTEXT_EXTRACTORS = [
  // Academic year
  { pattern: /\bi('m| am) (in )?(100|200|300|400|500)\s*level/i, key: 'academic_year', extract: (m) => m[3] + ' level' },
  { pattern: /\b(first|second|third|fourth|fifth|final)\s*year/i, key: 'academic_year', extract: (m) => m[1] + ' year' },

  // ADHD / mental health (important for accountability approach)
  { pattern: /\bi have adhd\b/i, key: 'has_adhd', extract: () => true },
  { pattern: /\bi('m| am) (dealing with|have|diagnosed with) (depression|anxiety|bipolar)/i, key: 'mental_health', extract: (m) => m[3] },
  { pattern: /\bi('m| am) on (medication|meds|antidepressants)/i, key: 'on_medication', extract: () => true },

  // Family situation
  { pattern: /\bi live (with|at) (my )?(parents|family|home)/i, key: 'living_situation', extract: () => 'with_family' },
  { pattern: /\bi live alone/i, key: 'living_situation', extract: () => 'alone' },
  { pattern: /\b(single parent|my mom|my dad)\b.*\b(raised|only)\b/i, key: 'family_structure', extract: () => 'single_parent' },

  // Financial situation
  { pattern: /\bi('m| am) broke\b/i, key: 'financial_stress', extract: () => true },
  { pattern: /\bcan('t| not) afford/i, key: 'financial_stress', extract: () => true },
  { pattern: /\b(struggling|can't pay) (for )?(rent|food|transport|fees|registration)/i, key: 'financial_stress', extract: () => true },

  // Relationship
  { pattern: /\bmy (boyfriend|girlfriend|partner|babe|boo)\b/i, key: 'in_relationship', extract: () => true },
  { pattern: /\bi('m| am) single\b/i, key: 'in_relationship', extract: () => false },

  // Chamber
  { pattern: /\bi('m| am) in (\w+) chamber/i, key: 'chamber', extract: (m) => m[2] },

  // Exam timing
  { pattern: /\b(my )?(exams?|tests?) (is|are|starts?) (in |on |next )(\w+)/i, key: 'exam_period', extract: (m) => m[5] },

  // Sleep patterns (for accountability)
  { pattern: /\bi (can't|don't|never) sleep/i, key: 'sleep_issues', extract: () => true },
  { pattern: /\binsomnia\b/i, key: 'sleep_issues', extract: () => true },
];

// ═══════════════════════════════════════════
// MAIN EXTRACTION FUNCTION
// ═══════════════════════════════════════════

/**
 * Extract context and interests from a user message
 * Runs after every message — lightweight pattern matching, no API calls
 * 
 * @param {string} text - The user's message
 * @param {string} userId - User's Supabase ID
 * @param {string} phoneNumber - User's phone number
 */
export async function extractContext(text, userId, phoneNumber) {
  const extractedContext = {};
  const extractedInterests = [];

  // Run interest detection
  for (const { pattern, interest, strength } of INTEREST_PATTERNS) {
    if (pattern.test(text)) {
      extractedInterests.push({ interest, strength });
    }
  }

  // Run context extraction
  for (const { pattern, key, extract } of CONTEXT_EXTRACTORS) {
    const match = text.match(pattern);
    if (match) {
      extractedContext[key] = extract(match);
    }
  }

  // Save interests to user_interests table
  for (const { interest, strength } of extractedInterests) {
    try {
      await upsertUserInterest(userId, phoneNumber, interest, strength, 'inferred');
    } catch (err) {
      // Silently skip — don't break the conversation for a failed extraction
    }
  }

  // Save context to user profile
  if (Object.keys(extractedContext).length > 0) {
    try {
      await updateUserContext(userId, extractedContext);
      console.log(`   🧠 Context extracted for ${phoneNumber}: ${Object.keys(extractedContext).join(', ')}`);
    } catch (err) {
      // Silently skip
    }
  }

  if (extractedInterests.length > 0) {
    console.log(`   🧠 Interests detected for ${phoneNumber}: ${extractedInterests.map(i => i.interest).join(', ')}`);
  }

  return { context: extractedContext, interests: extractedInterests };
}

// ═══════════════════════════════════════════
// GOAL DETECTION FROM CONVERSATION
// ═══════════════════════════════════════════

const GOAL_PATTERNS = [
  /i want to\s+(.+?)(?:\s+(?:this|next|every|by|before)\s+.+)?$/i,
  /i('m| am) going to\s+(.+?)(?:\s+(?:this|next|every)\s+.+)?$/i,
  /my goal is to\s+(.+)/i,
  /i need to\s+(.+?)(?:\s+(?:today|tomorrow|this week|by)\s+.+)?$/i,
  /i('m| am) trying to\s+(.+)/i,
];

/**
 * Detect if user is stating a goal and save it
 * Only triggers for clear goal statements, not casual mentions
 */
export async function detectAndSaveGoal(text, userId, phoneNumber) {
  // Only match clear intent statements
  const lower = text.toLowerCase();

  // Skip if too short or a question
  if (text.length < 15 || text.includes('?')) return null;

  // Must contain goal-like language
  if (!lower.includes('i want to') && !lower.includes('i\'m going to') && !lower.includes('my goal') && !lower.includes('i need to') && !lower.includes('i\'m trying to')) {
    return null;
  }

  // Extract the goal text
  for (const pattern of GOAL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const goalText = (match[2] || match[1]).trim();

      // Skip if goal is too vague or too short
      if (goalText.length < 5 || goalText.length > 100) continue;

      // Skip common non-goals
      if (/^(know|understand|be|feel|think|see|find out)/i.test(goalText)) continue;

      // Determine category
      let category = 'personal_growth';
      if (/stud|read|exam|assignment|moot|cgpa|class/i.test(goalText)) category = 'academic';
      if (/money|save|earn|hustle|freelanc|pay/i.test(goalText)) category = 'financial';
      if (/sleep|eat|exercise|gym|clean|meditat/i.test(goalText)) category = 'life';

      try {
        const goal = await createGoal(phoneNumber, userId, {
          title: goalText.substring(0, 100),
          category,
          frequency: /every day|daily/i.test(text) ? 'daily' : /every week|weekly/i.test(text) ? 'weekly' : 'once',
        });
        console.log(`   🎯 Goal detected and saved: "${goalText}" (${category})`);
        return goal;
      } catch (err) {
        // Silently skip
        return null;
      }
    }
  }

  return null;
}
