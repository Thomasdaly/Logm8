/**
 * JSON Schema (draft 2020-12) for SchemeDefinition, for tooling and for documenting custom schemes.
 * The engine's own validator (validateScheme) enforces this plus cross-field rules.
 */
const tier = (bound: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['category'],
  properties: { category: { enum: ['minor', 'substantial', 'severe', 'critical'] }, [bound]: { type: 'integer', minimum: 0 } },
});

export const schemeJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://logmate.invalid/schemas/scheme-definition-v1.json',
  title: 'LogMate fatigue scheme definition (v1)',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'name', 'family', 'arrangement', 'version', 'verifiedOn', 'sources', 'rules', 'switchingOut', 'resetRestMinutes'],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    family: { enum: ['standard', 'bfm', 'afm', 'ach', 'exemption', 'custom'] },
    arrangement: { enum: ['solo', 'two_up'] },
    version: { type: 'string', minLength: 1 },
    verifiedOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    sources: { type: 'array', items: { type: 'string' } },
    switchingOut: { enum: ['compliance_or_reset', 'reset_only'] },
    resetRestMinutes: { type: 'integer', exclusiveMinimum: 0 },
    longNight: {
      type: 'object',
      additionalProperties: false,
      required: ['dailyThreshold', 'dailyPeriodRuleId', 'nightFrom', 'nightTo', 'roundUpTo'],
      properties: {
        dailyThreshold: { type: 'integer', exclusiveMinimum: 0 },
        dailyPeriodRuleId: { type: 'string' },
        nightFrom: { type: 'integer', minimum: 0, maximum: 1440 },
        nightTo: { type: 'integer', minimum: 0, maximum: 1440 },
        roundUpTo: { type: 'integer', exclusiveMinimum: 0 },
      },
    },
    rules: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'description', 'period', 'countFrom', 'source'],
        properties: {
          id: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          source: { type: 'string' },
          period: { type: 'integer', exclusiveMinimum: 0, multipleOf: 15 },
          countFrom: { enum: ['any_rest', 'relevant_major_rest'] },
          majorRest: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['minContinuous', 'stationary'],
              properties: {
                minContinuous: { type: 'integer', exclusiveMinimum: 0 },
                stationary: { type: 'boolean' },
                allowSleeperMoving: { type: 'boolean' },
                nightRest: { type: 'boolean' },
                splitRestOnly: { type: 'boolean' },
              },
            },
          },
          maxWork: {
            type: 'object',
            additionalProperties: false,
            required: ['minutes', 'measure'],
            properties: {
              minutes: { type: 'integer', exclusiveMinimum: 0 },
              measure: { enum: ['work', 'long_night'] },
              tiers: { type: 'array', minItems: 1, items: tier('maxActual') },
            },
          },
          minRest: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'description', 'total', 'minBlock', 'continuous', 'stationary'],
              properties: {
                id: { type: 'string', minLength: 1 },
                description: { type: 'string' },
                total: { type: 'integer', exclusiveMinimum: 0 },
                minBlock: { type: 'integer', minimum: 15 },
                continuous: { type: 'boolean' },
                stationary: { type: 'boolean' },
                allowSleeperMoving: { type: 'boolean' },
                nightRest: { type: 'boolean' },
                count: { type: 'integer', exclusiveMinimum: 0 },
                consecutive: { type: 'boolean' },
                afterMaxWork: { type: 'integer', exclusiveMinimum: 0 },
                exclusiveGroup: { type: 'string', minLength: 1 },
                splitRestDefence: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['blocks'],
                  properties: { blocks: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', exclusiveMinimum: 0 } } },
                },
                tiers: { type: 'array', minItems: 1, items: tier('minActual') },
              },
            },
          },
        },
      },
    },
  },
} as const;
