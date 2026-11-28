export function isFixtureEnvironment(env = process.env) {
  return ['local','test'].includes(env.MERAJUT_ENV ?? env.MARAJUT_ENV);
}
