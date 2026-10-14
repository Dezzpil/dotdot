import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import type { Lang } from './api';

const ru = {
  skip: 'К содержимому',
  langLabel: 'Язык',
  themeToLight: 'Светлая тема',
  themeToDark: 'Тёмная тема',

  heroTitle: 'Превратим рисунок в игру «соедини точки»',
  heroLead:
    'Загрузите чёрно-белую раскраску или контурный рисунок. DotDot расставит и пронумерует точки и соберёт PDF на A4 — останется только распечатать и взять карандаш.',
  stepUpload: 'Загрузите рисунок',
  stepLevel: 'Выберите, для кого',
  stepPrint: 'Распечатайте и соединяйте',

  dropTitle: 'Перетащите картинку сюда',
  dropOr: 'или',
  dropPick: 'выберите файл',
  dropHint: (mb: number) => `PNG, JPG, WebP, BMP или GIF до ${mb} МБ. Можно вставить из буфера: Ctrl+V`,
  dropActive: 'Отпускайте — поймаем',
  trySample: 'Нет картинки под рукой? Попробуйте на рыбке',
  sampleName: 'рыбка.png',
  tipsTitle: 'Лучше всего получаются',
  tips: ['чёткие чёрные линии на белом фоне', 'раскраски и простые контурные рисунки', 'без мелкой штриховки и теней'],

  yourDrawing: 'Ваш рисунок',
  replace: 'Заменить',
  forWhom: 'Для кого рисунок?',
  levels: {
    kid: { name: 'Малыш', age: '4–6 лет', hint: 'до 50 крупных точек, только контур' },
    school: { name: 'Школьник', age: '7–10 лет', hint: 'около 150 точек, всё точками' },
    adult: { name: 'Взрослый', age: '11+', hint: '300 точек и больше, мелкие детали' },
  },
  more: 'Тонкая настройка',
  modeTitle: 'Что превратить в точки',
  modes: { auto: 'Как задумано для уровня', all: 'Весь рисунок', outline: 'Только контур, детали линиями' },
  numberingTitle: 'Нумерация',
  numberings: { jumps: 'Одна цепочка с «прыжками»', series: 'Отдельные серии: A1, B1…' },
  labelsTitle: 'Подписи у точек',
  labelsOpts: { numbers: 'Числа', math: 'Примеры: 2+3' },
  pdfLangTitle: 'Язык листа',
  pdfLangs: { ru: 'Русский', en: 'English' },
  go: 'Расставить точки',
  sending: 'Отправляем…',

  queuedTitle: 'Рисунок в очереди',
  queuedPos: (n: number) => `Перед вами ${n === 1 ? 'никого — вы следующий' : `${n - 1} ${plural(n - 1, 'рисунок', 'рисунка', 'рисунков')}`}`,
  queuedWait: 'Скоро начнём, обычно это пара секунд',
  processingTitle: 'Расставляем точки',
  funFacts: [
    'Точка 1 всегда наверху — так проще начать',
    'Считаем точки без пропусков',
    'Подписываем так, чтобы цифры не налезали друг на друга',
    'Собираем лист с заданием и лист с ответом',
  ],
  progressLabel: 'Готовность',

  doneTitle: 'Готово',
  doneLead: (dots: number) => `${dots} ${plural(dots, 'точка ждёт', 'точки ждут', 'точек ждут')} карандаша.`,
  tabPuzzle: 'Задание',
  tabAnswer: 'Ответ',
  openFull: 'Открыть в полном размере',
  statDots: 'точек',
  statLines: (n: number) => plural(n, 'линия', 'линии', 'линий'),
  statLinesHint: 'новая линия начинается с кружка',
  download: 'Скачать PDF',
  downloadHint: 'два листа A4: задание и ответ',
  again: 'Другой уровень',
  newDrawing: 'Новый рисунок',
  keptFor: (h: number) => `Рисунок и результат хранятся ${h} ч, потом удаляются сами.`,

  failTitle: 'Не получилось',
  tryAgain: 'Попробовать ещё раз',
  pickAnother: 'Выбрать другой рисунок',
  backHome: 'На главную',

  errors: {
    NO_FILE: 'Сначала выберите картинку.',
    FILE_TOO_LARGE: (mb: number) => `Файл великоват. Подойдёт картинка до ${mb} МБ.`,
    UNSUPPORTED_TYPE: 'Этот формат мы пока не понимаем. Подойдут PNG, JPG, WebP, BMP или GIF.',
    BAD_IMAGE: 'Не получилось разглядеть линии. Лучше всего подходят чёткие чёрные контуры на белом фоне.',
    BAD_OPTIONS: 'Что-то не так с настройками. Обновите страницу и попробуйте ещё раз.',
    BUSY: 'Сейчас очень много рисунков. Попробуйте через минуту — мы никуда не денемся.',
    RATE_LIMITED: (sec?: number) =>
      sec ? `Много рисунков подряд. Передохните ${sec} ${plural(sec, 'секунду', 'секунды', 'секунд')} и продолжим.` : 'Много рисунков подряд. Передохните минутку и продолжим.',
    NOT_FOUND: 'Такой рисунок не нашёлся. Результаты хранятся сутки, этот, наверное, уже удалился.',
    TIMEOUT: 'Рисунок оказался очень сложным. Попробуйте уровень попроще или картинку с меньшим числом деталей.',
    NETWORK: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
    INTERNAL: 'Что-то сломалось на нашей стороне. Попробуйте ещё раз, обычно помогает.',
  },

  donateTitle: 'Понравилось?',
  donateLead: 'DotDot бесплатный и без рекламы. Если хочется сказать спасибо — можно угостить Dottie чаем.',
  donateFooter: 'Поддержать',
  footerNote: 'Открытый проект',
};

