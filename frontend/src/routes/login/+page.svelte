<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api.js';
  import { setSession, isAuthed } from '$lib/stores/auth.js';
  import { t, locale, tr, LOCALES, type Locale } from '$lib/i18n.js';

  let email = $state('');
  let password = $state('');
  let submitting = $state(false);
  let error = $state('');
  let orgName = $state<Record<string, string> | null>(null);

  onMount(async () => {
    if (isAuthed()) return goto('/dashboard', { replaceState: true });
    try {
      const r = await api<{ data: { name: Record<string, string> } }>('/settings');
      orgName = r.data.name;
    } catch {
      /* branding is optional on the login screen */
    }
  });

  async function submit(e: Event) {
    e.preventDefault();
    submitting = true;
    error = '';
    try {
      const r = await api<{ accessToken: string; refreshToken: string; roles: string[]; perms: string[]; user: any }>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify({ email, password }) },
      );
      setSession(r);
      await goto('/dashboard', { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError && err.status === 401 ? $t('auth.invalid') : (err as Error).message;
    } finally {
      submitting = false;
    }
  }
</script>

<div class="flex min-h-full items-center justify-center px-4 py-12">
  <div class="w-full max-w-sm">
    <div class="mb-6 flex items-center justify-between">
      <div class="font-display text-2xl font-semibold text-primary-700 dark:text-primary-300">
        {orgName ? tr(orgName, $locale) : $t('app.name')}
      </div>
      <select
        class="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
        value={$locale}
        onchange={(e) => locale.set((e.currentTarget as HTMLSelectElement).value as Locale)}
      >
        {#each LOCALES as l}
          <option value={l.code}>{l.native}</option>
        {/each}
      </select>
    </div>

    <form class="card space-y-4 p-6" onsubmit={submit}>
      <h1 class="text-lg font-semibold">{$t('auth.signin')}</h1>

      {#if error}
        <p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>
      {/if}

      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{$t('auth.email')}</span>
        <input class="input force-ltr" type="email" bind:value={email} required autocomplete="username" />
      </label>

      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{$t('auth.password')}</span>
        <input class="input force-ltr" type="password" bind:value={password} required autocomplete="current-password" />
      </label>

      <button class="btn-primary w-full" type="submit" disabled={submitting}>
        {submitting ? $t('auth.signing_in') : $t('auth.signin')}
      </button>
    </form>
  </div>
</div>
