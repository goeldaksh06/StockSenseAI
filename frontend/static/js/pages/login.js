import { $, h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { currentUser, signIn, safeNext } from '../core/auth.js';
import { segmented } from '../components/table.js';

const next = safeNext(new URLSearchParams(location.search).get('next'));

// Already signed in: skip the form.
if (await currentUser()) location.replace(next);

let mode = 'login';
const form = $('#form'), msg = $('#msg'), submit = $('#submit'), hint = $('#hint'), heading = $('#heading');
const pw = form.elements.password;

function setMode(m) {
  mode = m;
  const reg = m === 'register';
  heading.textContent = reg ? 'Create account' : 'Sign in';
  submit.textContent = reg ? 'Create account' : 'Sign in';
  hint.hidden = !reg;
  pw.autocomplete = reg ? 'new-password' : 'current-password';
  msg.textContent = '';
}

mount($('#mode'), segmented([{ label: 'Sign in', value: 'login' }, { label: 'Create account', value: 'register' }], mode, setMode, 'Mode'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  const email = form.elements.email.value.trim();
  const password = pw.value;
  if (!email || !password) { msg.textContent = 'Enter your email and password.'; return; }
  if (mode === 'register' && password.length < 8) { msg.textContent = 'Password must be at least 8 characters.'; return; }
  submit.disabled = true;
  try {
    const res = mode === 'register' ? await api.register(email, password) : await api.login(email, password);
    signIn(res.access_token);
    location.assign(next);
  } catch (err) {
    msg.textContent = err.status === 429 ? 'Too many attempts. Wait a minute and try again.' : err.message;
    submit.disabled = false;
  }
});

