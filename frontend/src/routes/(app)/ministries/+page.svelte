<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  let all = $state<any[]>([]);
  let loading = $state(true);
  let busy = $state<number | null>(null);
  let view = $state<'ministry' | 'group'>('ministry');

  const canEdit = can('update ministry');
  const canCreate = can('create ministry');
  const canDelete = can('delete ministry');

  async function load() {
    loading = true;
    try { all = (await api<{ data: any[] }>('/ministries')).data; } finally { loading = false; }
  }
  onMount(load);

  const rows = $derived(all.filter((m) => (m.kind ?? 'ministry') === view));
  const activeIds = $derived(new Set(rows.map((r) => r.id)));
  const topLevel = $derived(
    rows
      .filter((m) => m.parentId == null || !activeIds.has(m.parentId))
      .sort((a, b) => (a.sortOrder - b.sortOrder) || tr(a.name, $locale).localeCompare(tr(b.name, $locale))),
  );
  const childrenOf = (pid: number) =>
    rows.filter((m) => m.parentId === pid)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || tr(a.name, $locale).localeCompare(tr(b.name, $locale)));
  const meetingOf = (m: any) => [m.meetingDay, m.meetingTime].filter(Boolean).join(' · ') || m.defaultSchedule || '—';

  const ministryCount = $derived(all.filter((m) => (m.kind ?? 'ministry') === 'ministry').length);
  const groupCount = $derived(all.filter((m) => m.kind === 'group').length);

  async function duplicate(m: any) {
    busy = m.id;
    try {
      await api('/ministries', {
        method: 'POST',
        body: JSON.stringify({
          name: { ...m.name, en: `${m.name?.en ?? ''} (copy)`.trim(), ...(m.name?.ar ? { ar: `${m.name.ar} (نسخة)` } : {}) },
          description: m.description ?? {}, kind: m.kind ?? 'ministry', category: m.category ?? null,
          ageGroup: m.ageGroup ?? null, location: m.location ?? null, meetingDay: m.meetingDay ?? null, meetingTime: m.meetingTime ?? null,
          defaultSchedule: m.defaultSchedule ?? null, parentId: m.parentId ?? null, sortOrder: m.sortOrder ?? 0, isActive: m.isActive ?? true,
        }),
      });
      await load();
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); } finally { busy = null; }
  }

  async function remove(m: any) {
    const kids = childrenOf(m.id).length;
    const warn = kids > 0
      ? tr({ en: `Delete "${tr(m.name, $locale)}"? Its ${kids} sub-item${kids === 1 ? '' : 's'} will move to the top level.`, ar: `حذف «${tr(m.name, $locale)}»؟ ستنتقل عناصرها الفرعية (${kids}) إلى المستوى الأعلى.` }, $locale)
      : tr({ en: `Delete "${tr(m.name, $locale)}"?`, ar: `حذف «${tr(m.name, $locale)}»؟` }, $locale);
    if (!confirm(warn)) return;
    busy = m.id;
    try { await api(`/ministries/${m.id}`, { method: 'DELETE' }); await load(); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); } finally { busy = null; }
  }
</script>

