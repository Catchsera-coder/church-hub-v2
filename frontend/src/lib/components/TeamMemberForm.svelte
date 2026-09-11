<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';

  let { initial = null, id = null }: { initial?: any; id?: number | null } = $props();

  let allRoles = $state<any[]>([]);
  let form = $state({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    password: '',
    isActive: initial?.isActive ?? true,
    roleIds: [] as number[],
    sendInvite: true, // email them a set-your-password link on create
  });
  let error = $state('');
  let saving = $state(false);

  // Admin password reset (edit mode).
  let newPassword = $state('');
  let pwBusy = $state(false);
  let pwDone = $state(false);

  async function setPassword() {
    if (newPassword.length < 8) { error = tr({ en: 'Password must be at least 8 characters.', ar: 'كلمة المرور 8 أحرف على الأقل.' }, $locale); return; }
    pwBusy = true; pwDone = false; error = '';
    try {
      await api(`/team/${id}/set-password`, { method: 'POST', body: JSON.stringify({ password: newPassword }) });
      pwDone = true; newPassword = '';
    } catch (err) { error = (err as Error).message; } finally { pwBusy = false; }
  }

  // Admin force-reset of a locked-out user's two-factor auth.
  let mfaEnabled = $state(initial?.mfaEnabled ?? false);
  let mfaBusy = $state(false);
  let mfaDone = $state(false);
  async function resetMfa() {
    if (!confirm(tr({ en: `Reset two-factor authentication for ${form.name}? Their current 2FA stops working; they’ll sign in with their password and can set it up again. Do this only if they’re locked out.`, ar: `إعادة تعيين المصادقة الثنائية لـ ${form.name}؟ ستتوقف مصادقته الحالية؛ سيسجّل الدخول بكلمة مروره ويمكنه إعدادها من جديد. افعل ذلك فقط إذا كان محظوراً من الدخول.` }, $locale))) return;
    mfaBusy = true; mfaDone = false; error = '';
    try {
      await api(`/team/${id}/mfa-reset`, { method: 'POST', body: '{}' });
      mfaEnabled = false; mfaDone = true;
    } catch (err) { error = (err as Error).message; } finally { mfaBusy = false; }
  }

  onMount(async () => {
    allRoles = (await api<{ data: any[] }>('/team/roles')).data;
    // Edit: the list returns role *names*; map them back to ids for the checkboxes.
    if (initial?.roles?.length) {
      form.roleIds = allRoles.filter((r) => initial.roles.includes(r.name)).map((r) => r.id);
    }
  });

  function toggleRole(rid: number) {
    form.roleIds = form.roleIds.includes(rid) ? form.roleIds.filter((x) => x !== rid) : [...form.roleIds, rid];
  }

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      if (id) {
        await api(`/team/${id}`, { method: 'PUT', body: JSON.stringify({ name: form.name, isActive: form.isActive, roleIds: form.roleIds }) });
      } else {
        const r = await api<{ inviteSent?: boolean }>('/team', { method: 'POST', body: JSON.stringify({ name: form.name, email: form.email, password: form.password || undefined, roleIds: form.roleIds, sendInvite: form.sendInvite }) });
        if (form.sendInvite && r && r.inviteSent === false) {
          alert(tr({ en: 'Member created, but the invite email could not be sent — email isn’t configured yet (Settings → Messaging). You can send it later from the Team page.', ar: 'تم إنشاء العضو، لكن تعذّر إرسال بريد الدعوة — البريد غير مُهيأ بعد. يمكنك إرساله لاحقاً من صفحة الفريق.' }, $locale));
        }
      }
      await goto('/team');
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }
</script>

