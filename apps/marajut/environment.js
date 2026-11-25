export function isFixtureEnvironment(env = process.env) {
  return env.MARAJUT_ENV === 'local' || env.MARAJUT_ENV === 'test';
}
