<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';

  let orgName = $state<Record<string, string> | null>(null);
  let logo = $state<string | null>(null);
  let token = $state('');
  let pass = $state('');
  let confirm = $state('');
  let busy = $state(false);
  let error = $state('');
  let done = $state(false);

  onMount(async () => {
    token = $page.url.searchParams.get('token') ?? '';
    try {
      const r = await api<{ data: { name: Record<string, string>; logoPath?: string | null } }>('/settings');
      orgName = r.data.name;
      if (r.data.logoPath) logo = r.data.logoPath;
    } catch { /* branding optional */ }
  });

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    if (!token) { error = tr({ en: 'This link is missing its invitation code.', ar: 'هذا الرابط تنقصه رموز الدعوة.' }, $locale); return; }
    if (pass.length < 8) { error = tr({ en: 'Use at least 8 characters.', ar: 'استخدم 8 أحرف على الأقل.' }, $locale); return; }
    if (pass !== confirm) { error = tr({ en: 'Passwords do not match.', ar: 'كلمتا المرور غير متطابقتين.' }, $locale); return; }
    busy = true;
    try {
      await api('/auth/accept-invite', { method: 'POST', body: JSON.stringify({ token, password: pass }) });
      done = true;
      setTimeout(() => goto('/login', { replaceState: true }), 1800);
    } catch (err) {
      error = err instanceof ApiError ? err.message : (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex min-h-full items-center justify-center px-4 py-12">
  <div class="w-full max-w-sm">
    <div class="mb-8 flex flex-col items-center text-center">
      {#if logo}<img src={logo} alt="" class="mb-4 h-20 w-20 object-contain" />{/if}
      <div class="font-display text-3xl font-bold tracking-tight text-primary-700 dark:text-primary-300">
        {orgName ? tr(orgName, $locale) : $t('app.name')}
      </div>
    </div>

    <form class="card space-y-4 p-6" onsubmit={submit}>
      <h1 class="text-lg font-semibold">{tr({ en: 'Welcome — set your password', ar: 'مرحباً — عيّن كلمة المرور' }, $locale)}</h1>
      {#if done}
        <p class="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          {tr({ en: 'All set! Taking you to sign in…', ar: 'تم! جارٍ نقلك لتسجيل الدخول…' }, $locale)}
        </p>
      {:else}
        <p class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Choose a password to activate your account and sign in to the hub.', ar: 'اختر كلمة مرور لتفعيل حسابك وتسجيل الدخول إلى المنصّة.' }, $locale)}</p>
        {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'New password', ar: 'كلمة المرور الجديدة' }, $locale)}</span>
          <input class="input force-ltr" type="password" bind:value={pass} required autocomplete="new-password" />
        </label>
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Confirm password', ar: 'تأكيد كلمة المرور' }, $locale)}</span>
          <input class="input force-ltr" type="password" bind:value={confirm} required autocomplete="new-password" />
        </label>
        <button class="btn-primary w-full" type="submit" disabled={busy}>{busy ? $t('common.loading') : tr({ en: 'Set password & continue', ar: 'حفظ ومتابعة' }, $locale)}</button>
      {/if}
      <a class="block w-full text-center text-sm text-primary-600 hover:underline dark:text-primary-300" href="/login">{tr({ en: 'Back to sign in', ar: 'العودة لتسجيل الدخول' }, $locale)}</a>
    </form>
  </div>
</div>
