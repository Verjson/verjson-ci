import { createHash } from 'node:crypto';

const PROVIDER_FIELDS = new Set(['provider', 'runId', 'runUrl', 'runner', 'startedAt', 'finishedAt']);

export function canonicalizeResult(result) {
  return sortValue(stripProviderFields(result));
}

export function serializeCanonicalResult(result) {
  return `${JSON.stringify(canonicalizeResult(result))}\n`;
}

export function digestCanonicalResult(result) {
  return createHash('sha256').update(serializeCanonicalResult(result)).digest('hex');
}

function stripProviderFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripProviderFields);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PROVIDER_FIELDS.has(key))
      .map(([key, child]) => [key, stripProviderFields(child)]),
  );
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}
