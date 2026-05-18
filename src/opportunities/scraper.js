/**
 * Opportunity Scraper
 * 
 * Fetches real opportunities from Nigerian law-focused sources
 * and adds them to Supabase for matching with users.
 * 
 * Sources:
 * - OpportunityDesk (Nigerian opportunities)
 * - LawGlobalHub (Nigerian law scholarships)
 * - TheNigeriaLawyer (events, bar news)
 * - AfterSchoolAfrica (fellowships for African students)
 * - OpportunityLab (scholarships/fellowships)
 * 
 * This scraper uses web fetching to check RSS/pages periodically
 * and extracts opportunities relevant to Nigerian law students.
 */

import { addOpportunity, getActiveOpportunities } from '../db/supabase.js';

// ═══════════════════════════════════════════
// SOURCE DEFINITIONS
// ═══════════════════════════════════════════

const SOURCES = [
  {
    name: 'OpportunityDesk',
    url: 'https://opportunitydesk.org/category/opportunities-for-nigerians/feed/',
    type: 'rss',
    categories: ['career', 'academic', 'skill_building'],
  },
  {
    name: 'LawGlobalHub',
    url: 'https://www.lawglobalhub.com/feed/',
    type: 'rss',
    categories: ['academic', 'career'],
  },
  {
    name: 'TheNigeriaLawyer',
    url: 'https://thenigerialawyer.com/feed/',
    type: 'rss',
    categories: ['event', 'academic', 'career'],
  },
  {
    name: 'AfterSchoolAfrica',
    url: 'https://www.afterschoolafrica.com/feed/',
    type: 'rss',
    categories: ['academic', 'skill_building'],
  },
];

// Keywords that indicate an opportunity is relevant to law students
const LAW_KEYWORDS = [
  'law', 'legal', 'lawyer', 'attorney', 'barrister', 'solicitor',
  'moot', 'arbitration', 'litigation', 'judiciary', 'court',
  'scholarship', 'fellowship', 'internship', 'clerkship',
  'human rights', 'justice', 'constitutional', 'criminal',
  'corporate law', 'tech law', 'intellectual property',
  'nigerian law', 'bar association', 'law school',
  'essay competition', 'writing competition', 'debate',
];

// Keywords to generate tags for matching
const TAG_MAP = {
  'tech law': ['tech_law', 'legal_tech'],
  'intellectual property': ['ip_law', 'tech_law'],
  'human rights': ['human_rights', 'international_law'],
  'international': ['international_law', 'international_exposure'],
  'moot': ['moot', 'public_speaking', 'advocacy'],
  'writing': ['writing', 'legal_writing'],
  'essay': ['writing', 'legal_writing'],
  'scholarship': ['scholarship', 'funding'],
  'fellowship': ['fellowship', 'career'],
  'internship': ['internship', 'career'],
  'remote': ['remote'],
  'paid': ['paid'],
  'arbitration': ['arbitration', 'adr'],
  'criminal': ['criminal_law'],
  'corporate': ['corporate_law'],
  'ngo': ['ngo', 'public_interest'],
  'research': ['research', 'academic'],
};

// ═══════════════════════════════════════════
// RSS PARSING (lightweight, no extra deps)
// ═══════════════════════════════════════════

/**
 * Fetch and parse an RSS feed
 * Returns array of items with title, link, description, pubDate
 */
async function fetchRSS(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Bubba-Bot/1.0 (Opportunity Monitor)' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.log(`   ⚠️  ${url} returned ${response.status}`);
      return [];
    }

    const xml = await response.text();
    return parseRSSItems(xml);
  } catch (error) {
    console.log(`   ⚠️  Failed to fetch ${url}: ${error.message}`);
    return [];
  }
}

/**
 * Simple XML RSS parser (no dependencies needed)
 * Extracts <item> elements from RSS feed
 */
function parseRSSItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const title = extractTag(itemXml, 'title');
    const link = extractTag(itemXml, 'link');
    const description = extractTag(itemXml, 'description');
    const pubDate = extractTag(itemXml, 'pubDate');

    if (title) {
      items.push({
        title: cleanHTML(title),
        url: link || '',
        description: cleanHTML(description || '').substring(0, 500),
        pubDate: pubDate ? new Date(pubDate) : new Date(),
      });
    }
  }

  return items;
}

/**
 * Extract content from an XML tag
 */
function extractTag(xml, tag) {
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1];

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Strip HTML tags and decode entities
 */
