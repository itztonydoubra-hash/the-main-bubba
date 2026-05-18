import {
  getActiveOpportunities,
  getUnmatchedOpportunitiesForUser,
  getAllUsersWithInterests,
  getUserInterests,
  createOpportunityMatch,
  getPendingOpportunityMatches,
  markOpportunityMatchSent,
  getOpportunitiesNeedingFollowUp,
  markOpportunityFollowedUp,
  getOpportunitiesWithApproachingDeadlines,
  expireOldOpportunities,
} from '../db/supabase.js';
import { generateOpportunityMessage, generateOpportunityFollowUp, generateDeadlineNudge } from '../ai/deepseek.js';
import { sendMessage } from '../whatsapp/connection.js';
import { scrapeOpportunities } from './scraper.js';

// ═══════════════════════════════════════════
// MATCHING LOGIC
// ═══════════════════════════════════════════

/**
 * Score how well an opportunity matches a user's interests
 * 
 * Returns a score from 0-100 and a reason string
 */
function scoreOpportunityMatch(opportunity, userInterests) {
  if (!userInterests || userInterests.length === 0) {
    // No interests recorded yet — low-confidence match based on category alone
    return { score: 20, reason: 'general opportunity for law students' };
  }

  const interestNames = userInterests.map((i) => i.interest.toLowerCase());
  const interestStrengths = {};
  userInterests.forEach((i) => {
    interestStrengths[i.interest.toLowerCase()] = i.strength;
  });

  const oppTags = (opportunity.tags || []).map((t) => t.toLowerCase());
  const oppCategory = (opportunity.category || '').toLowerCase();
  const oppSubcategory = (opportunity.subcategory || '').toLowerCase();
  const oppTitle = (opportunity.title || '').toLowerCase();
  const oppDescription = (opportunity.description || '').toLowerCase();

  let score = 0;
  const matchReasons = [];

  // Tag matches (strongest signal)
  for (const tag of oppTags) {
    if (interestNames.includes(tag)) {
      const strength = interestStrengths[tag];
      const bonus = strength === 'high' ? 30 : strength === 'medium' ? 20 : 10;
      score += bonus;
      matchReasons.push(tag);
    }
  }

  // Subcategory match
  if (oppSubcategory && interestNames.includes(oppSubcategory)) {
    score += 15;
    matchReasons.push(oppSubcategory);
  }

  // Keyword matching in title/description against interests
  for (const interest of interestNames) {
    if (oppTitle.includes(interest) || oppDescription.includes(interest)) {
      const strength = interestStrengths[interest];
      const bonus = strength === 'high' ? 15 : strength === 'medium' ? 10 : 5;
      score += bonus;
      if (!matchReasons.includes(interest)) matchReasons.push(interest);
    }
  }

  // Cap at 100
  score = Math.min(score, 100);

  // Build reason
  const reason = matchReasons.length > 0
    ? `matches their interest in ${matchReasons.slice(0, 3).join(', ')}`
    : 'general opportunity for law students';

  return { score, reason };
}

/**
 * Run the matching cycle: find new opportunities for each user
 * 
 * This is the core engine. It:
 * 1. Gets all active users with interests
 * 2. For each user, finds opportunities they haven't seen
 * 3. Scores each opportunity against their interests
 * 4. Creates matches for high-scoring ones (above threshold)
 */
export async function runOpportunityMatching() {
  try {
    // First, expire old opportunities
    await expireOldOpportunities();

    const users = await getAllUsersWithInterests();
    let totalMatches = 0;

    for (const user of users) {
      const unmatchedOpps = await getUnmatchedOpportunitiesForUser(user.id);
      if (unmatchedOpps.length === 0) continue;

      const userInterests = user.user_interests || [];

      for (const opp of unmatchedOpps) {
        const { score, reason } = scoreOpportunityMatch(opp, userInterests);

        // Only match if score is above threshold (30+)
        // Lower threshold means more opportunities shown (cast wider net for users with few interests)
        const threshold = userInterests.length >= 3 ? 30 : 15;

        if (score >= threshold) {
          await createOpportunityMatch(user.id, user.phone_number, opp.id, reason);
          totalMatches++;
        }
      }
    }

    if (totalMatches > 0) {
      console.log(`🎯 Opportunity matching complete: ${totalMatches} new match(es) created`);
    }
  } catch (error) {
    console.error('❌ Error in opportunity matching:', error.message);
  }
}

