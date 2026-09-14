<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { dateTime } from '$lib/format.js';
  import { can } from '$lib/stores/auth.js';
  import DataTable from '$lib/components/DataTable.svelte';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  let sending = $state<number | null>(null);
  let senders = $state<{ id: number; name: string }[]>([]);

  const EMPTY = { channel: '', status: '', sender: '', q: '', from: '', to: '' };
  let f = $state({ ...EMPTY });
  const activeCount = $derived(Object.values(f).filter((v) => v !== '').length);

  async function load() {
    loading = true;
    try {
      const p = new URLSearchParams();
      if (f.channel) p.set('channel', f.channel);
      if (f.status) p.set('status', f.status);
      if (f.sender) p.set('sender', f.sender);
      if (f.q.trim()) p.set('q', f.q.trim());
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
      const qs = p.toString();
      rows = (await api<{ data: any[] }>(`/messages${qs ? `?${qs}` : ''}`)).data;
    } finally { loading = false; }
  }
  function clearFilters() { f = { ...EMPTY }; load(); }

  let searchTimer: ReturnType<typeof setTimeout>;
  function onSearch() { clearTimeout(searchTimer); searchTimer = setTimeout(load, 250); }

  onMount(async () => {
    await load();
    try { senders = (await api<{ data: any[] }>('/messages/senders')).data; } catch { /* optional */ }
  });

  const statusColor = (s: string) => s === 'sent' ? 'text-emerald-600' : s === 'failed' ? 'text-rose-600' : s === 'scheduled' ? 'text-amber-600 dark:text-amber-400' : s === 'sending' ? 'text-sky-600' : 'text-slate-500';
  const channelIcon = (c: string) => c === 'email' ? '✉️' : c === 'whatsapp' ? '🟢' : '💬';
  const statusLabel = (s: string) => tr({
    draft: { en: 'Draft', ar: 'مسودة' }, scheduled: { en: 'Scheduled', ar: 'مجدولة' },
    sending: { en: 'Sending', ar: 'جارٍ الإرسال' }, sent: { en: 'Sent', ar: 'أُرسلت' }, failed: { en: 'Failed', ar: 'فشلت' },
  }[s] ?? { en: s, ar: s }, $locale);

  async function sendNow(m: any, e: Event) {
    e.preventDefault(); e.stopPropagation();
    if (!confirm(tr({ en: `Send "${m.name}" now to all matching members?`, ar: `إرسال «${m.name}» الآن لكل الأعضاء المطابقين؟` }, $locale))) return;
    sending = m.id;
    try {
      const { data } = await api<{ data: { sent: number; total: number } }>(`/messages/${m.id}/send`, { method: 'POST' });
      alert(tr({ en: `Sent to ${data.sent} of ${data.total}.`, ar: `أُرسلت إلى ${data.sent} من ${data.total}.` }, $locale));
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : (err as Error).message);
    } finally { sending = null; }
  }
</script>

