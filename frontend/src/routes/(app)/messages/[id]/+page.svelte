<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr, enabledLocales } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import { can } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  const id = Number($page.params.id);
  let msg = $state<any>(null);
  let recipients = $state<any[]>([]);
  let loading = $state(true);
  let sending = $state(false);

  // Which language variant of the content to review, and which delivery outcome
  // to show in the recipient list.
  let lang = $state('en');
  let statusFilter = $state<'all' | 'sent' | 'failed' | 'pending'>('all');

  async function load() {
    loading = true;
    try {
      const [m, r] = await Promise.all([
        api<{ data: any }>(`/messages/${id}`),
        api<{ data: any[] }>(`/messages/${id}/recipients`),
      ]);
      msg = m.data;
      recipients = r.data;
      lang = msg.rendered?.[0]?.lang ?? 'en';
    } finally { loading = false; }
  }
  onMount(load);

  const current = $derived(msg?.rendered?.find((x: any) => x.lang === lang) ?? msg?.rendered?.[0] ?? null);
  const filtered = $derived(recipients.filter((r) => statusFilter === 'all' ? true : r.status === statusFilter));

  const recName = (r: any) => r.resolvedName
    || `${tr(r.givenName ?? {}, $locale)} ${tr(r.familyName ?? {}, $locale)}`.trim()
    || r.toContact || '—';
  const statusColor = (s: string) => s === 'sent' ? 'text-emerald-600' : s === 'failed' ? 'text-rose-600' : 'text-slate-500';
  const statusLabel = (s: string) => tr({
    sent: { en: 'Sent', ar: 'أُرسلت' }, failed: { en: 'Failed', ar: 'فشلت' }, pending: { en: 'Pending', ar: 'قيد الانتظار' },
  }[s] ?? { en: s, ar: s }, $locale);
  const langNative = (code: string) => $enabledLocales.find((l) => l.code === code)?.native ?? code;

  async function sendNow() {
    if (!confirm(tr({ en: 'Send this message now to all matching members?', ar: 'إرسال هذه الرسالة الآن لكل الأعضاء المطابقين؟' }, $locale))) return;
    sending = true;
    try {
      const { data } = await api<{ data: { sent: number; total: number } }>(`/messages/${id}/send`, { method: 'POST' });
      alert(tr({ en: `Sent to ${data.sent} of ${data.total}.`, ar: `أُرسلت إلى ${data.sent} من ${data.total}.` }, $locale));
      await load();
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { sending = false; }
  }
</script>

<PageHeader title={msg?.name ?? tr({ en: 'Message', ar: 'رسالة' }, $locale)} back="/messages">
  {#snippet actions()}
    {#if msg && (msg.status === 'draft' || msg.status === 'scheduled') && can('update message')}
      <button class="btn-primary" onclick={sendNow} disabled={sending}>{sending ? $t('common.loading') : tr({ en: 'Send now', ar: 'إرسال الآن' }, $locale)}</button>
    {/if}
  {/snippet}
</PageHeader>

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else if msg}
  <!-- Summary: who / when / status / delivery tallies -->
  <div class="card mb-6 p-5">
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <div class="text-xs text-slate-500">{tr({ en: 'Channel', ar: 'القناة' }, $locale)}</div>
        <div class="mt-0.5 font-medium capitalize">{msg.channel === 'email' ? '✉️ Email' : msg.channel === 'whatsapp' ? '🟢 WhatsApp' : '💬 SMS'}</div>
      </div>
      <div>
        <div class="text-xs text-slate-500">{tr({ en: 'Status', ar: 'الحالة' }, $locale)}</div>
        <div class="mt-0.5 font-medium capitalize {statusColor(msg.status)}">{msg.status}</div>
      </div>
      <div>
        <div class="text-xs text-slate-500">{tr({ en: 'Composed by', ar: 'أنشأها' }, $locale)}</div>
        <div class="mt-0.5 font-medium">{msg.createdByName || '—'}</div>
      </div>
      <div>
        <div class="text-xs text-slate-500">{msg.status === 'scheduled' ? tr({ en: 'Scheduled for', ar: 'مجدولة لـ' }, $locale) : tr({ en: 'Sent by', ar: 'أرسلها' }, $locale)}</div>
        {#if msg.status === 'scheduled'}
          <div class="force-ltr mt-0.5 font-medium">{msg.scheduledFor ? dateTime(msg.scheduledFor) : tr({ en: 'Recurring', ar: 'متكرر' }, $locale)}</div>
        {:else}
          <div class="mt-0.5 font-medium">{msg.sentByName || tr({ en: 'Scheduler', ar: 'المُجدوِل' }, $locale)}</div>
        {/if}
      </div>
    </div>

    {#if msg.sentAt || msg.counts?.total}
      <div class="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        {#if msg.sentAt}<span class="rounded-full bg-slate-100 px-3 py-1 text-sm dark:bg-slate-800">🕐 <span class="force-ltr">{dateTime(msg.sentAt)}</span></span>{/if}
        <span class="rounded-full bg-slate-100 px-3 py-1 text-sm dark:bg-slate-800">{msg.counts?.total ?? 0} {tr({ en: 'recipients', ar: 'مستلم' }, $locale)}</span>
        {#if msg.counts?.sent}<span class="rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">✓ {msg.counts.sent} {tr({ en: 'delivered', ar: 'سُلّمت' }, $locale)}</span>{/if}
        {#if msg.counts?.failed}<span class="rounded-full bg-rose-50 px-3 py-1 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">✕ {msg.counts.failed} {tr({ en: 'failed', ar: 'فشلت' }, $locale)}</span>{/if}
        {#if msg.counts?.pending}<span class="rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">… {msg.counts.pending} {tr({ en: 'pending', ar: 'قيد الانتظار' }, $locale)}</span>{/if}
      </div>
    {/if}
  </div>

  <!-- Content review: exactly what recipients received -->
  <div class="card mb-6 p-5">
    <div class="mb-3 flex items-center justify-between gap-3">
      <h2 class="font-semibold">{tr({ en: 'What was sent', ar: 'ما تم إرساله' }, $locale)}</h2>
      {#if msg.rendered?.length > 1}
        <div class="flex gap-1">
          {#each msg.rendered as r}
            <button class="rounded-md px-2 py-1 text-xs {lang === r.lang ? 'text-white' : 'border border-slate-300 dark:border-slate-700'}" style={lang === r.lang ? 'background: var(--brand)' : ''} onclick={() => (lang = r.lang)}>{langNative(r.lang)}</button>
          {/each}
        </div>
      {/if}
    </div>
    {#if current}
      {#if msg.channel === 'email'}
        {#if current.subject}<p class="mb-2 text-sm"><span class="text-slate-400">{tr({ en: 'Subject:', ar: 'الموضوع:' }, $locale)}</span> <b>{current.subject}</b></p>{/if}
        <iframe title="message" srcdoc={current.html} sandbox="" class="h-[520px] w-full rounded-md border border-slate-200 bg-white dark:border-slate-700"></iframe>
      {:else}
        <div class="rounded-2xl bg-emerald-100 p-4 text-sm text-slate-800 dark:bg-emerald-900/40 dark:text-slate-100" style="white-space:pre-wrap">{current.text}</div>
        {#if msg.mediaUrl}<img src={msg.mediaUrl} alt="" class="mt-3 max-h-64 rounded-lg" />{/if}
      {/if}
    {/if}
  </div>

  <!-- Per-recipient delivery log -->
  <div class="mb-3 flex flex-wrap items-center gap-2">
    <h2 class="font-semibold">{tr({ en: 'Recipients', ar: 'المستلمون' }, $locale)}</h2>
    <div class="ms-auto flex gap-1">
      {#each [['all', { en: 'All', ar: 'الكل' }], ['sent', { en: 'Delivered', ar: 'سُلّمت' }], ['failed', { en: 'Failed', ar: 'فشلت' }], ['pending', { en: 'Pending', ar: 'قيد الانتظار' }]] as [val, lbl]}
        <button class="rounded-md px-2.5 py-1 text-xs {statusFilter === val ? 'text-white' : 'border border-slate-300 dark:border-slate-700'}" style={statusFilter === val ? 'background: var(--brand)' : ''} onclick={() => (statusFilter = val as any)}>{tr(lbl as any, $locale)}</button>
      {/each}
    </div>
  </div>

  <DataTable rows={filtered} empty={tr({ en: 'No recipients logged for this message.', ar: 'لا يوجد مستلمون مسجّلون لهذه الرسالة.' }, $locale)} headers={[tr({ en: 'Name', ar: 'الاسم' }, $locale), tr({ en: 'Contact', ar: 'جهة الاتصال' }, $locale), tr({ en: 'Status', ar: 'الحالة' }, $locale), tr({ en: 'When', ar: 'التوقيت' }, $locale)]}>
    {#snippet row(r)}
      <td class="p-3 font-medium">
        {#if r.personId && can('view person')}
          <a class="text-primary-700 hover:underline dark:text-primary-300" href="/members/{r.personId}?back={encodeURIComponent(`/messages/${id}`)}">{recName(r)}</a>
        {:else}{recName(r)}{/if}
      </td>
      <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{r.toContact || r.email || r.mobile || '—'}</td>
      <td class="p-3 font-medium {statusColor(r.status)}">
        {statusLabel(r.status)}
        {#if r.status === 'failed' && r.error}<span class="block text-xs font-normal text-slate-400">{r.error}</span>{/if}
      </td>
      <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{r.sentAt ? dateTime(r.sentAt) : '—'}</td>
    {/snippet}
  </DataTable>
{:else}
  <p class="text-slate-400">{tr({ en: 'Message not found.', ar: 'الرسالة غير موجودة.' }, $locale)}</p>
{/if}