// ═══════════════════════════════════════════
// DELIVERY
// ═══════════════════════════════════════════

/**
 * Send pending opportunity matches to users
 * 
 * Bubba doesn't dump all opportunities at once.
 * She sends MAX 1-2 per user per cycle to avoid noise.
 */
export async function deliverOpportunityMatches() {
  try {
    const pending = await getPendingOpportunityMatches();
    if (pending.length === 0) return;

    // Group by user — max 1 opportunity per user per delivery
    const userDeliveries = {};
    for (const match of pending) {
      if (!userDeliveries[match.phone_number]) {
        userDeliveries[match.phone_number] = match;
      }
    }

    for (const [phoneNumber, match] of Object.entries(userDeliveries)) {
      const phoneJid = `${phoneNumber}@s.whatsapp.net`;
      const userName = match.users?.display_name || null;
      const userContext = match.users?.context || {};
      const opportunity = match.opportunities;

      if (!opportunity) continue;

      const message = await generateOpportunityMessage({
        userName,
        userContext,
        opportunity: {
          title: opportunity.title,
          description: opportunity.description,
          category: opportunity.category,
          subcategory: opportunity.subcategory,
          deadline: opportunity.deadline,
          location: opportunity.location,
          url: opportunity.url,
          eligibility: opportunity.eligibility,
        },
        matchReason: match.match_reason,
      });

      await sendMessage(phoneJid, message);
      await markOpportunityMatchSent(match.id);

      console.log(`🎯 Opportunity sent to ${phoneNumber}: "${opportunity.title}"`);

      // Delay between sends
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } catch (error) {
    console.error('❌ Error delivering opportunities:', error.message);
  }
}

// ═══════════════════════════════════════════
// FOLLOW-UPS
// ═══════════════════════════════════════════

/**
 * Follow up on opportunities that were sent but never responded to
 * 
 * Bubba gently checks: "Did you look at that thing I sent?"
 * Not nagging. Just caring.
 */
export async function followUpOnOpportunities() {
  try {
    const needsFollowUp = await getOpportunitiesNeedingFollowUp(48); // 48h since sent

    for (const match of needsFollowUp) {
      const phoneJid = `${match.phone_number}@s.whatsapp.net`;
      const userName = match.users?.display_name || null;
      const userContext = match.users?.context || {};
      const opportunity = match.opportunities;

      if (!opportunity) continue;

      const message = await generateOpportunityFollowUp({
        userName,
        userContext,
        opportunityTitle: opportunity.title,
        deadline: opportunity.deadline,
      });

      await sendMessage(phoneJid, message);
      await markOpportunityFollowedUp(match.id);

      console.log(`📬 Opportunity follow-up sent to ${match.phone_number}: "${opportunity.title}"`);

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } catch (error) {
    console.error('❌ Error in opportunity follow-ups:', error.message);
  }
}

/**
 * Nudge users about opportunities with approaching deadlines
 * 
 * "That thing closes tomorrow. Did you apply or are we doing the panic thing again?"
 */
export async function nudgeApproachingDeadlines() {
  try {
    const approaching = await getOpportunitiesWithApproachingDeadlines(48);

    for (const match of approaching) {
      const phoneJid = `${match.phone_number}@s.whatsapp.net`;
      const userName = match.users?.display_name || null;
      const userContext = match.users?.context || {};
      const opportunity = match.opportunities;

      if (!opportunity) continue;

      const message = await generateDeadlineNudge({
        userName,
        userContext,
        opportunityTitle: opportunity.title,
        deadline: opportunity.deadline,
        userResponse: match.response,
      });

      await sendMessage(phoneJid, message);

      console.log(`⏰ Deadline nudge sent to ${match.phone_number}: "${opportunity.title}" closes soon`);

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } catch (error) {
    console.error('❌ Error in deadline nudges:', error.message);
  }
}

// ═══════════════════════════════════════════
// FULL CYCLE
// ═══════════════════════════════════════════

/**
 * Run the complete opportunity cycle:
 * 1. Scrape new opportunities from sources
 * 2. Match new opportunities to users
 * 3. Deliver pending matches
 * 4. Follow up on silent ones
 * 5. Nudge approaching deadlines
 */
export async function runOpportunityCycle() {
  console.log('🎯 Running opportunity cycle...');
  await scrapeOpportunities();
  await runOpportunityMatching();
  await deliverOpportunityMatches();
  await followUpOnOpportunities();
  await nudgeApproachingDeadlines();
}
