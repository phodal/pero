/** Presentation of Host observations. Scientific matching remains in Rust. */
export const METHODS = Object.freeze([
  Object.freeze({ id: 'paper-agent.pcgym', name: 'PC-Gym', app: 'Paper', software: 'PC-Gym, SB3, CasADi' }),
  Object.freeze({ id: 'control-lab.python-control', name: 'Control', app: 'Control Lab', software: 'python-control, SciPy' }),
  Object.freeze({ id: 'control-lab.ngspice', name: 'Circuit', app: 'Control Lab', software: 'ngspice' }),
  Object.freeze({ id: 'lcms2yield.inference', name: 'LCMS2Yield', app: 'LCMS2Yield', software: 'PyTorch 2.3, PyG, RDKit' }),
]);
const METHOD_APP = Object.freeze({
  'paper-agent.pcgym': 'paper-agent',
  'control-lab.python-control': 'control-lab',
  'control-lab.ngspice': 'control-lab',
  'lcms2yield.inference': 'lcms2yield',
});
export const METHOD_IDS = Object.freeze(METHODS.map(method => method.id));
export const OBSERVATION_MAX_AGE_MS = 300_000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length <= 4096;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const version = value => object(value) && ['major', 'minor', 'patch'].every(key => integer(value[key]));
const optionalText = value => value === null || text(value);
const optionalDigest = value => value === null || digest(value);
function requirement(value) {
  if (!object(value)) return false;
  switch (value.kind) {
    case 'profile': return digest(value.digest);
    case 'python': return integer(value.major) && integer(value.minor) && (value.patch === null || integer(value.patch));
    case 'package': return text(value.name) && optionalText(value.version);
    case 'native': return text(value.name) && optionalDigest(value.sha256);
    case 'platform': return text(value.system) && text(value.machine);
    default: return false;
  }
}

/** Validate once at the HTTP boundary; never infer a missing field as a pass. */
export function readInspection(value, expectedMethod) {
  const profile = value?.profile, observed = profile?.observation, requirements = value?.requirements;
  const valid = object(value) && value.schema === 'pero.environment.inspection.v1'
    && METHOD_IDS.includes(expectedMethod) && value.method === expectedMethod
    && value.scope === 'configured-interpreter' && value.evidence === 'metadata_only'
    && integer(value.observed_at_ms) && typeof value.matched === 'boolean'
    && Array.isArray(value.missing) && value.missing.length <= 64 && value.missing.every(requirement)
    && (value.matched ? value.missing.length === 0 : value.missing.length > 0)
    && object(profile) && digest(profile.id) && object(observed)
    && observed.name === METHOD_APP[expectedMethod]
    && version(observed.python) && text(observed.system) && text(observed.machine)
    && optionalDigest(observed.interpreter_sha256)
    && object(observed.packages) && Object.keys(observed.packages).length <= 128
    && Object.entries(observed.packages).every(([name, v]) => text(name) && optionalText(v))
    && object(observed.native) && Object.keys(observed.native).length <= 64
    && Object.values(observed.native).every(v => object(v) && ['observed', 'missing', 'probe_failed', 'unsupported'].includes(v.status) && optionalText(v.version) && optionalDigest(v.sha256))
    && object(requirements) && requirements.method === expectedMethod
    && Array.isArray(requirements.required) && requirements.required.length > 0 && requirements.required.length <= 64
    && requirements.required.every(requirement)
    && Array.isArray(requirements.preferred) && requirements.preferred.length <= 64 && requirements.preferred.every(requirement);
  if (!valid) throw new Error('Invalid environment observation');
  // Strip unknown transport fields; the export contains only the agreed observation contract.
  return {
    schema: value.schema, method: value.method, scope: value.scope, evidence: value.evidence,
    observed_at_ms: value.observed_at_ms, matched: value.matched, missing: value.missing,
    profile: {
      id: profile.id, observation: {
        name: observed.name, python: observed.python, system: observed.system, machine: observed.machine,
        interpreter_sha256: observed.interpreter_sha256, packages: observed.packages, native: observed.native,
      },
    },
    requirements: { method: requirements.method, required: requirements.required, preferred: requirements.preferred },
  };
}

export function observationState(report, now) {
  if (!report) return 'unchecked';
  if (now < report.observed_at_ms || now - report.observed_at_ms > OBSERVATION_MAX_AGE_MS) return 'stale';
  return report.matched ? 'matched' : 'blocked';
}

export function requirementText(rule) {
  switch (rule.kind) {
    case 'python': return `Python ${rule.major}.${rule.minor}${rule.patch === null ? '' : `.${rule.patch}`}`;
    case 'package': return rule.version === null ? rule.name : `${rule.name} == ${rule.version}`;
    case 'native': return rule.sha256 ? `${rule.name} (${rule.sha256.slice(0, 12)})` : rule.name;
    case 'platform': return `${rule.system} / ${rule.machine}`;
    case 'profile': return `Profile ${rule.digest.slice(0, 12)}`;
    default: throw new Error('Unknown environment requirement');
  }
}

export function filterMethods(targets, query, filter, records, now) {
  const needle = query.trim().toLowerCase();
  return METHODS.filter(method => targets.includes(method.id))
    .filter(method => `${method.name} ${method.app} ${method.software}`.toLowerCase().includes(needle))
    .filter(method => filter === 'all' || (records[method.id]?.state === 'error' ? 'error' : observationState(records[method.id]?.report, now)) === filter);
}
