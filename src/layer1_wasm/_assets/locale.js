export function localeCounterpartPath(pathname, siteBase) {
  if (!pathname.startsWith(siteBase)) return null;

  let rest = pathname.slice(siteBase.length);
  const isJa = rest === 'ja' || rest.startsWith('ja/');
  if (isJa) rest = rest.slice(3);

  const m = /^repro\/([^_/][^/]*)\/([^/]+)(?:\/(?:index\.html)?)?$/.exec(rest);
  if (!m) return null;

  const tail = `repro/${m[1]}/${m[2]}/`;
  return isJa ? `${siteBase}${tail}` : `${siteBase}ja/${tail}`;
}
