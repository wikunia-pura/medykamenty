import { useEffect } from 'react';

// Viewport gutter a grown modal keeps on each side (matches .modal-overlay padding).
const GUTTER = 24;

// Widen a modal until its body has no horizontal overflow (capped at the
// viewport). Never narrows an open modal, so switching between a wide and a
// narrow tab doesn't make it jump back and forth.
function fit(modal: HTMLElement) {
  const body = modal.querySelector<HTMLElement>('.modal-body');
  if (!body) return;
  const overflow = body.scrollWidth - body.clientWidth;
  if (overflow > 1) {
    const max = window.innerWidth - GUTTER * 2;
    const next = Math.min(max, Math.ceil(modal.getBoundingClientRect().width + overflow));
    if (next > modal.getBoundingClientRect().width + 0.5) modal.style.width = `${next}px`;
  }
  // The first fit happens before the modal is ever painted, so it opens at the
  // right width; only growth after that animates (see .modal[data-autowidth]).
  if (!modal.dataset.autowidth) {
    void modal.offsetWidth;
    modal.dataset.autowidth = 'ready';
  }
}

function fitAll() {
  document.querySelectorAll<HTMLElement>('.modal').forEach(fit);
}

// App-wide: modals size their width to their content instead of growing a
// horizontal scrollbar. Watches DOM changes (a modal opening, a tab switch, a
// row added) and window resizes. The MutationObserver callback runs as a
// microtask after React's commit, i.e. before paint.
export function useModalAutoWidth() {
  useEffect(() => {
    const mo = new MutationObserver(() => {
      if (document.querySelector('.modal')) fitAll();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    const onResize = () => fitAll();
    window.addEventListener('resize', onResize);
    return () => {
      mo.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);
}
