/**
 * UK / international awareness days lookup, used to seed the calendar
 * generator. The list is intentionally curated towards days that are
 * relevant for a UK construction / M&E / transport recruitment business.
 *
 * Items can be either:
 *   - { month, day, name }                 fixed date
 *   - { month, week, weekday, name }       e.g. "third Sunday of June"
 *   - { month, type: 'range', from, to, name }
 */

const { DateTime } = require('luxon');

// 1 = January … 12 = December
const AWARENESS_DAYS = [
  // ----------------- January -----------------
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 1, day: 27, name: 'Holocaust Memorial Day' },

  // ----------------- February -----------------
  { month: 2, day: 4, name: 'World Cancer Day' },
  { month: 2, day: 11, name: 'International Day of Women & Girls in Science' },
  { month: 2, type: 'rangeFirstWeek', name: "Children's Mental Health Week" },

  // ----------------- March -----------------
  { month: 3, day: 8, name: "International Women's Day" },
  { month: 3, day: 14, name: 'British Science Week' },
  { month: 3, day: 20, name: 'International Day of Happiness' },

  // ----------------- April -----------------
  { month: 4, day: 7, name: 'World Health Day' },
  { month: 4, day: 22, name: 'Earth Day' },
  { month: 4, day: 28, name: 'World Day for Safety and Health at Work' },
  { month: 4, day: 23, name: "St George's Day" },

  // ----------------- May -----------------
  { month: 5, day: 1, name: 'May Day' },
  { month: 5, day: 5, name: 'International Day of the Midwife' },
  { month: 5, day: 12, name: 'International Nurses Day' },
  { month: 5, type: 'rangeSecondWeek', name: 'Mental Health Awareness Week' },
  { month: 5, day: 28, name: 'World Hunger Day' },

  // ----------------- June -----------------
  { month: 6, type: 'rangeFirstWeek', name: "Volunteers' Week" },
  { month: 6, day: 5, name: 'World Environment Day' },
  { month: 6, type: 'rangeSecondWeek', name: 'Bike Week' },
  { month: 6, type: 'rangeThirdWeek', name: "Men's Health Week" },
  { month: 6, type: 'rangeThirdWeek', name: 'Loneliness Awareness Week' },
  { month: 6, day: 22, name: 'Windrush Day' },
  { month: 6, week: 'last-saturday', name: 'Armed Forces Day' },

  // ----------------- July -----------------
  { month: 7, day: 4, name: 'US Independence Day (intl trade context)' },
  { month: 7, day: 11, name: 'World Population Day' },
  { month: 7, day: 18, name: 'Nelson Mandela International Day' },
  { month: 7, day: 30, name: 'International Day of Friendship' },

  // ----------------- August -----------------
  { month: 8, day: 9, name: 'International Day of the Worlds Indigenous Peoples' },
  { month: 8, day: 12, name: 'International Youth Day' },
  { month: 8, day: 19, name: 'World Humanitarian Day' },

  // ----------------- September -----------------
  { month: 9, day: 8, name: 'International Literacy Day' },
  { month: 9, day: 10, name: 'World Suicide Prevention Day' },
  { month: 9, day: 21, name: 'International Day of Peace' },
  { month: 9, type: 'rangeLastWeek', name: 'National Inclusion Week' },

  // ----------------- October -----------------
  { month: 10, day: 1, name: 'International Day of Older Persons' },
  { month: 10, day: 4, name: 'World Habitat Day' },
  { month: 10, day: 10, name: 'World Mental Health Day' },
  { month: 10, day: 15, name: 'Global Handwashing Day' },
  { month: 10, day: 16, name: 'World Food Day' },
  { month: 10, day: 31, name: "Halloween / World Cities Day" },

  // ----------------- November -----------------
  { month: 11, day: 11, name: 'Armistice Day / Remembrance' },
  { month: 11, day: 13, name: 'World Kindness Day' },
  { month: 11, day: 19, name: "International Men's Day" },
  { month: 11, day: 20, name: "Universal Children's Day" },
  { month: 11, day: 25, name: 'International Day for Elimination of Violence against Women' },

  // ----------------- December -----------------
  { month: 12, day: 1, name: 'World AIDS Day' },
  { month: 12, day: 3, name: 'International Day of Persons with Disabilities' },
  { month: 12, day: 10, name: 'Human Rights Day' },
  { month: 12, day: 25, name: 'Christmas Day' },
  { month: 12, day: 31, name: "New Year's Eve" }
];

