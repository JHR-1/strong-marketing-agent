/**
 * Legacy prompts export — kept for backwards compatibility.
 *
 * Each company now owns its own prompts (see
 * `./companies/<slug>.js`). When the agent runs in multi-company
 * mode it reads prompts directly from the selected company. The
 * symbols re-exported here resolve against the DEFAULT company
 * (Strong Recruitment Group) so any legacy import path keeps
 * producing the same prompts as before.
 */

const { getDefaultCompany } = require('./companies');

const def = getDefaultCompany();

module.exports = {
  CALENDAR_SYSTEM_PROMPT: def.prompts.CALENDAR_SYSTEM_PROMPT,
  buildCalendarUserPrompt: def.prompts.buildCalendarUserPrompt,
  CAPTION_EDIT_SYSTEM_PROMPT: def.prompts.CAPTION_EDIT_SYSTEM_PROMPT
};