type Dict = typeof ru;

const en: Dict = {
  skip: 'Skip to content',
  langLabel: 'Language',
  themeToLight: 'Light theme',
  themeToDark: 'Dark theme',

  heroTitle: 'Turn a drawing into a connect-the-dots game',
  heroLead:
    'Upload a black-and-white colouring page or line drawing. DotDot places and numbers the dots and builds an A4 PDF — just print it and grab a pencil.',
  stepUpload: 'Upload a drawing',
  stepLevel: 'Pick who it’s for',
  stepPrint: 'Print and connect',

  dropTitle: 'Drop a picture here',
  dropOr: 'or',
  dropPick: 'choose a file',
  dropHint: (mb: number) => `PNG, JPG, WebP, BMP or GIF up to ${mb} MB. You can also paste with Ctrl+V`,
  dropActive: 'Let go — we’ve got it',
  trySample: 'No picture at hand? Try the fish',
  sampleName: 'fish.png',
  tipsTitle: 'Works best with',
  tips: ['crisp black lines on white', 'colouring pages and simple line art', 'no fine hatching or shading'],

  yourDrawing: 'Your drawing',
  replace: 'Replace',
  forWhom: 'Who is it for?',
  levels: {
    kid: { name: 'Little one', age: 'ages 4–6', hint: 'up to 50 big dots, outline only' },
    school: { name: 'Schoolkid', age: 'ages 7–10', hint: 'about 150 dots, everything dotted' },
    adult: { name: 'Grown-up', age: '11+', hint: '300+ dots, fine details' },
  },
  more: 'Fine-tune',
  modeTitle: 'What becomes dots',
  modes: { auto: 'Best for the level', all: 'The whole drawing', outline: 'Outline only, details as lines' },
  numberingTitle: 'Numbering',
  numberings: { jumps: 'One chain with “jumps”', series: 'Separate series: A1, B1…' },
  labelsTitle: 'Dot labels',
  labelsOpts: { numbers: 'Numbers', math: 'Sums: 2+3' },
  pdfLangTitle: 'Sheet language',
  pdfLangs: { ru: 'Русский', en: 'English' },
  go: 'Place the dots',
  sending: 'Sending…',

  queuedTitle: 'Your drawing is in line',
  queuedPos: (n: number) => (n === 1 ? 'Nobody ahead — you’re next' : `${n - 1} drawing${n - 1 === 1 ? '' : 's'} ahead of you`),
  queuedWait: 'Starting soon, usually a couple of seconds',
  processingTitle: 'Placing the dots',
  funFacts: [
    'Dot 1 always sits at the top — easier to start',
    'Counting dots without skipping any',
    'Placing numbers so they never overlap',
    'Building a puzzle sheet and an answer sheet',
  ],
  progressLabel: 'Progress',

  doneTitle: 'Done',
  doneLead: (dots: number) => (dots === 1 ? '1 dot is waiting for a pencil.' : `${dots} dots are waiting for a pencil.`),
  tabPuzzle: 'Puzzle',
  tabAnswer: 'Answer',
  openFull: 'Open full size',
  statDots: 'dots',
  statLines: (n: number) => (n === 1 ? 'line' : 'lines'),
  statLinesHint: 'a ring marks where a new line starts',
  download: 'Download PDF',
  downloadHint: 'two A4 sheets: puzzle and answer',
  again: 'Another level',
  newDrawing: 'New drawing',
  keptFor: (h: number) => `Your drawing and result are kept for ${h} h, then deleted automatically.`,

  failTitle: 'That didn’t work',
  tryAgain: 'Try again',
  pickAnother: 'Pick another drawing',
  backHome: 'Back to start',

  errors: {
    NO_FILE: 'Choose a picture first.',
    FILE_TOO_LARGE: (mb: number) => `That file is a bit big. Pictures up to ${mb} MB work.`,
    UNSUPPORTED_TYPE: 'We can’t read this format yet. PNG, JPG, WebP, BMP or GIF will do.',
    BAD_IMAGE: 'We couldn’t make out the lines. Crisp black outlines on white work best.',
    BAD_OPTIONS: 'Something is off with the settings. Reload the page and try again.',
    BUSY: 'Lots of drawings right now. Try again in a minute — we’ll be here.',
    RATE_LIMITED: (sec?: number) =>
      sec ? `That’s a lot of drawings in a row. Take a ${sec}-second break and carry on.` : 'That’s a lot of drawings in a row. Take a short break and carry on.',
    NOT_FOUND: 'We couldn’t find this drawing. Results are kept for a day, so this one has probably expired.',
    TIMEOUT: 'This drawing turned out very complex. Try an easier level or a picture with fewer details.',
    NETWORK: 'Can’t reach the server. Check your connection and try again.',
    INTERNAL: 'Something broke on our side. Trying again usually helps.',
  },

  donateTitle: 'Enjoyed it?',
  donateLead: 'DotDot is free and ad-free. If you’d like to say thanks, you can buy Dottie a cup of tea.',
  donateFooter: 'Support',
  footerNote: 'Open-source project',
};

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const DICTS: Record<Lang, Dict> = { ru, en };
export type { Dict };