/**
 * Get a list of {date: 'YYYY-MM-DD', name} for the given year/month (1-12).
 */
function awarenessDaysForMonth(year, month) {
  const out = [];
  for (const item of AWARENESS_DAYS) {
    if (item.month !== month) continue;

    if (typeof item.day === 'number') {
      out.push({
        date: DateTime.fromObject({ year, month, day: item.day })
          .toISODate(),
        name: item.name
      });
      continue;
    }

    if (item.type === 'rangeFirstWeek') {
      out.push({
        date: firstMondayOfMonth(year, month).toISODate(),
        name: item.name
      });
      continue;
    }
    if (item.type === 'rangeSecondWeek') {
      out.push({
        date: firstMondayOfMonth(year, month).plus({ weeks: 1 }).toISODate(),
        name: item.name
      });
      continue;
    }
    if (item.type === 'rangeThirdWeek') {
      out.push({
        date: firstMondayOfMonth(year, month).plus({ weeks: 2 }).toISODate(),
        name: item.name
      });
      continue;
    }
    if (item.type === 'rangeLastWeek') {
      out.push({
        date: lastMondayOfMonth(year, month).toISODate(),
        name: item.name
      });
      continue;
    }
    if (item.week === 'last-saturday') {
      out.push({
        date: lastWeekdayOfMonth(year, month, 6).toISODate(),
        name: item.name
      });
      continue;
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function firstMondayOfMonth(year, month) {
  let d = DateTime.fromObject({ year, month, day: 1 });
  while (d.weekday !== 1) d = d.plus({ days: 1 });
  return d;
}

function lastMondayOfMonth(year, month) {
  let d = DateTime.fromObject({ year, month, day: 1 }).endOf('month');
  while (d.weekday !== 1) d = d.minus({ days: 1 });
  return d;
}

/**
 * weekday: Luxon convention (1 = Mon ... 7 = Sun)
 */
function lastWeekdayOfMonth(year, month, weekday) {
  let d = DateTime.fromObject({ year, month, day: 1 }).endOf('month');
  while (d.weekday !== weekday) d = d.minus({ days: 1 });
  return d;
}

/**
 * For a given target date (today), compute the next "month to plan".
 * Default: plan for (today + lookahead months).
 */
function targetMonth(now = DateTime.now(), lookaheadMonths = 1) {
  const t = now.plus({ months: lookaheadMonths });
  return {
    year: t.year,
    month: t.month,
    monthName: t.toFormat('LLLL') // e.g. "June"
  };
}

/**
 * All Mon/Wed/Fri dates in a given month at a given HH:mm in Europe/London.
 */
function postingSlotsForMonth(year, month, hhmm = '09:00', tz = 'Europe/London') {
  const [hh, mm] = hhmm.split(':').map((x) => parseInt(x, 10));
  const start = DateTime.fromObject({ year, month, day: 1 }, { zone: tz });
  const end = start.endOf('month');
  const slots = [];
  let d = start;
  while (d <= end) {
    if ([1, 3, 5].includes(d.weekday)) {
      slots.push(d.set({ hour: hh, minute: mm, second: 0, millisecond: 0 }));
    }
    d = d.plus({ days: 1 });
  }
  return slots;
}

module.exports = {
  awarenessDaysForMonth,
  targetMonth,
  postingSlotsForMonth
};