<PageHeader title={$t('nav.messages')}>
  {#snippet actions()}
    {#if can('view message')}<a href="/messages/templates" class="btn-ghost">{tr({ en: 'Templates', ar: 'القوالب' }, $locale)}</a>{/if}
    {#if can('view message')}<a href="/messages/inbox" class="btn-ghost">{tr({ en: 'Inbox', ar: 'الوارد' }, $locale)}</a>{/if}
    {#if can('create message')}<a href="/messages/new" class="btn-primary">{$t('common.new')}</a>{/if}
  {/snippet}
</PageHeader>
<PageHint id="messages-list" text={{ en: 'Send email, SMS or WhatsApp to the whole church or a chosen audience. Click any message to review exactly what was sent, who received it, when, and the delivery result per person. Use the filters to find a message by channel, status, sender or date.', ar: 'أرسل بريداً أو رسائل نصية أو واتساب للكنيسة كلها أو لجمهور محدّد. اضغط أي رسالة لمراجعة ما أُرسل ومن استلمه ومتى ونتيجة التسليم لكل شخص. استخدم المرشحات للعثور على رسالة حسب القناة أو الحالة أو المرسِل أو التاريخ.' }} />

<FilterBar active={activeCount} onclear={clearFilters}>
  <label class="text-sm">
    <span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Search name', ar: 'ابحث بالاسم' }, $locale)}</span>
    <input class="input" bind:value={f.q} oninput={onSearch} placeholder={tr({ en: 'Message name…', ar: 'اسم الرسالة…' }, $locale)} />
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Channel', ar: 'القناة' }, $locale)}</span>
    <select class="input" bind:value={f.channel} onchange={load}>
      <option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>
      <option value="email">{tr({ en: 'Email', ar: 'بريد' }, $locale)}</option>
      <option value="sms">SMS</option>
      <option value="whatsapp">WhatsApp</option>
    </select>
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Status', ar: 'الحالة' }, $locale)}</span>
    <select class="input" bind:value={f.status} onchange={load}>
      <option value="">{tr({ en: 'Any', ar: 'الكل' }, $locale)}</option>
      <option value="sent">{tr({ en: 'Sent', ar: 'أُرسلت' }, $locale)}</option>
      <option value="scheduled">{tr({ en: 'Scheduled', ar: 'مجدولة' }, $locale)}</option>
      <option value="draft">{tr({ en: 'Draft', ar: 'مسودة' }, $locale)}</option>
      <option value="failed">{tr({ en: 'Failed', ar: 'فشلت' }, $locale)}</option>
    </select>
  </label>
  {#if senders.length}
    <label class="text-sm">
      <span class="mb-1 block text-xs text-slate-500">{tr({ en: 'Sender', ar: 'المرسِل' }, $locale)}</span>
      <select class="input" bind:value={f.sender} onchange={load}>
        <option value="">{tr({ en: 'Anyone', ar: 'أي شخص' }, $locale)}</option>
        {#each senders as s}<option value={s.id}>{s.name}</option>{/each}
      </select>
    </label>
  {/if}
  <label class="text-sm">
    <span class="mb-1 block text-xs text-slate-500">{tr({ en: 'From', ar: 'من' }, $locale)}</span>
    <input class="input force-ltr" type="date" bind:value={f.from} onchange={load} />
  </label>
  <label class="text-sm">
    <span class="mb-1 block text-xs text-slate-500">{tr({ en: 'To', ar: 'إلى' }, $locale)}</span>
    <input class="input force-ltr" type="date" bind:value={f.to} onchange={load} />
  </label>
</FilterBar>

<DataTable {loading} {rows} headers={[tr({ en: 'Message', ar: 'الرسالة' }, $locale), tr({ en: 'Channel', ar: 'القناة' }, $locale), tr({ en: 'Status', ar: 'الحالة' }, $locale), tr({ en: 'Recipients', ar: 'المستلمون' }, $locale), tr({ en: 'Sender', ar: 'المرسِل' }, $locale), tr({ en: 'When', ar: 'التوقيت' }, $locale), '']}>
  {#snippet row(m)}
    <td class="p-3 font-medium">
      <a class="text-primary-700 hover:underline dark:text-primary-300" href={`/messages/${m.id}`}>{m.name}</a>
    </td>
    <td class="p-3 text-xs uppercase text-slate-500">{channelIcon(m.channel)} {m.channel}</td>
    <td class="p-3 font-medium {statusColor(m.status)}">
      {statusLabel(m.status)}
      {#if m.status === 'scheduled' && m.scheduledFor}<span class="force-ltr block text-xs font-normal text-slate-400">{dateTime(m.scheduledFor)}</span>{/if}
    </td>
    <td class="p-3 text-end">
      <span class="font-medium">{m.recipients ?? 0}</span>
      {#if m.failed > 0}<span class="ms-1 text-xs text-rose-500">({m.failed} {tr({ en: 'failed', ar: 'فشل' }, $locale)})</span>{/if}
    </td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{m.sentByName || m.createdByName || '—'}</td>
    <td class="p-3 force-ltr text-slate-600 dark:text-slate-300">{m.sentAt ? dateTime(m.sentAt) : (m.scheduledFor ? dateTime(m.scheduledFor) : dateTime(m.createdAt))}</td>
    <td class="p-3 text-end">
      {#if (m.status === 'draft' || m.status === 'scheduled') && can('update message')}
        <button class="text-xs text-primary-600 hover:underline disabled:opacity-50 dark:text-primary-300" disabled={sending === m.id} onclick={(e) => sendNow(m, e)}>
          {sending === m.id ? $t('common.loading') : tr({ en: 'Send now', ar: 'إرسال الآن' }, $locale)}
        </button>
      {/if}
    </td>
  {/snippet}
</DataTable>
