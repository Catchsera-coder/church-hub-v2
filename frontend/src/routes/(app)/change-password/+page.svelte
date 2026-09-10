<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { auth, setSession } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  const forced = $derived(!!($auth.user as any)?.mustChangePassword);
  let current = $state('');
  let pass = $state('');
  let confirm = $state('');
  let busy = $state(false);
  let error = $state('');
  let done = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    if (pass.length < 8) { error = tr({ en: 'Use at least 8 characters.', ar: 'استخدم 8 أحرف على الأقل.' }, $locale); return; }
    if (pass !== confirm) { error = tr({ en: 'Passwords do not match.', ar: 'كلمتا المرور غير متطابقتين.' }, $locale); return; }
    busy = true;
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: pass }) });
      // Clear the forced-change flag locally so navigation is unblocked.
      setSession({ user: { ...($auth.user as any), mustChangePassword: false } });
      done = true;
      setTimeout(() => goto('/dashboard', { replaceState: true }), 1200);
    } catch (err) {
      error = err instanceof ApiError ? err.message : (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<PageHeader title={tr({ en: 'Change password', ar: 'تغيير كلمة المرور' }, $locale)} />

<div class="mx-auto max-w-md">
  {#if forced}
    <div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
      {tr({ en: 'For your security, please set your own password before continuing.', ar: 'من أجل أمانك، يرجى تعيين كلمة مرور خاصة بك قبل المتابعة.' }, $locale)}
    </div>
  {/if}
  <form class="card space-y-4 p-6" onsubmit={submit}>
    {#if done}
      <p class="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{tr({ en: 'Password updated.', ar: 'تم تحديث كلمة المرور.' }, $locale)}</p>
    {:else}
      {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Current password', ar: 'كلمة المرور الحالية' }, $locale)}</span>
        <input class="input force-ltr" type="password" bind:value={current} required autocomplete="current-password" />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'New password', ar: 'كلمة المرور الجديدة' }, $locale)}</span>
        <input class="input force-ltr" type="password" bind:value={pass} required autocomplete="new-password" />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Confirm new password', ar: 'تأكيد كلمة المرور الجديدة' }, $locale)}</span>
        <input class="input force-ltr" type="password" bind:value={confirm} required autocomplete="new-password" />
      </label>
      <button class="btn-primary w-full" type="submit" disabled={busy}>{busy ? $t('common.loading') : tr({ en: 'Update password', ar: 'تحديث كلمة المرور' }, $locale)}</button>
    {/if}
  </form>
</div>
