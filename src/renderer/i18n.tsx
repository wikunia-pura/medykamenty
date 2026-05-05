import React, { createContext, useContext } from 'react';
import { translations, T } from './translations';
import type { Lang } from '../shared/types';

interface I18nContextValue {
  lang: Lang;
  t: T;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{
  lang: Lang;
  setLang: (lang: Lang) => void;
  children: React.ReactNode;
}> = ({ lang, setLang, children }) => {
  const value: I18nContextValue = {
    lang,
    t: translations[lang],
    setLang,
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useT(): T {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used inside I18nProvider');
  return ctx.t;
}

export function useLang(): Lang {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useLang must be used inside I18nProvider');
  return ctx.lang;
}

export function useSetLang(): (lang: Lang) => void {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useSetLang must be used inside I18nProvider');
  return ctx.setLang;
}
