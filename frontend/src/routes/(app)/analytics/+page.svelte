<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { get } from 'svelte/store';
  import { api } from '$lib/api.js';
  import { t, locale, tr, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  const canMessage = can('create message');

  // ---- filters ----------------------------------------------------------------
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  function daysAgo(days: number) { const d = new Date(); d.setDate(d.getDate() - days); return iso(d); }
  let from = $state(daysAgo(84)); // 12 weeks
  let to = $state(iso(new Date()));
  let serviceTypeId = $state<string>(''); // '' = all
  let compare = $state(true);
  let ministries = $state<any[]>([]);

  const PRESETS = [
    { k: '28', l: { en: 'Last 4 weeks', ar: 'آخر 4 أسابيع' } },
    { k: '84', l: { en: 'Last 12 weeks', ar: 'آخر 12 أسبوعاً' } },
    { k: '182', l: { en: 'Last 6 months', ar: 'آخر 6 أشهر' } },
    { k: 'ytd', l: { en: 'This year', ar: 'هذا العام' } },
  ];
  function applyPreset(k: string) {
    if (k === 'ytd') { from = `${new Date().getFullYear()}-01-01`; to = iso(new Date()); }
    else { from = daysAgo(Number(k)); to = iso(new Date()); }
    load();
  }

  // ---- data -------------------------------------------------------------------
  let att = $state<any>(null);
  let loading = $state(true);
  let overview = $state<any>(null); // membership + giving (secondary)

  function qs() {
    const p = new URLSearchParams({ from, to });
    if (serviceTypeId) p.set('serviceTypeId', serviceTypeId);
    if (compare) p.set('compare', 'true');
    return p;
  }
  async function load() {
    loading = true;
    // reflect filters in the URL so the view is shareable
    try { await goto(`?${qs()}`, { replaceState: true, noScroll: true, keepFocus: true }); } catch { /* ignore */ }
    try { att = (await api<{ data: any }>(`/analytics/attendance?${qs()}`)).data; } finally { loading = false; }
    loadBucket(bucket); // refresh open action list
  }

  onMount(async () => {
    const u = get(page).url.searchParams;
    if (u.get('from')) from = u.get('from')!;
    if (u.get('to')) to = u.get('to')!;
    if (u.get('serviceTypeId')) serviceTypeId = u.get('serviceTypeId')!;
    try { ministries = (await api<{ data: any[] }>('/ministries')).data; } catch { /* optional */ }
    try { overview = (await api<{ data: any }>('/analytics/overview')).data; } catch { /* optional */ }
    load();
  });

  // ---- action lists (first-timers / absentees / attendees) --------------------
  type Bucket = 'first-timers' | 'absentees' | 'attendees';
  let bucket = $state<Bucket>('first-timers');
  let absentWeeks = $state('4');
  let listRows = $state<any[]>([]);
  let listLoading = $state(false);
  async function loadBucket(b: Bucket) {
    bucket = b;
    listLoading = true;
    const p = new URLSearchParams({ bucket: b });
    if (b === 'absentees') p.set('weeks', absentWeeks);
    else { p.set('from', from); p.set('to', to); }
    if (serviceTypeId) p.set('serviceTypeId', serviceTypeId);
    try { listRows = (await api<{ data: any[] }>(`/analytics/attendance/people?${p}`)).data; }
    catch { listRows = []; } finally { listLoading = false; }
  }

  function followUpAll() {
    const ids = listRows.map((r) => r.id).filter(Boolean);
    if (ids.length) goto(`/messages/new?people=${ids.join(',')}`);
  }
  function messageOne(id: number) { goto(`/messages/new?people=${id}`); }

  async function copyLink() {
    try { await navigator.clipboard.writeText(location.href); copied = true; setTimeout(() => (copied = false), 1500); } catch { /* ignore */ }
  }
  let copied = $state(false);

  // ---- derived / helpers ------------------------------------------------------
  const growth = $derived.by(() => {
    if (!att?.compare) return null;
    const now = att.summary.total, prev = att.compare.summary.total;
    if (!prev) return now > 0 ? 100 : 0;
    return Math.round(((now - prev) / prev) * 100);
  });
  const trendMax = $derived(Math.max(1, ...(att?.trend ?? []).map((r: any) => r.count)));
  const svcMax = $derived(Math.max(1, ...(att?.byService ?? []).map((r: any) => r.total)));
  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '—');
  const nameOf = (r: any) => displayName(r, $nameOrder, $locale);
