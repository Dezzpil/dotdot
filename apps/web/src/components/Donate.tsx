import { Heart } from 'lucide-react';
import type { PublicConfig } from '../api';
import { useI18n } from '../i18n';
import { Dottie } from './Brand';

export function donateLinks(d: PublicConfig['donate'], lang: string) {
  const all: Array<[string, string | undefined]> = [
    ['CloudTips', d.cloudtips],
    ['Boosty', d.boosty],
    ['Ko-fi', d.kofi],
  ];
  const links = all.filter((x): x is [string, string] => !!x[1]);
  // Russian visitors see Russian platforms first, others see Ko-fi first
  return lang === 'ru' ? links : [...links].reverse();
}

export function Donate({ config }: { config: PublicConfig }) {
  const { t, lang } = useI18n();
  const links = donateLinks(config.donate, lang);
  if (!links.length) return null;
  return (
    <aside className="donate card" data-testid="card-donate">
      <Dottie size={56} />
      <div className="donate-text">
        <h2 className="h3">{t.donateTitle}</h2>
        <p>{t.donateLead}</p>
        <div className="donate-links">
          {links.map(([name, href]) => (
            <a key={name} href={href} target="_blank" rel="noopener noreferrer" className="btn-ghost" data-testid={`link-donate-${name.toLowerCase()}`}>
              <Heart size={16} aria-hidden="true" /> {name}
            </a>
          ))}
        </div>
      </div>
    </aside>
  );
}
