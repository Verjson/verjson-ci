import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import schema from '../../../verjson-ci.schema.json' with { type: 'json' };
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

export async function loadContract(path) {
  const source = await readFile(path, 'utf8');
  const contract = parse(source);

  if (!validate(contract)) {
    throw new ContractValidationError(validate.errors ?? []);
  }

  return contract;
}

export class ContractValidationError extends Error {
  constructor(errors) {
    super(`invalid verjson-ci contract: ${formatErrors(errors)}`);
    this.name = 'ContractValidationError';
    this.errors = errors;
  }
}

function formatErrors(errors) {
  return errors
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}
