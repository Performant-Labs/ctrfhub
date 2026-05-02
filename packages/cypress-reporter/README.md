# @ctrfhub/cypress-reporter

CTRFHub reporter for Cypress. Wraps `cypress-ctrf-json-reporter` and
automatically POSTs test results to a CTRFHub instance.

## Usage

```ts
// cypress.config.ts
import { defineConfig } from 'cypress';

export default defineConfig({
  reporter: '@ctrfhub/cypress-reporter',
  reporterOptions: {
    outputDir: 'ctrf',
  },
});

// Environment variables
// CTRFHUB_INGEST_URL=https://ctrfhub.example.com
// CTRFHUB_API_TOKEN=                  # API token with ingest scope
// CTRFHUB_PROJECT_SLUG=my-project     # Project slug in CTRFHub
```

On `after:run`, the reporter reads the generated CTRF JSON file and POSTs it to
`<CTRFHUB_INGEST_URL>/api/v1/projects/<CTRFHUB_PROJECT_SLUG>/runs` with an
`x-api-token` header and a deterministic `Idempotency-Key` (SHA-256 of the
run summary). Success and failure are logged to stderr; errors never throw
into the test runner.
