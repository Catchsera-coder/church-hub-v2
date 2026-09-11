<script lang="ts">
  import { onMount } from 'svelte';
  import * as QRCode from 'qrcode';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { auth, setSession } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  const forced = $derived(!!($auth.user as { mustChangePassword?: boolean } | null)?.mustChangePassword);

  // ---- Password change -----------------------------------------------------
  let curPw = $state('');
  let newPw = $state('');
  let confPw = $state('');
  let pwBusy = $state(false);
  let pwDone = $state(false);
  let pwError = $state('');
  async function changePassword(e: Event) {
    e.preventDefault(); pwError = ''; pwDone = false;
    if (newPw.length < 10) { pwError = tr({ en: 'Use at least 10 characters.', ar: 'استخدم 10 أحرف على الأقل.' }, $locale); return; }
    if (newPw !== confPw) { pwError = tr({ en: 'New passwords do not match.', ar: 'كلمتا المرور غير متطابقتين.' }, $locale); return; }
    pwBusy = true;
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }) });
      setSession({ user: { ...($auth.user as object), mustChangePassword: false } as any });
      curPw = ''; newPw = ''; confPw = ''; pwDone = true;
    } catch (err) { pwError = err instanceof ApiError ? err.message : (err as Error).message; }
    finally { pwBusy = false; }
  }

  // ---- Two-factor authentication -------------------------------------------
  type View = 'loading' | 'off' | 'setup' | 'codes' | 'on';
  let view = $state<View>('loading');
  let recoveryRemaining = $state(0);
  let busy = $state(false);
  let error = $state('');
  let secret = $state('');
  let qr = $state('');
  let code = $state('');
  let recoveryCodes = $state<string[]>([]);
  let disableCode = $state('');

  async function loadStatus() {
    try {
      const r = await api<{ data: { enabled: boolean; recoveryRemaining: number } }>('/auth/mfa/status');
      recoveryRemaining = r.data.recoveryRemaining;
      view = r.data.enabled ? 'on' : 'off';
    } catch { view = 'off'; }
  }
  onMount(loadStatus);

  async function beginSetup() {
    busy = true; error = '';
    try {
      const r = await api<{ data: { secret: string; otpauthUri: string } }>('/auth/mfa/setup', { method: 'POST', body: '{}' });
      secret = r.data.secret;
      try { qr = await QRCode.toDataURL(r.data.otpauthUri, { width: 220, margin: 1 }); } catch { qr = ''; }
      code = ''; view = 'setup';
    } catch (err) { error = err instanceof ApiError ? err.message : (err as Error).message; }
    finally { busy = false; }
  }
  async function enable() {
    busy = true; error = '';
    try {
      const r = await api<{ data: { recoveryCodes: string[] } }>('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
      recoveryCodes = r.data.recoveryCodes; view = 'codes';
    } catch (err) { error = err instanceof ApiError ? err.message : (err as Error).message; }
    finally { busy = false; }
  }
  async function regenerate() {
    if (!confirm(tr({ en: 'Generate a new set of recovery codes? Your old codes stop working.', ar: 'إنشاء مجموعة جديدة من رموز الاسترداد؟ ستتوقف الرموز القديمة عن العمل.' }, $locale))) return;
    busy = true; error = '';
    try {
      const r = await api<{ data: { recoveryCodes: string[] } }>('/auth/mfa/recovery', { method: 'POST', body: '{}' });
      recoveryCodes = r.data.recoveryCodes; view = 'codes';
    } catch (err) { error = err instanceof ApiError ? err.message : (err as Error).message; }
    finally { busy = false; }
  }
  async function disable() {
    busy = true; error = '';
    try {
      await api('/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ code: disableCode.trim() }) });
      disableCode = ''; await loadStatus();
    } catch (err) { error = err instanceof ApiError ? err.message : (err as Error).message; }
    finally { busy = false; }
  }
  function copyCodes() { try { navigator.clipboard.writeText(recoveryCodes.join('\n')); } catch { /* ignore */ } }
  function downloadCodes() {
    const blob = new Blob([`Church Hub recovery codes\n\n${recoveryCodes.join('\n')}\n\nKeep these safe. Each code works once.`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'church-hub-recovery-codes.txt'; a.click(); URL.revokeObjectURL(url);
  }
</script>

<PageHeader title={tr({ en: 'Security', ar: 'الأمان' }, $locale)} />
<PageHint id="security" text={{ en: 'Manage your own account security here — your password and two-factor authentication (2FA). A strong password plus 2FA is the best protection: even a stolen password can’t get in without your second step.', ar: 'أدر أمان حسابك هنا — كلمة المرور والمصادقة الثنائية. كلمة مرور قوية مع المصادقة الثنائية هي أفضل حماية.' }} />

<div class="mx-auto max-w-xl space-y-6">
  {#if forced}
    <div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
      {tr({ en: 'For your security, please set a new password below before continuing.', ar: 'من أجل أمانك، يرجى تعيين كلمة مرور جديدة أدناه قبل المتابعة.' }, $locale)}
    </div>
  {/if}

  <!-- Password -->
  <form class="card space-y-4 p-6" onsubmit={changePassword}>
    <h2 class="font-semibold">🔑 {tr({ en: 'Password', ar: 'كلمة المرور' }, $locale)}</h2>
    {#if pwDone}<p class="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{tr({ en: 'Password updated.', ar: 'تم تحديث كلمة المرور.' }, $locale)}</p>{/if}
    {#if pwError}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{pwError}</p>{/if}
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Current password', ar: 'كلمة المرور الحالية' }, $locale)}</span>
      <input class="input force-ltr" type="password" bind:value={curPw} required autocomplete="current-password" />
    </label>
    <div class="grid gap-4 sm:grid-cols-2">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'New password', ar: 'كلمة المرور الجديدة' }, $locale)}</span>
        <input class="input force-ltr" type="password" bind:value={newPw} required autocomplete="new-password" />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Confirm new password', ar: 'تأكيد كلمة المرور' }, $locale)}</span>
        <input class="input force-ltr" type="password" bind:value={confPw} required autocomplete="new-password" />
      </label>
    </div>
    <p class="text-xs text-slate-400">{tr({ en: 'At least 10 characters. Avoid common words and don’t reuse a password from another site.', ar: 'ما لا يقل عن 10 أحرف. تجنّب الكلمات الشائعة ولا تُعِد استخدام كلمة مرور من موقع آخر.' }, $locale)}</p>
    <button class="btn-primary" type="submit" disabled={pwBusy}>{pwBusy ? $t('common.loading') : tr({ en: 'Update password', ar: 'تحديث كلمة المرور' }, $locale)}</button>
  </form>

  <!-- Two-factor authentication -->
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}

  {#if view === 'loading'}
    <div class="card p-6 text-slate-400">{$t('common.loading')}</div>
  {:else if view === 'off'}
    <div class="card p-6">
      <h2 class="font-semibold">🔐 {tr({ en: 'Two-factor authentication', ar: 'المصادقة الثنائية' }, $locale)}</h2>
      <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'Currently off. Turn it on to protect your account with a second step at sign-in.', ar: 'غير مفعّلة حالياً. فعّلها لحماية حسابك بخطوة ثانية عند تسجيل الدخول.' }, $locale)}</p>
      <button class="btn-primary mt-4" disabled={busy} onclick={beginSetup}>{tr({ en: 'Set up 2FA', ar: 'إعداد المصادقة الثنائية' }, $locale)}</button>
    </div>
  {:else if view === 'setup'}
    <div class="card space-y-4 p-6">
      <h2 class="font-semibold">🔐 {tr({ en: 'Scan with your authenticator app', ar: 'امسح بتطبيق المصادقة' }, $locale)}</h2>
      <ol class="list-inside list-decimal space-y-1 text-sm text-slate-600 dark:text-slate-300">
        <li>{tr({ en: 'Open your authenticator app (Google Authenticator, Microsoft Authenticator, Authy…) and add a new account.', ar: 'افتح تطبيق المصادقة وأضف حساباً جديداً.' }, $locale)}</li>
        <li>{tr({ en: 'Scan this QR code (or enter the key manually).', ar: 'امسح رمز QR (أو أدخل المفتاح يدوياً).' }, $locale)}</li>
        <li>{tr({ en: 'Enter the 6-digit code it shows to finish.', ar: 'أدخل الرمز المكوّن من 6 أرقام لإنهاء الإعداد.' }, $locale)}</li>
      </ol>
      <div class="flex flex-col items-center gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
        {#if qr}<img src={qr} alt="QR" class="h-52 w-52 rounded-lg bg-white p-2" />{/if}
        <div class="text-center">
          <div class="text-xs text-slate-500">{tr({ en: 'Or enter this key manually', ar: 'أو أدخل هذا المفتاح يدوياً' }, $locale)}</div>
          <code class="force-ltr select-all break-all text-sm font-semibold tracking-wider text-slate-700 dark:text-slate-200">{secret}</code>
        </div>
      </div>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: '6-digit code', ar: 'الرمز المكوّن من 6 أرقام' }, $locale)}</span>
        <input class="input force-ltr tracking-widest" inputmode="numeric" maxlength="6" bind:value={code} placeholder="000000" />
      </label>
      <div class="flex gap-2">
        <button class="btn-primary" disabled={busy || code.trim().length < 6} onclick={enable}>{tr({ en: 'Verify & turn on', ar: 'تحقّق وفعّل' }, $locale)}</button>
        <button class="btn-ghost" disabled={busy} onclick={() => (view = 'off')}>{$t('common.cancel')}</button>
      </div>
    </div>
  {:else if view === 'codes'}
    <div class="card space-y-4 p-6">
      <h2 class="font-semibold">✅ {tr({ en: 'Save your recovery codes', ar: 'احفظ رموز الاسترداد' }, $locale)}</h2>
      <p class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Store these somewhere safe. Each code works once and lets you sign in if you lose your phone. This is the only time they’re shown.', ar: 'احتفظ بها في مكان آمن. كل رمز يعمل مرة واحدة ويتيح لك الدخول إذا فقدت هاتفك. هذه هي المرة الوحيدة التي تُعرض فيها.' }, $locale)}</p>
      <div class="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
        {#each recoveryCodes as c}<code class="force-ltr select-all text-center text-sm font-semibold tracking-wider text-slate-700 dark:text-slate-200">{c}</code>{/each}
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-ghost border border-slate-300 dark:border-slate-700" onclick={copyCodes}>📋 {tr({ en: 'Copy', ar: 'نسخ' }, $locale)}</button>
        <button class="btn-ghost border border-slate-300 dark:border-slate-700" onclick={downloadCodes}>⬇ {tr({ en: 'Download', ar: 'تنزيل' }, $locale)}</button>
        <button class="btn-primary ms-auto" onclick={loadStatus}>{tr({ en: 'Done — I saved them', ar: 'تم — حفظتها' }, $locale)}</button>
      </div>
    </div>
  {:else if view === 'on'}
    <div class="card space-y-4 p-6">
      <div class="flex items-center gap-2">
        <span class="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">✅ {tr({ en: 'Two-factor is ON', ar: 'المصادقة الثنائية مفعّلة' }, $locale)}</span>
      </div>
      <p class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'You’ll enter a code from your authenticator app when you sign in.', ar: 'ستُدخل رمزاً من تطبيق المصادقة عند تسجيل الدخول.' }, $locale)} · {recoveryRemaining} {tr({ en: 'recovery codes left', ar: 'رموز استرداد متبقية' }, $locale)}</p>
      <div class="flex flex-wrap gap-2">
        <button class="btn-ghost border border-slate-300 dark:border-slate-700" disabled={busy} onclick={regenerate}>🔄 {tr({ en: 'New recovery codes', ar: 'رموز استرداد جديدة' }, $locale)}</button>
      </div>
      <div class="border-t border-slate-200 pt-4 dark:border-slate-700">
        <p class="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">{tr({ en: 'Turn off 2FA', ar: 'إيقاف المصادقة الثنائية' }, $locale)}</p>
        <div class="flex flex-wrap gap-2">
          <input class="input force-ltr w-40 tracking-widest" inputmode="numeric" maxlength="9" bind:value={disableCode} placeholder={tr({ en: 'code or recovery', ar: 'رمز أو استرداد' }, $locale)} />
          <button class="rounded-md border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300" disabled={busy || disableCode.trim().length < 6} onclick={disable}>{tr({ en: 'Turn off', ar: 'إيقاف' }, $locale)}</button>
        </div>
        <p class="mt-1 text-xs text-slate-400">{tr({ en: 'Enter a current authenticator code (or a recovery code) to confirm.', ar: 'أدخل رمزاً حالياً من التطبيق (أو رمز استرداد) للتأكيد.' }, $locale)}</p>
      </div>
    </div>
  {/if}
</div>
