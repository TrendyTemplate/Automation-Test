// Rule format:
// conditions: { match: "all" | "any", items: [{ field, op, value }] }
// actions:    [{ type: "ai_reply", mode?: "draft"|"auto", instructions? }
//              | { type: "template_reply", template_id, mode?: "draft"|"auto" }
//              | { type: "forward", to }
//              | { type: "mark_read" }
//              | { type: "ignore" }
//              | { type: "webhook", url }
//              | { type: "assign", user_id }
//              | { type: "snooze", hours }]

export const FIELDS = ['from_email', 'from_domain', 'from_name', 'to_email', 'subject', 'body', 'category',
  'priority', 'sentiment', 'language', 'mailbox_id'];
export const OPS = ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with', 'regex'];
export const ACTIONS = ['ai_reply', 'template_reply', 'forward', 'mark_read', 'ignore', 'webhook', 'assign', 'snooze'];

function fieldValue(msg, field) {
  switch (field) {
    case 'from_domain': return (msg.from_email || '').split('@')[1] || '';
    case 'body': return msg.text_body || '';
    case 'mailbox_id': return String(msg.mailbox_id);
    default: return msg[field] == null ? '' : String(msg[field]);
  }
}

export function matchCondition(msg, { field, op, value }) {
  const a = fieldValue(msg, field).toLowerCase();
  const b = String(value ?? '').toLowerCase();
  switch (op) {
    case 'contains': return a.includes(b);
    case 'not_contains': return !a.includes(b);
    case 'equals': return a === b;
    case 'not_equals': return a !== b;
    case 'starts_with': return a.startsWith(b);
    case 'ends_with': return a.endsWith(b);
    case 'regex':
      try { return new RegExp(String(value), 'i').test(fieldValue(msg, field)); } catch { return false; }
    default: return false;
  }
}

export function ruleMatches(msg, conditions) {
  const items = conditions?.items || [];
  if (!items.length) return true;
  return conditions.match === 'any' ? items.some((c) => matchCondition(msg, c)) : items.every((c) => matchCondition(msg, c));
}

export function validateRule({ name, conditions, actions }) {
  if (!name || typeof name !== 'string') return 'Rule name is required';
  if (!conditions || !Array.isArray(conditions.items)) return 'conditions.items must be an array';
  for (const c of conditions.items) {
    if (!FIELDS.includes(c.field)) return `Unknown field: ${c.field}`;
    if (!OPS.includes(c.op)) return `Unknown operator: ${c.op}`;
    if (c.op === 'regex') { try { new RegExp(c.value); } catch { return `Invalid regex: ${c.value}`; } }
  }
  if (!Array.isArray(actions) || !actions.length) return 'At least one action is required';
  for (const a of actions) {
    if (!ACTIONS.includes(a.type)) return `Unknown action: ${a.type}`;
    if (a.type === 'forward' && !/^[^@\s]+@[^@\s]+$/.test(a.to || '')) return 'forward action needs a valid "to" email';
    if (a.type === 'webhook' && !/^https:\/\//.test(a.url || '')) return 'webhook action needs an https:// url';
    if (a.type === 'template_reply' && !a.template_id) return 'template_reply action needs template_id';
    if (a.type === 'assign' && !Number.isInteger(Number(a.user_id))) return 'assign action needs a teammate';
    if (a.type === 'snooze' && !(Number(a.hours) > 0)) return 'snooze action needs hours';
  }
  return null;
}