<PageHeader title={$t('nav.ministries')}>
  {#snippet actions()}
    {#if canCreate}<a href="/ministries/new" class="btn-primary">{$t('common.new')}</a>{/if}
  {/snippet}
</PageHeader>

<PageHint id="ministries-list" text={{ en: 'Ministries are serving teams (worship, ushers, media…). Small groups are home/cell groups. Open any one to manage its team, roles, serving rota and sign-up link.', ar: 'الخدمات هي فرق للخدمة (تسبيح، استقبال، إعلام…). المجموعات الصغيرة هي مجموعات البيوت. افتح أياً منها لإدارة الفريق والأدوار وجدول الخدمة ورابط التسجيل.' }} />

<!-- Ministry / Group tabs -->
<div class="mb-4 inline-flex rounded-lg border border-slate-200 p-1 text-sm dark:border-slate-700">
  <button class="rounded-md px-3 py-1.5 {view === 'ministry' ? 'text-white' : 'text-slate-500'}" style={view === 'ministry' ? 'background: var(--brand)' : ''} onclick={() => (view = 'ministry')}>🙌 {tr({ en: 'Ministries', ar: 'الخدمات' }, $locale)} <span class="opacity-70">· {ministryCount}</span></button>
  <button class="rounded-md px-3 py-1.5 {view === 'group' ? 'text-white' : 'text-slate-500'}" style={view === 'group' ? 'background: var(--brand)' : ''} onclick={() => (view = 'group')}>🏡 {tr({ en: 'Small groups', ar: 'المجموعات' }, $locale)} <span class="opacity-70">· {groupCount}</span></button>
</div>

<div class="card overflow-x-auto">
  {#if loading}
    <p class="p-6 text-slate-400">{$t('common.loading')}</p>
  {:else if rows.length === 0}
    <p class="p-8 text-center text-slate-500">{view === 'group'
      ? tr({ en: 'No small groups yet — create one and set its host, night, and members.', ar: 'لا توجد مجموعات صغيرة بعد — أنشئ واحدة وحدّد المضيف والليلة والأعضاء.' }, $locale)
      : tr({ en: 'No ministries yet — add your first, or group them into sub-ministries.', ar: 'لا توجد خدمات بعد — أضِف أول واحدة أو جمّعها في خدمات فرعية.' }, $locale)}</p>
  {:else}
    <table class="w-full text-sm">
      <thead class="border-b border-slate-200 text-slate-500 dark:border-slate-800">
        <tr>
          <th class="p-3 text-start font-medium">{view === 'group' ? tr({ en: 'Group', ar: 'المجموعة' }, $locale) : tr({ en: 'Ministry', ar: 'الخدمة' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Leader', ar: 'القائد' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Members', ar: 'الأعضاء' }, $locale)}</th>
          <th class="p-3 text-start font-medium">{tr({ en: 'Meets', ar: 'يجتمع' }, $locale)}</th>
          <th class="p-3 text-end font-medium"></th>
        </tr>
      </thead>
      <tbody>
        {#each topLevel as m}{@render branch(m, 0)}{/each}
      </tbody>
    </table>
  {/if}
</div>

{#snippet branch(m: any, depth: number)}
  {@const kids = childrenOf(m.id)}
  <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50 {m.isActive ? '' : 'opacity-60'}">
    <td class="p-3 font-medium">
      <span style="padding-inline-start: {depth * 22}px" class="inline-flex items-center gap-2">
        {#if depth > 0}<span class="text-slate-300 dark:text-slate-600">↳</span>{/if}
        <a class="text-primary-700 hover:underline dark:text-primary-300" href="/ministries/{m.id}">{tr(m.name, $locale) || '—'}</a>
        {#if m.category}<span class="rounded-full px-2 py-0.5 text-xs" style="background: color-mix(in srgb, var(--brand) 12%, transparent); color: var(--brand)">{m.category}</span>{/if}
        {#if kids.length}<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{tr({ en: 'group', ar: 'مجموعة' }, $locale)} · {kids.length}</span>{/if}
        {#if m.openToSignup}<span title={tr({ en: 'Open to public sign-up', ar: 'مفتوح للتسجيل العام' }, $locale)}>🔗</span>{/if}
      </span>
    </td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{m.leaderName || '—'}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{m.memberCount ?? 0}</td>
    <td class="p-3 text-slate-600 dark:text-slate-300">{meetingOf(m)}</td>
    <td class="p-3 text-end whitespace-nowrap">
      <a href="/ministries/{m.id}" class="text-xs text-primary-600 hover:underline dark:text-primary-300">{tr({ en: 'Open', ar: 'فتح' }, $locale)}</a>
      {#if canCreate}<button class="ms-3 text-xs text-slate-500 hover:underline disabled:opacity-50 dark:text-slate-400" disabled={busy === m.id} onclick={() => duplicate(m)}>{tr({ en: 'Duplicate', ar: 'تكرار' }, $locale)}</button>{/if}
      {#if canDelete}<button class="ms-3 text-xs text-rose-600 hover:underline disabled:opacity-50 dark:text-rose-400" disabled={busy === m.id} onclick={() => remove(m)}>{$t('common.delete')}</button>{/if}
    </td>
  </tr>
  {#each kids as c}{@render branch(c, depth + 1)}{/each}
{/snippet}
