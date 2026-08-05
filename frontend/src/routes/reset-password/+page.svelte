<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';

  let token = $state('');
  let password = $state('');
  let confirm = $state('');
  let busy = $state(false);
  let error = $state('');
  let done = $state(false);

  onMount(() => {
    token = $page.url.searchParams.get('token') ?? '';
  });

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    if (password.length < 8) { error = tr({ en: 'Use at least 8 characters.', ar: 'استخدم 8 أحرف على الأقل.' }, $locale); return; }
    if (password !== confirm) { error = tr({ en: 'Passwords do not match.', ar: 'كلمتا المرور غير متطابقتين.' }, $locale); return; }
    busy = true;
    try {
      await api('/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
      done = true;
      setTimeout(() => goto('/login', { replaceState: true }), 1500);
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
      <img src="/logo.svg" alt="" class="mb-4 h-16 w-16" />
    </div>
    <form class="card space-y-4 p-6" onsubmit={submit}>
      <h1 class="text-lg font-semibold">{$t('auth.reset_title')}</h1>

      {#if done}
        <p class="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          {$t('auth.reset_done')}
        </p>
      {:else}
        {#if error}
          <p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>
        {/if}
        {#if !token}
          <p class="text-sm text-rose-600">{tr({ en: 'Missing reset token — use the link from your email.', ar: 'رمز إعادة التعيين مفقود — استخدم الرابط من بريدك.' }, $locale)}</p>
        {/if}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{$t('auth.new_password')}</span>
          <input class="input force-ltr" type="password" bind:value={password} required autocomplete="new-password" />
        </label>
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{$t('auth.confirm_password')}</span>
          <input class="input force-ltr" type="password" bind:value={confirm} required autocomplete="new-password" />
        </label>
        <button class="btn-primary w-full" type="submit" disabled={busy || !token}>
          {busy ? $t('common.loading') : $t('auth.reset_submit')}
        </button>
      {/if}
      <a class="block text-center text-sm text-primary-600 hover:underline dark:text-primary-300" href="/login">{$t('auth.back_to_signin')}</a>
    </form>
  </div>
</div>
