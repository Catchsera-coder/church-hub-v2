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

  // Forgot-password panel (email → code → new password)
  let mode = $state<'signin' | 'forgot' | 'mfa'>('signin');

  // MFA second step (after the password checks out)
  let mfaChallenge = $state('');
  let mfaMethods = $state<{ totp?: boolean; email?: boolean; recovery?: boolean }>({});
  let mfaCode = $state('');
  let mfaBusy = $state(false);
  let mfaError = $state('');
  let mfaEmailSent = $state(false);
  let fStep = $state<'email' | 'code'>('email');
  let fEmail = $state('');
  let fCode = $state('');
  let fPass = $state('');
  let fConfirm = $state('');
  let fBusy = $state(false);
  let fError = $state('');
  let fDone = $state(false);

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
      const r = await api<any>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      // Second factor required — move to the MFA step instead of signing in.
      if (r.mfaRequired) {
        mfaChallenge = r.challengeToken; mfaMethods = r.methods ?? {};
        mfaCode = ''; mfaError = ''; mfaEmailSent = false; mode = 'mfa';
        submitting = false; return;
      }
      setSession(r);
      // A member whose password was set by an admin (or otherwise flagged) must
      // choose their own before continuing.
      await goto(r.user?.mustChangePassword ? '/change-password' : '/dashboard', { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError && err.status === 401 ? $t('auth.invalid') : (err as Error).message;
    } finally {
      submitting = false;
    }
  }

  async function verifyMfa(e: Event) {
    e.preventDefault(); mfaBusy = true; mfaError = '';
    try {
      const r = await api<any>('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ challengeToken: mfaChallenge, code: mfaCode.trim() }) });
      setSession(r);
      await goto(r.user?.mustChangePassword ? '/change-password' : '/dashboard', { replaceState: true });
    } catch (err) { mfaError = err instanceof ApiError ? err.message : (err as Error).message; }
    finally { mfaBusy = false; }
  }
  async function sendMfaEmail() {
    mfaBusy = true; mfaError = '';
    try { await api('/auth/mfa/email-code', { method: 'POST', body: JSON.stringify({ challengeToken: mfaChallenge }) }); mfaEmailSent = true; }
    catch (err) { mfaError = err instanceof ApiError ? err.message : (err as Error).message; }
    finally { mfaBusy = false; }
  }

  function openForgot() {
    mode = 'forgot'; fStep = 'email'; fEmail = email; fCode = ''; fPass = ''; fConfirm = ''; fError = ''; fDone = false;
  }

  async function sendCode(e: Event) {
    e.preventDefault();
    fBusy = true; fError = '';
    try {
      await api('/auth/forgot', { method: 'POST', body: JSON.stringify({ email: fEmail }) });
      fStep = 'code'; // always advances (no account enumeration)
    } catch {
      fStep = 'code';
    } finally {
      fBusy = false;
    }
  }

  async function doReset(e: Event) {
    e.preventDefault();
    fError = '';
    if (fPass.length < 8) { fError = tr({ en: 'Use at least 8 characters.', ar: 'استخدم 8 أحرف على الأقل.' }, $locale); return; }
    if (fPass !== fConfirm) { fError = tr({ en: 'Passwords do not match.', ar: 'كلمتا المرور غير متطابقتين.' }, $locale); return; }
    fBusy = true;
    try {
      await api('/auth/reset', { method: 'POST', body: JSON.stringify({ email: fEmail, code: fCode.trim(), password: fPass }) });
      fDone = true;
      setTimeout(() => { mode = 'signin'; email = fEmail; }, 1500);
    } catch (err) {
      fError = err instanceof ApiError ? err.message : (err as Error).message;
    } finally {
      fBusy = false;
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
          onclick={openForgot}>
          {$t('auth.forgot')}
        </button>
      </form>
    {:else if mode === 'mfa'}
      <form class="card space-y-4 p-6" onsubmit={verifyMfa}>
        <h1 class="text-lg font-semibold">{tr({ en: 'Two-step verification', ar: 'التحقق بخطوتين' }, $locale)}</h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Enter the 6-digit code from your authenticator app to finish signing in.', ar: 'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة لإكمال تسجيل الدخول.' }, $locale)}</p>
        {#if mfaError}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{mfaError}</p>{/if}
        {#if mfaEmailSent}<p class="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{tr({ en: 'We emailed you a code — enter it above. It expires in 10 minutes.', ar: 'أرسلنا لك رمزاً بالبريد — أدخله بالأعلى. ينتهي خلال 10 دقائق.' }, $locale)}</p>{/if}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Verification code', ar: 'رمز التحقق' }, $locale)}</span>
          <input class="input force-ltr tracking-widest" bind:value={mfaCode} placeholder="000000" autocomplete="one-time-code" />
        </label>
        <button class="btn-primary w-full" type="submit" disabled={mfaBusy || mfaCode.trim().length < 6}>{mfaBusy ? $t('common.loading') : tr({ en: 'Verify', ar: 'تحقّق' }, $locale)}</button>
        {#if mfaMethods.email}
          <button type="button" class="w-full text-center text-sm text-primary-600 hover:underline dark:text-primary-300" onclick={sendMfaEmail} disabled={mfaBusy}>{tr({ en: 'Email me a code instead', ar: 'أرسل لي رمزاً بالبريد بدلاً من ذلك' }, $locale)}</button>
        {/if}
        <p class="text-center text-xs text-slate-400">{tr({ en: 'Lost your device? Enter one of your recovery codes above.', ar: 'فقدت جهازك؟ أدخل أحد رموز الاسترداد بالأعلى.' }, $locale)}</p>
        <button type="button" class="w-full text-center text-sm text-primary-600 hover:underline dark:text-primary-300" onclick={() => { mode = 'signin'; password = ''; }}>{$t('auth.back_to_signin')}</button>
      </form>
    {:else if fStep === 'email'}
      <form class="card space-y-4 p-6" onsubmit={sendCode}>
        <h1 class="text-lg font-semibold">{$t('auth.reset_title')}</h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">{$t('auth.forgot_prompt')}</p>
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{$t('auth.email')}</span>
          <input class="input force-ltr" type="email" bind:value={fEmail} required autocomplete="username" />
        </label>
        <button class="btn-primary w-full" type="submit" disabled={fBusy}>
          {fBusy ? $t('common.loading') : $t('auth.forgot_send')}
        </button>
        <button type="button" class="w-full text-center text-sm text-primary-600 hover:underline dark:text-primary-300"
          onclick={() => { mode = 'signin'; }}>{$t('auth.back_to_signin')}</button>
      </form>
    {:else}
      <form class="card space-y-4 p-6" onsubmit={doReset}>
        <h1 class="text-lg font-semibold">{$t('auth.reset_title')}</h1>
        {#if fDone}
          <p class="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{$t('auth.reset_done')}</p>
        {:else}
          <p class="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{$t('auth.forgot_sent')}</p>
          {#if fError}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{fError}</p>{/if}
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{$t('auth.code')}</span>
            <input class="input force-ltr tracking-widest" inputmode="numeric" bind:value={fCode} required placeholder="000000" />
          </label>
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{$t('auth.new_password')}</span>
            <input class="input force-ltr" type="password" bind:value={fPass} required autocomplete="new-password" />
          </label>
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{$t('auth.confirm_password')}</span>
            <input class="input force-ltr" type="password" bind:value={fConfirm} required autocomplete="new-password" />
          </label>
          <button class="btn-primary w-full" type="submit" disabled={fBusy}>
            {fBusy ? $t('common.loading') : $t('auth.reset_submit')}
          </button>
        {/if}
        <button type="button" class="w-full text-center text-sm text-primary-600 hover:underline dark:text-primary-300"
          onclick={() => { mode = 'signin'; }}>{$t('auth.back_to_signin')}</button>
      </form>
    {/if}
  </div>
</div>