<form class="max-w-lg space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  <div class="card space-y-4 p-6">
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Name', ar: 'الاسم' }, $locale)}</span>
      <input class="input" bind:value={form.name} required />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Email', ar: 'البريد الإلكتروني' }, $locale)}</span>
      <input class="input force-ltr" type="email" bind:value={form.email} required disabled={!!id} />
    </label>

    {#if !id}
      <label class="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
        <input type="checkbox" class="mt-0.5" bind:checked={form.sendInvite} />
        <span>
          <span class="font-medium text-slate-700 dark:text-slate-200">{tr({ en: 'Send the invitation email now', ar: 'إرسال بريد الدعوة الآن' }, $locale)}</span>
          <span class="mt-0.5 block text-xs text-slate-400">{tr({ en: 'A branded email with a secure link for them to set their own password and sign in. Uncheck to send later (from the Team page). Requires email configured in Settings → Messaging.', ar: 'بريد مُنسَّق يحوي رابطاً آمناً ليعيّنوا كلمة مرورهم ويسجّلوا الدخول. ألغِ التحديد للإرسال لاحقاً من صفحة الفريق. يتطلب إعداد البريد.' }, $locale)}</span>
        </span>
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Temporary password (optional)', ar: 'كلمة مرور مؤقتة (اختياري)' }, $locale)}</span>
        <input class="input force-ltr" type="text" bind:value={form.password} minlength="8" placeholder={tr({ en: 'Leave blank — recommended', ar: 'اتركه فارغاً — مُستحسن' }, $locale)} />
        <span class="text-xs text-slate-400">{tr({ en: 'Recommended: leave blank so they set their own via the invite link. If you set one (8+ chars), they’ll be asked to change it at first login.', ar: 'مُستحسن: اتركه فارغاً ليعيّنوا كلمتهم عبر رابط الدعوة. إن حدّدت واحدة (8 أحرف+)، سيُطلب منهم تغييرها عند أول دخول.' }, $locale)}</span>
      </label>
    {/if}

    <fieldset class="space-y-2">
      <legend class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Roles', ar: 'الأدوار' }, $locale)}</legend>
      <div class="grid gap-2 sm:grid-cols-2">
        {#each allRoles as r}
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.roleIds.includes(r.id)} onchange={() => toggleRole(r.id)} /> {r.name}
          </label>
        {/each}
      </div>
    </fieldset>

    {#if id}
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.isActive} /> {tr({ en: 'Active', ar: 'نشط' }, $locale)}</label>

      <div class="border-t border-slate-200 pt-4 dark:border-slate-700">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Reset password', ar: 'إعادة تعيين كلمة المرور' }, $locale)}</span>
        <div class="mt-1 flex gap-2">
          <input class="input force-ltr" type="text" bind:value={newPassword} minlength="8" placeholder={tr({ en: 'New password (min 8)', ar: 'كلمة مرور جديدة (8+)' }, $locale)} />
          <button type="button" class="btn-ghost shrink-0 border border-slate-300 dark:border-slate-700" onclick={setPassword} disabled={pwBusy}>{pwBusy ? '…' : tr({ en: 'Set', ar: 'تعيين' }, $locale)}</button>
        </div>
        {#if pwDone}<span class="text-xs text-emerald-600 dark:text-emerald-400">✓ {tr({ en: 'Password updated', ar: 'تم تحديث كلمة المرور' }, $locale)}</span>{/if}
      </div>

      <div class="border-t border-slate-200 pt-4 dark:border-slate-700">
        <span class="text-sm text-slate-600 dark:text-slate-300">🔐 {tr({ en: 'Two-factor authentication', ar: 'المصادقة الثنائية' }, $locale)}</span>
        <div class="mt-1 flex flex-wrap items-center gap-3">
          {#if mfaEnabled}
            <span class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{tr({ en: 'On', ar: 'مفعّلة' }, $locale)}</span>
            <button type="button" class="rounded-md border border-rose-300 px-3 py-1 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300" onclick={resetMfa} disabled={mfaBusy}>{mfaBusy ? '…' : tr({ en: 'Reset 2FA', ar: 'إعادة تعيين' }, $locale)}</button>
          {:else}
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{tr({ en: 'Off', ar: 'غير مفعّلة' }, $locale)}</span>
            {#if mfaDone}<span class="text-xs text-emerald-600 dark:text-emerald-400">✓ {tr({ en: 'Reset — they can set it up again', ar: 'تمت إعادة التعيين — يمكنه الإعداد من جديد' }, $locale)}</span>{/if}
          {/if}
        </div>
        <p class="mt-1 text-xs text-slate-400">{tr({ en: 'Reset only if the person is locked out (lost device and recovery codes). It forces them to sign in again.', ar: 'أعد التعيين فقط إذا فقد الشخص جهازه ورموز الاسترداد. سيُطلب منه تسجيل الدخول من جديد.' }, $locale)}</p>
      </div>
    {/if}
  </div>
  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/team">✕</a>
  </div>
</form>
