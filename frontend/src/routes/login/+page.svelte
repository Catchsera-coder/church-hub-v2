<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api.js';
  import { setSession, isAuthed } from '$lib/stores/auth.js';
  import { t, locale, tr } from '$lib/i18n.js';

  let email = $state('');
  let password = $state('');
  let submitting = $state(false);
  let error = $state('');
  let orgName = $state<Record<string, string> | null>(null);
  // Only ever the church's OWN uploaded logo (Settings → Identity). No placeholder.
  let logo = $state<string | null>(null);

  // Forgot-password panel
  let mode = $state<'signin' | 'forgot'>('signin');
  let forgotEmail = $state('');
  let forgotSent = $state(false);
  let forgotBusy = $state(false);

  onMount(async () => {
    if (isAuthed()) return goto('/dashboard', { replaceState: true });
    try {
      const r = await api<{ data: { name: Record<string, string>; logoPath?: string | null } }>('/settings');
      orgName = r.data.name;
      if (r.data.logoPath) logo = r.data.logoPath;
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

  async function requestReset(e: Event) {
    e.preventDefault();
    forgotBusy = true;
    try {
      await api('/auth/forgot', { method: 'POST', body: JSON.stringify({ email: forgotEmail }) });
      forgotSent = true; // always succeeds (no account enumeration)
    } catch {
      forgotSent = true;
    } finally {
      forgotBusy = false;
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

    {#if mode === 'signin'}
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

        <button type="button" class="w-full text-center text-sm text-primary-600 hover:underline dark:text-primary-300"
          onclick={() => { mode = 'forgot'; forgotEmail = email; forgotSent = false; }}>
          {$t('auth.forgot')}
        </button>
      </form>
    {:else}
      <form class="card space-y-4 p-6" onsubmit={requestReset}>
        <h1 class="text-lg font-semibold">{$t('auth.reset_title')}</h1>
        {#if forgotSent}
          <p class="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            {$t('auth.forgot_sent')}
          </p>
        {:else}
          <p class="text-sm text-slate-600 dark:text-slate-300">{$t('auth.forgot_prompt')}</p>
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{$t('auth.email')}</span>
            <input class="input force-ltr" type="email" bind:value={forgotEmail} required autocomplete="username" />
          </label>
          <button class="btn-primary w-full" type="submit" disabled={forgotBusy}>
            {forgotBusy ? $t('common.loading') : $t('auth.forgot_send')}
          </button>
        {/if}
        <button type="button" class="w-full text-center text-sm text-primary-600 hover:underline dark:text-primary-300"
          onclick={() => { mode = 'signin'; }}>
          {$t('auth.back_to_signin')}
        </button>
      </form>
    {/if}
  </div>
</div>
