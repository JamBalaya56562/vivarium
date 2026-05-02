import './vivarium-footer.css';

type Lang = 'en' | 'ja';

const STRINGS = {
  en: {
    legal:
      '© 2026 aletheia-works · Open Source under Apache 2.0 · Built for the modern web.',
    github: 'GitHub',
    discord: 'Discord',
    changelog: 'Changelog',
    security: 'Security',
    privacy: 'Privacy',
    changelogHref: '/vivarium/roadmap',
  },
  ja: {
    legal:
      '© 2026 aletheia-works · Apache 2.0 のもとでオープンソース · モダンウェブのために。',
    github: 'GitHub',
    discord: 'Discord',
    changelog: '変更履歴',
    security: 'セキュリティ',
    privacy: 'プライバシー',
    changelogHref: '/vivarium/ja/roadmap',
  },
} as const;

export function VivariumFooter({ lang = 'en' }: { lang?: Lang } = {}) {
  const s = STRINGS[lang];
  return (
    <footer className="v-footer">
      <div className="v-footer__inner">
        <div className="v-footer__brand">
          <span className="v-footer__wordmark">VIVARIUM</span>
          <p className="v-footer__legal">{s.legal}</p>
        </div>
        <div className="v-footer__links">
          <a
            className="v-footer__link"
            href="https://github.com/aletheia-works/vivarium"
            target="_blank"
            rel="noreferrer"
          >
            {s.github}
          </a>
          <a className="v-footer__link" href="#">
            {s.discord}
          </a>
          <a className="v-footer__link" href={s.changelogHref}>
            {s.changelog}
          </a>
          <a
            className="v-footer__link"
            href="https://github.com/aletheia-works/vivarium/security"
            target="_blank"
            rel="noreferrer"
          >
            {s.security}
          </a>
          <a className="v-footer__link" href="#">
            {s.privacy}
          </a>
        </div>
      </div>
    </footer>
  );
}

export default VivariumFooter;
