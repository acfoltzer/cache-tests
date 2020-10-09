import fs from 'fs'

import Ajv from 'ajv'

import tests from './tests/index.mjs'
import surrogate from './tests/surrogate-control.mjs'

tests.push(surrogate)

if (process.argv[2] === 'validate') {
  var ajv = new Ajv()
  var schema = JSON.parse(fs.readFileSync('lib/testsuite-schema.json', 'utf8'))
  var validate = ajv.compile(schema)
  var valid = validate(tests)
  if (!valid) console.log(validate.errors)
} else {
  console.log(JSON.stringify(tests, null, 2))
}
