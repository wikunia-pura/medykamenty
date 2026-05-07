import React, { createContext, useContext } from 'react';
import { useT } from './i18n';
import { IconChevronLeft, IconChevronRight } from './components/Icons';

interface NavigationContextValue {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export const NavigationProvider: React.FC<
  NavigationContextValue & { children: React.ReactNode }
> = ({ canGoBack, canGoForward, goBack, goForward, children }) => (
  <NavigationContext.Provider value={{ canGoBack, canGoForward, goBack, goForward }}>
    {children}
  </NavigationContext.Provider>
);

export const HeaderNav: React.FC = () => {
  const ctx = useContext(NavigationContext);
  const t = useT();
  if (!ctx) return null;
  const { canGoBack, canGoForward, goBack, goForward } = ctx;
  return (
    <div className="header-nav" role="group" aria-label={t.navHistory}>
      <button
        type="button"
        className="header-nav-btn"
        onClick={goBack}
        disabled={!canGoBack}
        title={`${t.navBack} (Alt+←)`}
        aria-label={t.navBack}
      >
        <IconChevronLeft size={14} />
      </button>
      <button
        type="button"
        className="header-nav-btn"
        onClick={goForward}
        disabled={!canGoForward}
        title={`${t.navForward} (Alt+→)`}
        aria-label={t.navForward}
      >
        <IconChevronRight size={14} />
      </button>
    </div>
  );
};
