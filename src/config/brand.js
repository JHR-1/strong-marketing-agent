/**
 * Strong Recruitment Group — Brand configuration
 *
 * Single source of truth for company info, sectors, colours, and
 * the visual rules every generated post must respect.
 */

const BRAND = Object.freeze({
  company: 'Strong Recruitment Group',
  legalName: 'Strong Recruitment Group Limited',
  phone: '0208 763 6122',
  website: 'strong-group.co.uk',
  email: 'info@strong-group.co.uk',
  tagline: 'Stay Strong.',
  voice: 'Professional, approachable, UK-focused. Bold, direct CTAs.',
  hashtagsBase: ['#StrongGroup', '#Recruitment', '#UK'],

  colours: {
    background: '#0B1B33',         // Dark navy blue
    backgroundAlt: '#0F2244',
    accentGold: '#E5A442',
    accentOrange: '#F08A24',
    accentRed: '#C8362E',
    accentCyan: '#1FB6D4',
    blueGradientStart: '#3D7BD9',  // logo gradient (NG letters)
    blueGradientEnd: '#1F4FA8',
    textOnDark: '#FFFFFF',
    textMuted: '#C7D2E1'
  },

  logo: {
    description:
      '3 blue dots stacked vertically on the left, a thin vertical grey line, ' +
      'then "STRONG" in dark grey uppercase with the "NG" rendered in a blue ' +
      'gradient (light blue to mid blue), and "GROUP" in lighter grey uppercase ' +
      'beneath. Always reproduced bottom-left of the contact strip.',
    position: 'bottom-left of contact strip'
  },

  contactStripRule:
    'Every post MUST include a horizontal contact strip at the very bottom ' +
    'containing, left to right: the Strong Group logo, phone "0208 763 6122", ' +
    'website "strong-group.co.uk", and email "info@strong-group.co.uk". ' +
    'A curved gold/red wave separator line sits immediately above the strip.',

  sectors: [
    'M&E',
    'Construction',
    'Driving/Transport',
    'Fit-Out & Interiors',
    'Data Centres',
    'Rail',
    'Commercial',
    'Residential'
  ],

  contentTypes: [
    'industry_awareness_day',
    'sector_promo',
    'client_review',
    'staff_spotlight',
    'hiring_tips',
    'workforce_planning'
  ],

  // Mix targets used by calendar generator
  contentMix: {
    sector_promo: 0.40,
    industry_awareness_day: 0.20,
    hiring_tips_or_workforce_planning: 0.20,
    client_review_or_staff_spotlight: 0.20
  },

  // Posting schedule
  schedule: {
    daysOfWeek: ['Mon', 'Wed', 'Fri'],
    timeUk: '09:00',
    timezone: 'Europe/London',
    blogsPerMonth: 2
  },

  // Default platform mix per post (overridable per item)
  defaultPlatforms: ['linkedin', 'facebook', 'instagram', 'twitter']
});

module.exports = BRAND;
