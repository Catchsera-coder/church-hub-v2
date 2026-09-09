<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  interface Row {
    id: number; givenName: Record<string, string>; familyName: Record<string, string>; middleName?: Record<string, string>;
    email: string | null; mobile: string | null; membershipStatus: string;
    firstVisitOn: string | null; firstSeenYear: string | null; sourceList: string | null;
    lastSeen: string | null; visits: number; householdName: Record<string, string> | null; reason: 'lapsed' | 'stale_visitor';
  }
  let rows = $state<Row[]>([]);
  let loading = $state(true);
  let weeks = $state(8);
  let busy = $state<number | null>(null);
  const editable = can('update person');
  const canMessage = can('create message');

  // --- First-seen time filter (client-side, over the already-loaded list) ---
  // Narrows the list by WHEN each person first appeared (the "since YYYY" pill):
  // 'all' = any time, a year string = that year only, 'custom' = a from/to date range.
  let seenFilter = $state<string>('all');
  let fromDate = $state('');
  let toDate = $state('');
  function seenYearOf(r: Row): string | null { return r.firstSeenYear ?? (r.firstVisitOn ? r.firstVisitOn.slice(0, 4) : null); }
  function seenDateOf(r: Row): string | null { return r.firstVisitOn ?? (r.firstSeenYear ? `${r.firstSeenYear}-01-01` : null); }
  // Distinct first-seen years present in the data, newest first — powers the dropdown.
  const years = $derived([...new Set(rows.map(seenYearOf).filter((y): y is string => !!y))].sort((a, b) => b.localeCompare(a)));
  const shown = $derived(rows.filter((r) => {
    if (seenFilter === 'all') return true;
    if (seenFilter === 'custom') {
      const d = seenDateOf(r);
      if (!d) return false;
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    }
    return seenYearOf(r) === seenFilter;
  }));
  const filtered = $derived(seenFilter !== 'all');
  function clearFilter() { seenFilter = 'all'; fromDate = ''; toDate = ''; }

  // Multi-select + bulk actions.
  let selected = $state<Set<number>>(new Set());
  let assignees = $state<{ id: number; name: string }[]>([]);
  let assignee = $state<string>('');
  let bulkBusy = $state(false);
  const allShown = $derived(shown.length > 0 && shown.every((r) => selected.has(r.id)));

  async function load() {
    loading = true; selected = new Set();
    try { rows = (await api<{ data: Row[] }>(`/people/reengagement?weeks=${weeks}`)).data; }
    finally { loading = false; }
  }
  onMount(async () => {
    await load();
    try { assignees = (await api<{ data: any[] }>('/care/assignees')).data; } catch { /* optional */ }
  });

  function toggle(id: number) { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); selected = s; }
  function toggleAll() { selected = allShown ? new Set() : new Set(shown.map((r) => r.id)); }
  function clearSel() { selected = new Set(); }
  function dropIds(ids: number[]) { const set = new Set(ids); rows = rows.filter((r) => !set.has(r.id)); selected = new Set(); }

  function weeksAgo(iso: string | null): string {
    if (!iso) return '';
    return String(Math.floor((Date.now() - new Date(iso).getTime()) / (7 * 864e5)));
  }

  // --- single-row actions ---
  async function act(r: Row, fn: () => Promise<unknown>) {
    busy = r.id;
    try { await fn(); rows = rows.filter((x) => x.id !== r.id); selected.delete(r.id); }
    catch (err) { alert((err as Error).message); } finally { busy = null; }
  }
  const workOnIt = (r: Row) => act(r, () => api(`/people/${r.id}`, { method: 'PUT', body: JSON.stringify({ followUpStage: 'contacted' }) }));
  const snooze = (r: Row) => act(r, () => api(`/people/${r.id}/snooze`, { method: 'POST', body: '{}' }));
  const archive = (r: Row) => { if (!confirm(tr({ en: 'Archive this person?', ar: 'أرشفة هذا الشخص؟' }, $locale))) return; return act(r, () => api(`/people/${r.id}/archive`, { method: 'POST', body: '{}' })); };
  // Pre-written, personalised greeting — {{firstName}}/{{churchName}} fill in per
  // recipient at send (works for a single person AND a bulk send). Editable in the composer.
  const greeting = () => tr({ en: "Hi {{firstName}}, we've missed you at {{churchName}} and would love to see you again soon. Is there anything we can pray with you about?", ar: 'مرحباً {{firstName}}، لقد افتقدناك في {{churchName}} ونحبّ أن نراك قريباً. هل من أمرٍ نصلّي معك من أجله؟' }, $locale);
  const message = (r: Row) => goto(`/messages/new?people=${r.id}&body=${encodeURIComponent(greeting())}`);

  // --- bulk actions on the selection ---
  const ids = () => [...selected];
  async function bulk(action: 'snooze' | 'archive' | 'followup', assigneeUserId?: number | null) {
    if (!selected.size) return;
    if (action === 'archive' && !confirm(tr({ en: `Archive ${selected.size} people?`, ar: `أرشفة ${selected.size} شخصاً؟` }, $locale))) return;
    bulkBusy = true;
    const chosen = ids();
    try { await api('/people/bulk', { method: 'POST', body: JSON.stringify({ ids: chosen, action, assigneeUserId: assigneeUserId ?? null }) }); dropIds(chosen); }
    catch (err) { alert((err as Error).message); } finally { bulkBusy = false; }
  }
  function bulkMessage() { if (selected.size) goto(`/messages/new?people=${ids().join(',')}&body=${encodeURIComponent(greeting())}`); }
  function bulkAssign() { bulk('followup', assignee ? Number(assignee) : null); assignee = ''; }

  const nm = (r: Row) => displayName(r, $nameOrder, $locale);
