/**
 * Strong Recruitment Group — Brand configuration
 *
 * Single source of truth for company info, sectors and the content
 * schedule rules used by the calendar generator. Visual / image-gen
 * rules have been removed — the user now supplies images themselves
 * via ChatGPT 5.5 and Telegram.
 */

const BRAND = Object.freeze({
  company: 'Strong Recruitment Group',
  legalName: 'Strong Recruitment Group Limited',
  phone: '0208 763 6122',
  website: 'strong-group.co.uk',
  email: 'info@strong-group.co.uk',
  tagline: 'Stay Strong.',
  voice:
    'Professional, approachable, UK-focused. Bold, direct CTAs. ' +
    'Empathetic for awareness days, confident for sector promos.',
  hashtagsBase: ['#StrongGroup', '#Recruitment', '#UK'],

  // Sectors Nick wants every monthly calendar to rotate through.
  // These map 1:1 onto the canonical list from the brief.
  sectors: [
    'M&E',
    'Construction',
    'Driving & Transport',
    'Data Centres',
    'Rail & Infrastructure',
    'Fit-Out & Interiors',
    'Residential'
  ],

  // Per-sector hashtag pack (added to each post's caption alongside the base).
  sectorHashtags: {
    'M&E': ['#MandE', '#MEPRecruitment', '#BuildingServices'],
    'Construction': ['#Construction', '#ConstructionJobs', '#UKConstruction'],
    'Driving & Transport': ['#DrivingJobs', '#HGV', '#Logistics'],
    'Data Centres': ['#DataCentres', '#CriticalInfrastructure', '#TechRecruitment'],
    'Rail & Infrastructure': ['#Rail', '#RailJobs', '#Infrastructure'],
    'Fit-Out & Interiors': ['#FitOut', '#Interiors', '#CommercialFitOut'],
    'Residential': ['#Residential', '#Housing', '#UKHousing']
  },

  contentTypes: [
    'industry_awareness_day',
    'sector_promo',
    'client_review',
    'staff_spotlight',
    'hiring_tips',
    'workforce_planning'
  ],

  // Posting schedule
  schedule: {
    daysOfWeek: ['Mon', 'Wed', 'Fri'],
    timeUk: '09:00',
    timezone: 'Europe/London',
    blogsPerMonth: 2,
    socialPostsPerWeek: 3
  },

  // Default platform mix per post (Zernio internal keys)
  defaultPlatforms: ['facebook', 'instagram', 'linkedin', 'twitter', 'google'],

  blog: {
    siteBaseUrl: 'https://strong-group.co.uk/news/'
  }
});

module.exports = BRAND;