export function detectLang(): Lang {
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (fromUrl === 'ru' || fromUrl === 'en') return fromUrl;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => /^(ru|be|uk|kk)\b/i.test(l ?? '')) ? 'ru' : 'en';
}

interface I18n {
  lang: Lang;
  t: Dict;
  setLang: (l: Lang) => void;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLang] = useState<Lang>(() => initial ?? detectLang());
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === 'ru' ? 'DotDot — рисунок по точкам из любой картинки' : 'DotDot — connect-the-dots from any drawing';
  }, [lang]);
  const value = useMemo(() => ({ lang, t: DICTS[lang], setLang }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}

export function errorText(t: Dict, code: string, ctx: { maxUploadMb: number; retryAfterSec?: number }): string {
  const e = t.errors;
  switch (code) {
    case 'FILE_TOO_LARGE':
      return e.FILE_TOO_LARGE(ctx.maxUploadMb);
    case 'RATE_LIMITED':
      return e.RATE_LIMITED(ctx.retryAfterSec);
    case 'NO_FILE':
    case 'UNSUPPORTED_TYPE':
    case 'BAD_IMAGE':
    case 'BAD_OPTIONS':
    case 'BUSY':
    case 'NOT_FOUND':
    case 'TIMEOUT':
    case 'NETWORK':
      return e[code];
    default:
      return e.INTERNAL;
  }
}