function cleanHTML(str) {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════
// FILTERING & CATEGORIZATION
// ═══════════════════════════════════════════

/**
 * Check if an RSS item is relevant to Nigerian law students
 */
function isRelevantToLawStudents(item) {
  const text = `${item.title} ${item.description}`.toLowerCase();

  // Must contain at least one law-related keyword
  const hasLawKeyword = LAW_KEYWORDS.some((kw) => text.includes(kw));

  // Or be from a law-specific source and contain opportunity keywords
  const hasOpportunityKeyword = [
    'apply', 'application', 'deadline', 'scholarship', 'fellowship',
    'internship', 'competition', 'call for', 'opportunity', 'programme',
    'program', 'grant', 'award', 'opening',
  ].some((kw) => text.includes(kw));

  return hasLawKeyword || hasOpportunityKeyword;
}

/**
 * Determine the category of an opportunity
 */
function categorizeOpportunity(item) {
  const text = `${item.title} ${item.description}`.toLowerCase();

  if (text.includes('scholarship') || text.includes('fellowship') || text.includes('grant') || text.includes('moot') || text.includes('essay competition')) {
    return 'academic';
  }
  if (text.includes('internship') || text.includes('job') || text.includes('career') || text.includes('clerkship') || text.includes('chamber')) {
    return 'career';
  }
  if (text.includes('workshop') || text.includes('course') || text.includes('training') || text.includes('certification')) {
    return 'skill_building';
  }
  if (text.includes('conference') || text.includes('summit') || text.includes('webinar') || text.includes('event') || text.includes('dinner')) {
    return 'event';
  }

  return 'academic'; // Default
}

/**
 * Generate tags for matching based on content
 */
function generateTags(item) {
  const text = `${item.title} ${item.description}`.toLowerCase();
  const tags = new Set();

  for (const [keyword, tagList] of Object.entries(TAG_MAP)) {
    if (text.includes(keyword)) {
      tagList.forEach((tag) => tags.add(tag));
    }
  }

  // Add location tags
  if (text.includes('remote')) tags.add('remote');
  if (text.includes('abuja')) tags.add('abuja');
  if (text.includes('lagos')) tags.add('lagos');
  if (text.includes('nigeria')) tags.add('nigeria');
  if (text.includes('africa')) tags.add('africa');
  if (text.includes('international')) tags.add('international');

  // Always tag as law-related
  tags.add('law');

  return [...tags];
}

/**
 * Determine subcategory
 */
function getSubcategory(item) {
  const text = `${item.title} ${item.description}`.toLowerCase();

  if (text.includes('moot')) return 'moot';
  if (text.includes('scholarship')) return 'scholarship';
  if (text.includes('fellowship')) return 'fellowship';
  if (text.includes('internship')) return 'internship';
  if (text.includes('essay') || text.includes('writing competition')) return 'essay_competition';
  if (text.includes('workshop')) return 'workshop';
  if (text.includes('conference')) return 'conference';
  if (text.includes('webinar')) return 'webinar';
  if (text.includes('clerkship')) return 'clerkship';

  return null;
}

/**
 * Try to extract a deadline from the text
 */
function extractDeadline(item) {
  const text = `${item.title} ${item.description}`;

  // Look for common deadline patterns
  const patterns = [
    /deadline[:\s]*(\w+ \d{1,2},?\s*\d{4})/i,
    /closes?\s*(?:on|by)?[:\s]*(\w+ \d{1,2},?\s*\d{4})/i,
    /(?:before|by)\s+(\w+ \d{1,2},?\s*\d{4})/i,
    /(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const date = new Date(match[1]);
      if (!isNaN(date.getTime()) && date > new Date()) {
        return date.toISOString();
      }
    }
  }

  return null;
}

// ═══════════════════════════════════════════
// MAIN SCRAPER
// ═══════════════════════════════════════════

/**
 * Scrape all sources for new opportunities
 * 
 * This is the main entry point called by the scheduler.
 * It fetches RSS feeds, filters for law-relevant items,
 * and adds new ones to Supabase.
 */
export async function scrapeOpportunities() {
  console.log('🔍 Scraping opportunity sources...');

  // Get existing opportunities to avoid duplicates
  const existing = await getActiveOpportunities();
  const existingTitles = new Set(existing.map((o) => o.title.toLowerCase()));
  const existingUrls = new Set(existing.map((o) => o.url).filter(Boolean));

  let totalNew = 0;

  for (const source of SOURCES) {
    console.log(`   📡 Fetching: ${source.name}...`);

    const items = await fetchRSS(source.url);
    console.log(`      Found ${items.length} items`);

    // Filter for relevance and recency (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const relevant = items.filter((item) => {
      // Skip if too old
      if (item.pubDate < thirtyDaysAgo) return false;

      // Skip duplicates
      if (existingTitles.has(item.title.toLowerCase())) return false;
      if (item.url && existingUrls.has(item.url)) return false;

      // Must be relevant
      return isRelevantToLawStudents(item);
    });

    console.log(`      ${relevant.length} relevant to law students`);

    // Add new opportunities to database
    for (const item of relevant) {
      try {
        await addOpportunity({
          title: item.title.substring(0, 200),
          description: item.description.substring(0, 500),
          category: categorizeOpportunity(item),
          subcategory: getSubcategory(item),
          tags: generateTags(item),
          source: source.name,
          url: item.url || null,
          deadline: extractDeadline(item),
          location: null, // Could enhance with location extraction
          eligibility: null,
        });

        existingTitles.add(item.title.toLowerCase());
        if (item.url) existingUrls.add(item.url);
        totalNew++;
      } catch (err) {
        // Skip duplicates or DB errors silently
        if (!err.message?.includes('duplicate')) {
          console.log(`      ⚠️  Failed to add: ${item.title.substring(0, 50)}... — ${err.message}`);
        }
      }
    }

    // Small delay between sources
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (totalNew > 0) {
    console.log(`✅ Scraper complete: ${totalNew} new opportunity(ies) added`);
  } else {
    console.log('   No new opportunities found this cycle.');
  }

  return totalNew;
}
