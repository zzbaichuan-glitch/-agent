export type {
  AccessContext,
  AssetVisibility,
  InformationAsset,
  SourceReference,
} from './domain.js';
export {
  redactSecrets,
  type RedactionResult,
  type SecretFinding,
  type SecretFindingType,
} from './security/secret-redactor.js';
