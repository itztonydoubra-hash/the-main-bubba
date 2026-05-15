/**
 * Crisis Detection Module
 * 
 * Listens for language patterns that indicate someone may be in danger.
 * Supports English and Nigerian Pidgin/English variations.
 */

// Patterns grouped by severity
const CRISIS_PATTERNS = {
  critical: [
    // Direct suicidal intent (English)
    /\b(i('m| am) going to (kill|end|hurt) (myself|my life))\b/i,
    /\b(i('ve| have) (decided|planned) to (die|end it|kill myself))\b/i,
    /\bi want to die\b/i,
    /\bi('m| am) going to end (it|this|everything)\b/i,
    /\bi('d| would) be better off dead\b/i,
    /\beveryone would be better (off )?without me\b/i,
    // Direct suicidal intent (Pidgin/Nigerian English)
    /\b(make i just (end|kill|cut) (it|am|my life))\b/i,
    /\b(na better i (go )?die)\b/i,
    /\b(i wan die)\b/i,
    /\b(make i just cut my life)\b/i,
    // Self-harm (active)
    /\bi('m| am) cutting (myself)?\b/i,
    /\bi (just )?(cut|hurt|burned|harmed) myself\b/i,
    /\bi have a plan to (hurt|kill|end)\b/i,
  ],

  high: [
    // Passive suicidal ideation (English)
    /\bi don'?t want to (be here|exist|live|wake up)\b/i,
    /\bwhat'?s the point (of (living|anything|life))?\b/i,
    /\bi can'?t do this anymore\b/i,
    /\bthere'?s no (point|reason|way out)\b/i,
    /\bi (just )?want (it all )?to (end|stop|be over)\b/i,
    /\bi('m| am) (a )?burden\b/i,
    /\bi ruin everything\b/i,
    // Passive suicidal ideation (Pidgin/Nigerian English)
    /\b(i no fit again)\b/i,
    /\b(this life don finish (for me)?)\b/i,
    /\b(i no see why i (still )?dey)\b/i,
    /\b(wetin be life sef)\b/i,
    /\b(i tire for this life)\b/i,
    // Self-harm (past or contemplating)
    /\bi (need|want) to feel pain\b/i,
    /\bi hurt myself (yesterday|last night|earlier|before)\b/i,
  ],

  medium: [
    // Hopelessness (English)
    /\bnothing will ever (change|get better|improve)\b/i,
    /\bthere'?s no (hope|point trying)\b/i,
    /\beveryone hates me\b/i,
    /\bnobody (cares|would notice|would miss me)\b/i,
    /\bi('m| am) (completely )?(alone|invisible|worthless)\b/i,
    // Hopelessness (Pidgin)
    /\b(i don tire)\b/i,
    /\b(nothing go change)\b/i,
    /\b(nobody (dey )?care)\b/i,
    /\b(i no get (anybody|person))\b/i,
    // Extreme distress
    /\bi can'?t (breathe|take it|handle|cope)\b/i,
    /\bi('m| am) (breaking|falling apart|losing it)\b/i,
  ],

  low: [
    // General distress markers (these alone aren't crisis, but add context)
    /\bi('m| am) (so )?(tired|exhausted|done)\b/i,
    /\bi (just )?feel (empty|numb|dead inside)\b/i,
    /\b(i no wan talk to anybody)\b/i,
  ],
};

/**
 * Detect crisis patterns in a message
 * 
 * @param {string} message - The user's message text
 * @returns {{ isCrisis: boolean, severity: string|null, patterns: string[] }}
 */
export function detectCrisis(message) {
  const detectedPatterns = [];
  let highestSeverity = null;

  const severityLevels = ['critical', 'high', 'medium', 'low'];

  for (const severity of severityLevels) {
    for (const pattern of CRISIS_PATTERNS[severity]) {
      if (pattern.test(message)) {
        detectedPatterns.push(pattern.source);

        // Track highest severity found
        if (!highestSeverity || severityLevels.indexOf(severity) < severityLevels.indexOf(highestSeverity)) {
          highestSeverity = severity;
        }
      }
    }
  }

  // Only flag as crisis for medium and above
  const isCrisis = highestSeverity && ['critical', 'high', 'medium'].includes(highestSeverity);

  return {
    isCrisis,
    severity: highestSeverity,
    patterns: detectedPatterns,
  };
}

/**
 * Check if a message warrants immediate escalation
 */
export function needsImmediateEscalation(severity) {
  return severity === 'critical';
}