</script>

<PageHeader title={tr({ en: 'Attendance Insights', ar: 'تحليلات الحضور' }, $locale)}>
  {#snippet actions()}
    <button class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" onclick={copyLink}>{copied ? tr({ en: 'Link copied ✓', ar: 'نُسخ الرابط ✓' }, $locale) : tr({ en: '🔗 Share view', ar: '🔗 مشاركة العرض' }, $locale)}</button>
    <button class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" onclick={() => window.print()}>🖨 {tr({ en: 'Print', ar: 'طباعة' }, $locale)}</button>
  {/snippet}
</PageHeader>

<PageHint id="analytics" text={{ en: 'See how attendance is trending — overall or for one ministry/group. Set the date range, compare with the previous period, and open the lists below to follow up: welcome first-timers, or reach members who have gone quiet — one click messages the whole list.', ar: 'تابع اتجاه الحضور — إجمالاً أو لخدمة/مجموعة. حدّد الفترة، قارن بالفترة السابقة، وافتح القوائم بالأسفل للمتابعة: رحّب بالحاضرين الجدد، أو تواصل مع من انقطعوا — بضغطة واحدة تراسل القائمة كلها.' }} />

<!-- Filters -->
<div class="card mb-6 p-4 sm:p-5 print:hidden">
  <div class="flex flex-wrap items-end gap-3">
    <div class="flex flex-wrap gap-1">
      {#each PRESETS as pre}<button class="rounded-md border px-2.5 py-1.5 text-xs border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={() => applyPreset(pre.k)}>{tr(pre.l, $locale)}</button>{/each}
    </div>
    <label class="text-xs text-slate-500"><span class="mb-1 block">{tr({ en: 'From', ar: 'من' }, $locale)}</span><input class="input force-ltr" type="date" bind:value={from} onchange={load} /></label>
    <label class="text-xs text-slate-500"><span class="mb-1 block">{tr({ en: 'To', ar: 'إلى' }, $locale)}</span><input class="input force-ltr" type="date" bind:value={to} onchange={load} /></label>
    <label class="text-xs text-slate-500"><span class="mb-1 block">{tr({ en: 'Ministry / group', ar: 'خدمة / مجموعة' }, $locale)}</span>
      <select class="input w-48" bind:value={serviceTypeId} onchange={load}>
        <option value="">{tr({ en: 'All services', ar: 'كل الخدمات' }, $locale)}</option>
        {#each ministries as m}<option value={String(m.id)}>{tr(m.name, $locale)}</option>{/each}
      </select>
    </label>
    <label class="flex items-center gap-2 pb-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" bind:checked={compare} onchange={load} /> {tr({ en: 'Compare to previous period', ar: 'قارن بالفترة السابقة' }, $locale)}</label>
  </div>
</div>

{#if loading && !att}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else if att}
  <!-- Summary cards -->
  <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
    {#snippet stat(label: Record<string,string>, value: string | number, sub: string | null = null)}
      <div class="card p-4">
        <div class="text-2xl font-semibold leading-none">{value}</div>
        <div class="mt-1 text-xs text-slate-500">{tr(label, $locale)}</div>
        {#if sub}<div class="mt-1 text-xs text-slate-400">{sub}</div>{/if}
      </div>
    {/snippet}
    {@render stat({ en: 'Total check-ins', ar: 'إجمالي الحضور' }, att.summary.total, growth === null ? null : `${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)}% ${tr({ en: 'vs prev.', ar: 'مقارنة بالسابق' }, $locale)}`)}
    {@render stat({ en: 'Unique people', ar: 'أشخاص فريدون' }, att.summary.uniquePeople)}
    {@render stat({ en: 'Gatherings', ar: 'الاجتماعات' }, att.summary.events)}
    {@render stat({ en: 'Avg / gathering', ar: 'المعدل/اجتماع' }, att.summary.avgPerEvent)}
    {@render stat({ en: 'First-timers', ar: 'حاضرون جدد' }, att.summary.firstTimers)}
  </div>

  <div class="grid gap-6 lg:grid-cols-2">
    <!-- Weekly trend -->
    <div class="card p-6">
      <h2 class="mb-4 text-lg font-semibold">{tr({ en: 'Weekly attendance', ar: 'الحضور الأسبوعي' }, $locale)}</h2>
      {#if att.trend.length === 0}
        <p class="text-sm text-slate-400">{tr({ en: 'No attendance in this range.', ar: 'لا حضور في هذه الفترة.' }, $locale)}</p>
      {:else}
        <div class="flex h-44 items-end gap-1.5">
          {#each att.trend as r}
            <div class="group flex flex-1 flex-col items-center justify-end" title="{r.label}: {r.count} ({r.unique} {tr({ en: 'unique', ar: 'فريد' }, $locale)})">
              <span class="mb-1 text-[10px] text-slate-400 opacity-0 group-hover:opacity-100">{r.count}</span>
              <div class="w-full rounded-t" style="height: {Math.round((r.count / trendMax) * 100)}%; min-height: 2px; background: var(--brand)"></div>
            </div>
          {/each}
        </div>
        <div class="mt-1 flex gap-1.5 text-[10px] text-slate-400">
          {#each att.trend as r}<span class="flex-1 truncate text-center">{r.label}</span>{/each}
        </div>
      {/if}
    </div>

    <!-- By service -->
    <div class="card p-6">
      <h2 class="mb-4 text-lg font-semibold">{tr({ en: 'By ministry / service', ar: 'حسب الخدمة' }, $locale)}</h2>
      {#if att.byService.length === 0}
        <p class="text-sm text-slate-400">{tr({ en: 'No data.', ar: 'لا بيانات.' }, $locale)}</p>
      {:else}
        <div class="space-y-2">
          {#each att.byService as r}
            <button class="block w-full text-start" onclick={() => { serviceTypeId = r.id == null ? '' : String(r.id); load(); }}>
              <div class="mb-1 flex items-center justify-between text-sm">
                <span class="text-slate-700 hover:underline dark:text-slate-200">{r.label}</span>
                <span class="font-medium text-slate-500">{r.total} <span class="text-xs text-slate-400">· {r.avg}/{tr({ en: 'mtg', ar: 'اجتماع' }, $locale)}</span></span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div class="h-full rounded-full" style="width: {Math.round((r.total / svcMax) * 100)}%; background: var(--brand)"></div></div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- Action lists -->
  <div class="card mt-6 p-6">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap gap-2">
        {#each [{ b: 'first-timers', l: { en: '✨ First-timers', ar: '✨ حاضرون جدد' } }, { b: 'absentees', l: { en: '💤 Gone quiet', ar: '💤 انقطعوا' } }, { b: 'attendees', l: { en: '✅ Attendees', ar: '✅ الحاضرون' } }] as tabo}
          <button class="rounded-md border px-3 py-1.5 text-sm {bucket === tabo.b ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={bucket === tabo.b ? 'background: var(--brand)' : ''} onclick={() => loadBucket(tabo.b as Bucket)}>{tr(tabo.l, $locale)}</button>
        {/each}
        {#if bucket === 'absentees'}
          <select class="input w-auto py-1 text-sm" bind:value={absentWeeks} onchange={() => loadBucket('absentees')}>
            <option value="4">{tr({ en: '4+ weeks', ar: '4+ أسابيع' }, $locale)}</option>
            <option value="8">{tr({ en: '8+ weeks', ar: '8+ أسابيع' }, $locale)}</option>
            <option value="12">{tr({ en: '12+ weeks', ar: '12+ أسبوع' }, $locale)}</option>
          </select>
        {/if}
      </div>
      {#if canMessage && listRows.length}
        <button class="btn-primary text-sm" onclick={followUpAll}>✉️ {tr({ en: 'Follow up — message all', ar: 'متابعة — راسل الكل' }, $locale)} ({listRows.length})</button>
      {/if}
    </div>
    <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">
      {#if bucket === 'first-timers'}{tr({ en: 'People whose first-ever check-in falls in this range — welcome them.', ar: 'من كان أول حضور لهم في هذه الفترة — رحّب بهم.' }, $locale)}
      {:else if bucket === 'absentees'}{tr({ en: 'People who used to attend but have not been seen recently — reach out.', ar: 'من كانوا يحضرون وانقطعوا مؤخراً — تواصل معهم.' }, $locale)}
      {:else}{tr({ en: 'Everyone who attended in this range.', ar: 'كل من حضر في هذه الفترة.' }, $locale)}{/if}
    </p>

    {#if listLoading}
      <p class="text-sm text-slate-400">{$t('common.loading')}</p>
    {:else if listRows.length === 0}
      <p class="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-800/50">{tr({ en: 'Nobody here right now. 🎉', ar: 'لا أحد هنا الآن. 🎉' }, $locale)}</p>
    {:else}
      <div class="max-h-96 overflow-y-auto">
        <table class="w-full text-sm">
          <tbody>
            {#each listRows as r (r.id)}
              <tr class="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td class="py-2"><a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{r.id}">{nameOf(r)}</a>
                  {#if r.times}<span class="ms-2 text-xs text-slate-400">×{r.times}</span>{/if}
                </td>
                <td class="py-2 force-ltr text-xs text-slate-500">{r.mobile || r.email || '—'}</td>
                <td class="py-2 text-xs text-slate-400">{bucket === 'first-timers' ? fmtDate(r.lastSeen) : bucket === 'absentees' ? `${tr({ en: 'last', ar: 'آخر' }, $locale)} ${fmtDate(r.lastSeen)}` : fmtDate(r.lastSeen)}</td>
                <td class="py-2 text-end">{#if canMessage}<button class="text-xs text-slate-500 hover:underline" onclick={() => messageOne(r.id)}>✉️ {tr({ en: 'Message', ar: 'رسالة' }, $locale)}</button>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <!-- Secondary: membership + giving trends -->
  {#if overview}
    <div class="mt-6 grid gap-6 lg:grid-cols-2">
      {#snippet miniBars(title: Record<string,string>, rows: any[], key: string, fmt: (n: number) => string)}
        <div class="card p-6">
          <h2 class="mb-4 text-lg font-semibold">{tr(title, $locale)}</h2>
          {#if !rows?.length}<p class="text-sm text-slate-400">{tr({ en: 'No data yet.', ar: 'لا بيانات بعد.' }, $locale)}</p>
          {:else}
            {@const m = Math.max(1, ...rows.map((x) => x[key]))}
            <div class="space-y-2">{#each rows as r}
              <div><div class="mb-1 flex justify-between text-sm"><span class="text-slate-700 dark:text-slate-200">{r.label}</span><span class="font-medium text-slate-500">{fmt(r[key])}</span></div>
              <div class="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div class="h-full rounded-full" style="width: {Math.round((r[key] / m) * 100)}%; background: var(--brand)"></div></div></div>
            {/each}</div>
          {/if}
        </div>
      {/snippet}
      {@render miniBars({ en: 'New members — last 6 months', ar: 'أعضاء جدد — آخر 6 أشهر' }, overview.newMembersByMonth, 'count', (x) => String(x))}
      {#if overview.givingByMonth}{@render miniBars({ en: 'Giving — last 6 months', ar: 'العطاء — آخر 6 أشهر' }, overview.givingByMonth, 'cents', (x) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(x / 100))}{/if}
    </div>
  {/if}
{/if}
