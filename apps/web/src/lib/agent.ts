/** "Chrome on macOS" from a user-agent string — enough to recognise a device in the session list. */
export function describeAgent(ua: string): string {
  const browser = /edg\//i.test(ua) ? 'Edge' : /opr\/|opera/i.test(ua) ? 'Opera' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Browser';
  const os = /iphone|ipad|ipod/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /mac os x|macintosh/i.test(ua) ? 'macOS' : /windows/i.test(ua) ? 'Windows' : /linux|x11/i.test(ua) ? 'Linux' : 'an unknown device';
  return `${browser} on ${os}`;
}
