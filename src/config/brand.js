/**
 * Legacy brand export — kept for backwards compatibility with any
 * caller that still does `require('./config').BRAND` or
 * `require('./config/brand')`.
 *
 * The canonical brand object now lives on each company config
 * (`require('./companies').getCompany(slug).brand`). This file
 * resolves to the brand of the DEFAULT company (Strong Recruitment
 * Group) so existing behaviour is preserved when nothing else has
 * told the agent which company to use.
 */

const { getDefaultCompany } = require('./companies');

module.exports = getDefaultCompany().brand;