</script>

<PageHeader title={tr({ en: 'Needs attention', ar: 'يحتاج إلى متابعة' }, $locale)}>
  {#snippet actions()}
    <label class="flex items-center gap-2 text-sm text-slate-500">
      {tr({ en: 'Absent for', ar: 'غائب منذ' }, $locale)}
      <select class="input w-auto py-1 text-sm" bind:value={weeks} onchange={load}>
        <option value={4}>{tr({ en: '4+ weeks', ar: '4+ أسابيع' }, $locale)}</option>
        <option value={8}>{tr({ en: '8+ weeks', ar: '8+ أسابيع' }, $locale)}</option>
        <option value={12}>{tr({ en: '12+ weeks', ar: '12+ أسبوع' }, $locale)}</option>
      </select>
    </label>
  {/snippet}
</PageHeader>

<PageHint id="reengagement" text={{ en: 'People worth reaching out to: those who used to attend but went quiet, and long-time visitors who never got connected. Select people (or Select all) to act in bulk — assign a servant to follow up, message them, snooze, or archive — or use the buttons on a single row.', ar: 'أشخاص يستحقون التواصل: من كانوا يحضرون وانقطعوا، والزوار القدامى الذين لم يندمجوا. حدّد أشخاصاً (أو حدّد الكل) للإجراء الجماعي — إسناد خادم للمتابعة، مراسلتهم، تأجيلهم، أو أرشفتهم.' }} />

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else if rows.length === 0}
  <div class="card p-10 text-center text-slate-500">{tr({ en: 'Nobody needs attention right now — everyone’s connected or being followed up. 🎉', ar: 'لا أحد يحتاج متابعة الآن — الجميع مندمج أو قيد المتابعة. 🎉' }, $locale)}</div>
{:else}
  <!-- First-seen time filter: narrows the list by when each person first appeared -->
  <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
    <span class="font-medium text-slate-600 dark:text-slate-300">🗓 {tr({ en: 'First seen', ar: 'أول ظهور' }, $locale)}</span>
    <select class="input w-auto py-1 text-sm" bind:value={seenFilter}>
      <option value="all">{tr({ en: 'Any time', ar: 'أي وقت' }, $locale)}</option>
      {#each years as y}<option value={y}>{y}</option>{/each}
      <option value="custom">{tr({ en: 'Custom range…', ar: 'مدة مخصصة…' }, $locale)}</option>
    </select>
    {#if seenFilter === 'custom'}
      <input type="date" class="input w-auto py-1 text-sm" bind:value={fromDate} aria-label={tr({ en: 'From date', ar: 'من تاريخ' }, $locale)} />
      <span class="text-slate-400">→</span>
      <input type="date" class="input w-auto py-1 text-sm" bind:value={toDate} aria-label={tr({ en: 'To date', ar: 'إلى تاريخ' }, $locale)} />
    {/if}
    {#if filtered}
      <button class="text-xs text-primary-700 hover:underline dark:text-primary-300" onclick={clearFilter}>{tr({ en: 'Clear filter', ar: 'مسح الفلتر' }, $locale)}</button>
    {/if}
  </div>

  <!-- Select-all + count -->
  <div class="mb-2 flex flex-wrap items-center gap-3 text-sm">
    {#if editable}
      <label class="flex items-center gap-2 text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={allShown} onchange={toggleAll} />
        {tr({ en: 'Select all', ar: 'تحديد الكل' }, $locale)}
      </label>
    {/if}
    <span class="text-slate-500">{shown.length}{#if filtered} / {rows.length}{/if} {tr({ en: 'to re-engage', ar: 'لإعادة التواصل' }, $locale)}</span>
  </div>

  <!-- Bulk action bar (CRM-style): appears when rows are selected -->
  {#if selected.size > 0}
    <div class="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-sm shadow-sm dark:border-primary-800 dark:bg-primary-900/30">
      <span class="font-medium text-primary-800 dark:text-primary-200">{selected.size} {tr({ en: 'selected', ar: 'محدد' }, $locale)}</span>
      <span class="mx-1 h-4 w-px bg-primary-200 dark:bg-primary-700"></span>
      {#if assignees.length}
        <select class="input h-8 w-40 py-0 text-xs" bind:value={assignee}>
          <option value="">{tr({ en: 'Assign follow-up to…', ar: 'إسناد المتابعة إلى…' }, $locale)}</option>
          {#each assignees as a}<option value={a.id}>{a.name}</option>{/each}
        </select>
      {/if}
      <button class="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:bg-transparent dark:text-emerald-300" disabled={bulkBusy} onclick={bulkAssign}>👋 {tr({ en: 'Start follow-up', ar: 'بدء المتابعة' }, $locale)}</button>
      {#if canMessage}<button class="rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:bg-transparent dark:text-blue-300" disabled={bulkBusy} onclick={bulkMessage}>✉ {tr({ en: 'Message', ar: 'رسالة' }, $locale)}</button>{/if}
      <button class="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:bg-transparent dark:text-amber-300" disabled={bulkBusy} onclick={() => bulk('snooze')}>💤 {tr({ en: 'Snooze 3mo', ar: 'تأجيل ٣ أشهر' }, $locale)}</button>
      <button class="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-300" disabled={bulkBusy} onclick={() => bulk('archive')}>🗄 {tr({ en: 'Archive', ar: 'أرشفة' }, $locale)}</button>
      <button class="ms-auto text-xs text-primary-700 hover:underline dark:text-primary-300" onclick={clearSel}>{tr({ en: 'Clear', ar: 'مسح' }, $locale)}</button>
    </div>
  {/if}

  {#if shown.length === 0}
    <div class="card p-8 text-center text-slate-500">
      {tr({ en: 'No one first appeared in this period.', ar: 'لا أحد ظهر لأول مرة في هذه المدة.' }, $locale)}
      <button class="text-primary-700 hover:underline dark:text-primary-300" onclick={clearFilter}>{tr({ en: 'Clear filter', ar: 'مسح الفلتر' }, $locale)}</button>
    </div>
  {:else}
  <div class="space-y-2">
    {#each shown as r (r.id)}
      <div class="card flex items-center gap-3 p-4 {selected.has(r.id) ? 'ring-1 ring-primary-300 dark:ring-primary-700' : ''}">
        {#if editable}<input type="checkbox" class="shrink-0" checked={selected.has(r.id)} onchange={() => toggle(r.id)} />{/if}
        <!-- Left column: identity + contact details -->
        <div class="min-w-0 shrink-0 basis-72">
          <a class="block truncate font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{r.id}">{nm(r)}</a>
          <div class="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500 dark:text-slate-400">
            {#if r.householdName}<span>👪 {tr(r.householdName, $locale)}</span>{/if}
            {#if r.email}<span class="force-ltr">{r.email}</span>{/if}
            {#if r.mobile}<span class="force-ltr">{r.mobile}</span>{/if}
            {#if r.sourceList}<span class="text-slate-400">· {r.sourceList}</span>{/if}
          </div>
        </div>
        <!-- Middle column: status pills, left-aligned and lined up across rows, with a gap before the action bar -->
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            {#if r.reason === 'lapsed'}
              <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Lapsed · {weeksAgo(r.lastSeen)} {tr({ en: 'wks', ar: 'أسبوع' }, $locale)}</span>
            {:else}
              <span class="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">{tr({ en: 'Never connected', ar: 'لم يندمج' }, $locale)}{#if r.firstSeenYear} · {tr({ en: 'since', ar: 'منذ' }, $locale)} {r.firstSeenYear}{/if}</span>
            {/if}
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-500 dark:bg-slate-800 dark:text-slate-400">{r.membershipStatus}</span>
          </div>
        </div>
        <!-- Aligned, colour-coded action bar -->
        <div class="flex shrink-0 items-center gap-1.5">
          {#if canMessage}<button class="rounded-md border border-blue-200 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-900/30" disabled={busy === r.id} onclick={() => message(r)}>✉ {tr({ en: 'Message', ar: 'رسالة' }, $locale)}</button>{/if}
          {#if editable}
            <button class="rounded-md border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-900/30" disabled={busy === r.id} onclick={() => workOnIt(r)}>👋 {tr({ en: 'Working on it', ar: 'قيد المتابعة' }, $locale)}</button>
            <button class="rounded-md border border-amber-200 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-300 dark:hover:bg-amber-900/30" disabled={busy === r.id} onclick={() => snooze(r)}>💤 {tr({ en: 'Snooze', ar: 'تأجيل' }, $locale)}</button>
            <button class="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800" disabled={busy === r.id} onclick={() => archive(r)}>🗄 {tr({ en: 'Archive', ar: 'أرشفة' }, $locale)}</button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
  {/if}
{/if}
