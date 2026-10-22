'use strict';

const { badRequest } = require('./errors');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_MAX_STRING = 200;

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function checkString(name, value, rule, errors) {
  if (typeof value !== 'string') {
    errors.push(`${name} must be a string`);
    return undefined;
  }
  const v = value.trim();
  const max = rule.maxLength || DEFAULT_MAX_STRING;
  if (rule.minLength && v.length < rule.minLength) {
    errors.push(`${name} must be at least ${rule.minLength} characters`);
  }
  if (v.length > max) errors.push(`${name} must be at most ${max} characters`);
  if (rule.pattern && !rule.pattern.test(v)) errors.push(`${name} has an invalid format`);
  if (rule.enum && !rule.enum.includes(v)) errors.push(`${name} must be one of: ${rule.enum.join(', ')}`);
  return v;
}

function checkNumber(name, value, rule, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${name} must be a number`);
    return undefined;
  }
  if (rule.integer && !Number.isInteger(value)) errors.push(`${name} must be an integer`);
  if (rule.min !== undefined && value < rule.min) errors.push(`${name} must be >= ${rule.min}`);
  if (rule.max !== undefined && value > rule.max) errors.push(`${name} must be <= ${rule.max}`);
  return value;
}

function checkMap(name, value, rule, errors) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${name} must be an object`);
    return undefined;
  }
  const keys = Object.keys(value);
  if (keys.length > (rule.maxKeys || 20)) errors.push(`${name} must have at most ${rule.maxKeys || 20} keys`);
  const out = {};
  for (const key of keys) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) {
      errors.push(`${name}.${key} is not a valid key`);
      continue;
    }
    const v = value[key];
    if (typeof v === 'string') {
      if (v.length > 200) errors.push(`${name}.${key} must be at most 200 characters`);
      out[key] = v.trim();
    } else if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') {
      out[key] = v;
    } else {
      errors.push(`${name}.${key} must be a string, number or boolean`);
    }
  }
  return out;
}

function checkField(name, value, rule, errors) {
  if (value === undefined || value === null || value === '') {
    if (rule.required) errors.push(`${name} is required`);
    return rule.default;
  }
  switch (rule.type) {
    case 'string':
      return checkString(name, value, rule, errors);
    case 'number':
      return checkNumber(name, value, rule, errors);
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`${name} must be a boolean`);
        return undefined;
      }
      return value;
    case 'date':
      if (!isValidDate(value)) {
        errors.push(`${name} must be a valid date (YYYY-MM-DD)`);
        return undefined;
      }
      return value;
    case 'map':
      return checkMap(name, value, rule, errors);
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${name} must be an array`);
        return undefined;
      }
      if (rule.minItems && value.length < rule.minItems) {
        errors.push(`${name} must contain at least ${rule.minItems} item(s)`);
      }
      if (value.length > (rule.maxItems || 100)) {
        errors.push(`${name} must contain at most ${rule.maxItems || 100} items`);
        return undefined;
      }
      return value.map((item, i) => checkField(`${name}[${i}]`, item, rule.items, errors));
    }
    case 'object':
      return validateInto(value, rule.schema, name, errors);
    default:
      throw new Error(`Unknown validation type: ${rule.type}`);
  }
}

function validateInto(input, schema, prefix, errors) {
  const label = prefix || 'body';
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    errors.push(`${label} must be a JSON object`);
    return undefined;
  }
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      errors.push(`Unknown field: ${prefix ? `${prefix}.` : ''}${key}`);
    }
  }
  const out = {};
  for (const [field, rule] of Object.entries(schema)) {
    const fieldName = prefix ? `${prefix}.${field}` : field;
    const v = checkField(fieldName, input[field], rule, errors);
    if (v !== undefined) out[field] = v;
  }
  return out;
}

/**
 * Validates a request body against a schema. Unknown fields are rejected
 * (PRJ-SR-004) and string values are trimmed. Throws HTTP 400 on failure.
 */
function validate(input, schema) {
  const errors = [];
  const out = validateInto(input, schema, '', errors);
  if (errors.length) throw badRequest('Validation failed', { errors });
  return out;
}

/** Parses an optional integer query parameter with bounds. */
function intQuery(params, name, { min, max, defaultValue }) {
  const raw = params.get(name);
  if (raw === null || raw === '') return defaultValue;
  if (!/^-?\d+$/.test(raw)) throw badRequest(`${name} must be an integer`);
  const value = Number(raw);
  if (value < min || value > max) throw badRequest(`${name} must be between ${min} and ${max}`);
  return value;
}

/** Parses an optional numeric query parameter with bounds. */
function numberQuery(params, name, { min, max, defaultValue }) {
  const raw = params.get(name);
  if (raw === null || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw badRequest(`${name} must be a number`);
  if (value < min || value > max) throw badRequest(`${name} must be between ${min} and ${max}`);
  return value;
}

function dateQuery(params, name) {
  const raw = params.get(name);
  if (raw === null || raw === '') return undefined;
  if (!isValidDate(raw)) throw badRequest(`${name} must be a valid date (YYYY-MM-DD)`);
  return raw;
}

function enumQuery(params, name, values) {
  const raw = params.get(name);
  if (raw === null || raw === '') return undefined;
  if (!values.includes(raw)) throw badRequest(`${name} must be one of: ${values.join(', ')}`);
  return raw;
}

module.exports = { validate, isValidDate, intQuery, numberQuery, dateQuery, enumQuery };
