import { $, h } from '../core/dom.js';
import { currentUser, signOut } from '../core/auth.js';
import { applyTheme, toggleTheme } from '../core/ui.js';

/** Fills the server-rendered topbar's right side with auth state + theme toggle. */
export async function initNav() {
  applyTheme();
  const slot = $('#navSide');
  if (!slot) return;
  const themeBtn = h('button', { class: 'btn ghost small', type: 'button', onclick: toggleTheme, 'aria-label': 'Toggle dark mode' }, 'Theme');
  slot.replaceChildren(themeBtn);
  const user = await currentUser();
  if (user) {
    slot.prepend(
      h('span', { class: 'muted', title: user.email }, user.email.length > 22 ? user.email.slice(0, 20) + '...' : user.email),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { signOut(); location.assign('/'); } }, 'Sign out'),
    );
  } else {
    slot.prepend(h('a', { class: 'btn small', href: '/login?next=' + encodeURIComponent(location.pathname) }, 'Sign in'));
  }
}
