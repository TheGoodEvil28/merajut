function credentials(url, audience) {
  const username = process.env[`PREVIEW_${audience}_USER`];
  const password = process.env[`PREVIEW_${audience}_PASSWORD`];
  if (!username && !password) return null;
  if (!username || !password || url.protocol !== 'https:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Preview smoke credentials require a complete login and a loopback HTTPS origin.');
  }
  return { username, password };
}

export function previewBrowserOptions(origin) {
  const login = credentials(origin, 'APP');
  return login ? { httpCredentials: { ...login, origin: origin.origin }, ignoreHTTPSErrors: true } : {};
}

export function previewMailboxHeaders(origin) {
  const login = credentials(origin, 'MAIL');
  return login ? { Authorization: 'Basic ' + Buffer.from(login.username + ':' + login.password).toString('base64') } : {};
}
