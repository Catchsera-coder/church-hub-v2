<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import { can } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  onMount(async () => { try { rows = (await api<{ data: any[] }>('/team')).data; } finally { loading = false; } });
  const editable = can('update user');

  let busyId = $state<number | null>(null);
  // Invite email preview modal
  let preview = $state<{ subject: string; html: string; to: string; name: string } | null>(null);

  async function sendInvite(u: any) {
    if (!confirm(tr({ en: `Send the invitation email to ${u.name} (${u.email}) now?`, ar: `إرسال بريد الدعوة إلى ${u.name} (${u.email}) الآن؟` }, $locale))) return;
    busyId = u.id;
    try {
      const r = await api<{ data: { sent: boolean } }>(`/team/${u.id}/invite`, { method: 'POST', body: '{}' });
      alert(r.data.sent
        ? tr({ en: 'Invitation email sent.', ar: 'تم إرسال بريد الدعوة.' }, $locale)
        : tr({ en: 'Could not send — email isn’t configured yet (Settings → Messaging).', ar: 'تعذّر الإرسال — البريد غير مُهيأ بعد (الإعدادات ← المراسلة).' }, $locale));
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { busyId = null; }
  }
  async function openPreview(u: any) {
    busyId = u.id;
    try {
      const r = await api<{ data: { subject: string; html: string; to: string } }>(`/team/${u.id}/invite-preview`);
      preview = { ...r.data, name: u.name };
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { busyId = null; }
  }
</script>

<PageHeader title={$t('nav.team')}>
  {#snippet actions()}
    {#if can('create user')}<a href="/team/new" class="btn-primary">{$t('common.new')}</a>{/if}
  {/snippet}
</PageHeader>
<PageHint id="team" text={{ en: 'Staff & volunteer logins. Add a user, give them a role, and send an invitation email — they click it to set their own password and sign in. Use Invite to send or resend at any time, and Preview to see the email first. This is separate from ministry rosters.', ar: 'حسابات الموظفين والمتطوعين. أضف مستخدماً وامنحه دوراً وأرسل بريد دعوة — ينقر عليه لتعيين كلمة مروره وتسجيل الدخول. استخدم «دعوة» للإرسال أو إعادة الإرسال في أي وقت، و«معاينة» لرؤية البريد أولاً.' }} />

<DataTable {loading} {rows} headers={[tr({ en: 'Name', ar: 'الاسم' }, $locale), tr({ en: 'Email', ar: 'البريد' }, $locale), tr({ en: 'Roles', ar: 'الأدوار' }, $locale), tr({ en: 'Status', ar: 'الحالة' }, $locale), tr({ en: 'Last sign-in', ar: 'آخر دخول' }, $locale), tr({ en: 'Invite', ar: 'الدعوة' }, $locale)]}>
  {#snippet row(u)}
    <td class="p-3 font-medium">
      {#if editable}<a class="text-primary-700 hover:underline dark:text-primary-300" href="/team/{u.id}">{u.name}</a>{:else}{u.name}{/if}
    </td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{u.email}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{(u.roles ?? []).join(', ') || '—'}</td>
    <td class="p-3">
      {#if u.invitedAt && !u.lastLoginAt}
        <span class="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{tr({ en: 'Invited', ar: 'مدعو' }, $locale)}</span>
      {:else if u.isActive}
        <span class="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{tr({ en: 'Active', ar: 'نشط' }, $locale)}</span>
      {:else}
        <span class="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{tr({ en: 'Inactive', ar: 'غير نشط' }, $locale)}</span>
      {/if}
      {#if u.mfaEnabled}<span class="ms-1 rounded bg-primary-50 px-1.5 py-0.5 text-xs text-primary-700 dark:bg-primary-900/30 dark:text-primary-300" title={tr({ en: 'Two-factor on', ar: 'المصادقة الثنائية مفعّلة' }, $locale)}>🔒 2FA</span>{/if}
    </td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{u.lastLoginAt ? dateTime(u.lastLoginAt) : '—'}</td>
    <td class="p-3">
      <div class="flex items-center gap-1.5">
        <button class="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" disabled={busyId === u.id} onclick={() => openPreview(u)}>👁 {tr({ en: 'Preview', ar: 'معاينة' }, $locale)}</button>
        {#if editable}
          <button class="rounded-md border border-blue-200 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-900/30" disabled={busyId === u.id} onclick={() => sendInvite(u)}>✉ {u.invitedAt && !u.lastLoginAt ? tr({ en: 'Resend', ar: 'إعادة الإرسال' }, $locale) : tr({ en: 'Send invite', ar: 'إرسال دعوة' }, $locale)}</button>
        {/if}
      </div>
    </td>
  {/snippet}
</DataTable>

{#if preview}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="button" tabindex="0" onclick={() => (preview = null)} onkeydown={(e) => { if (e.key === 'Escape') preview = null; }}>
    <div class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <div class="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold">{tr({ en: 'Invitation email preview', ar: 'معاينة بريد الدعوة' }, $locale)}</p>
          <p class="truncate text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'To', ar: 'إلى' }, $locale)}: {preview.name} · <span class="force-ltr">{preview.to}</span></p>
        </div>
        <button class="btn-ghost text-sm" onclick={() => (preview = null)}>✕</button>
      </div>
      <div class="border-b border-slate-200 px-5 py-2 text-sm dark:border-slate-700"><span class="text-slate-500">{tr({ en: 'Subject', ar: 'الموضوع' }, $locale)}:</span> <span class="font-medium">{preview.subject}</span></div>
      <div class="min-h-0 flex-1 overflow-auto bg-slate-100 p-4 dark:bg-slate-800">
        <!-- allow-same-origin lets the hosted logo image load so the preview matches the real email; scripts stay blocked (no allow-scripts) -->
        <iframe title="preview" class="h-[60vh] w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700" srcdoc={preview.html} sandbox="allow-same-origin"></iframe>
      </div>
      <div class="border-t border-slate-200 px-5 py-2 text-xs text-slate-400 dark:border-slate-700">{tr({ en: 'The real email embeds a personal, secure sign-in link in the button.', ar: 'البريد الفعلي يضمّن رابط دخول شخصياً وآمناً في الزر.' }, $locale)}</div>
    </div>
  </div>
{/if}
