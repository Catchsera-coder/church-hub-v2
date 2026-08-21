<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';

  let { ministryId, ministry }: { ministryId: number; ministry: any } = $props();

  const editable = can('update ministry');
  const canMessage = can('create message');
  const needsClearance = $derived(ministry?.ageGroup === 'children' || ministry?.ageGroup === 'youth');

  let members = $state<any[]>([]);
  let loading = $state(true);
  let busy = $state(false);

  // add member
  let showAdd = $state(false);
  let query = $state('');
  let results = $state<any[]>([]);
  let addRole = $state('volunteer');
  let timer: ReturnType<typeof setTimeout>;

  const ROLES = [
    { v: 'leader', en: 'Leader', ar: 'قائد' },
    { v: 'coordinator', en: 'Coordinator', ar: 'منسّق' },
    { v: 'volunteer', en: 'Volunteer', ar: 'متطوّع' },
    { v: 'member', en: 'Member', ar: 'عضو' },
  ];
  const roleLabel = (v: string) => { const r = ROLES.find((x) => x.v === v); return r ? tr({ en: r.en, ar: r.ar }, $locale) : v; };

  async function load() {
    loading = true;
    try { members = (await api<{ data: any[] }>(`/ministries/${ministryId}/members`)).data; } finally { loading = false; }
  }
  onMount(load);

  function search() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (query.trim().length < 2) { results = []; return; }
      const all = (await api<{ data: any[] }>(`/people?search=${encodeURIComponent(query.trim())}&limit=8`)).data;
      results = all.filter((p) => !members.some((m) => m.id === p.id));
    }, 220);
  }
  async function add(p: any) {
    busy = true;
    try {
      const today = new Date().toISOString().slice(0, 10);
      await api(`/ministries/${ministryId}/members`, { method: 'POST', body: JSON.stringify({ personId: p.id, role: addRole, servingSince: today }) });
      query = ''; results = []; await load();
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); } finally { busy = false; }
  }
  async function setRole(m: any, role: string) {
    try { await api(`/ministries/${ministryId}/members/${m.id}`, { method: 'PUT', body: JSON.stringify({ role }) }); await load(); }
    catch (err) { alert((err as Error).message); }
  }
  async function toggleStatus(m: any) {
    const status = m.status === 'active' ? 'paused' : 'active';
    try { await api(`/ministries/${ministryId}/members/${m.id}`, { method: 'PUT', body: JSON.stringify({ status }) }); await load(); }
    catch (err) { alert((err as Error).message); }
  }
  async function remove(m: any) {
    if (!confirm(tr({ en: `Remove ${displayName(m, $nameOrder, $locale)} from this ministry?`, ar: 'إزالة هذا الشخص من الخدمة؟' }, $locale))) return;
    try { await api(`/ministries/${ministryId}/members/${m.id}`, { method: 'DELETE' }); await load(); }
    catch (err) { alert((err as Error).message); }
  }
  function messageTeam() {
    const ids = members.filter((m) => m.status === 'active').map((m) => m.id);
    if (ids.length) goto(`/messages/new?people=${ids.join(',')}`);
  }

  const grouped = $derived.by(() => {
    const order = ['leader', 'coordinator', 'volunteer', 'member'];
    return order.map((role) => ({ role, people: members.filter((m) => m.role === role) })).filter((g) => g.people.length);
  });
</script>

<div class="card p-5 sm:p-6">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h2 class="font-semibold">{tr({ en: 'Team', ar: 'الفريق' }, $locale)}
      <span class="ms-1 text-sm font-normal text-slate-400">({members.length}{#if ministry?.capacity}/{ministry.capacity}{/if})</span>
    </h2>
    <div class="flex items-center gap-2">
      {#if canMessage && members.length}<button class="btn-ghost text-sm" onclick={messageTeam}>✉️ {tr({ en: 'Message team', ar: 'راسل الفريق' }, $locale)}</button>{/if}
      {#if editable}<button class="btn-ghost text-sm" style="color: var(--brand)" onclick={() => (showAdd = !showAdd)}>{showAdd ? tr({ en: '✕ Close', ar: '✕ إغلاق' }, $locale) : tr({ en: '+ Add', ar: '+ إضافة' }, $locale)}</button>{/if}
    </div>
  </div>

  {#if editable && showAdd}
    <div class="relative mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
      <div class="flex flex-wrap gap-2">
        <input class="input min-w-[10rem] flex-1" bind:value={query} oninput={search} placeholder={tr({ en: 'Search a person to add…', ar: 'ابحث عن شخص لإضافته…' }, $locale)} />
        <select class="input w-36" bind:value={addRole}>{#each ROLES as r}<option value={r.v}>{tr({ en: r.en, ar: r.ar }, $locale)}</option>{/each}</select>
      </div>
      {#if results.length}
        <div class="absolute z-20 mt-1 w-[calc(100%-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {#each results as p}
            <button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => add(p)} disabled={busy}>{displayName(p, $nameOrder, $locale)}</button>
          {/each}
        </div>
      {/if}
      <p class="mt-2 text-xs text-slate-400">{tr({ en: 'Tip: assign a Leader so the team has a clear contact.', ar: 'نصيحة: عيّن قائداً ليكون للفريق جهة تواصل واضحة.' }, $locale)}</p>
    </div>
  {/if}

  {#if loading}
    <p class="text-slate-400">{$t('common.loading')}</p>
  {:else if members.length === 0}
    <p class="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">{tr({ en: 'No one on this team yet.', ar: 'لا أحد في هذا الفريق بعد.' }, $locale)}</p>
  {:else}
    <div class="space-y-5">
      {#each grouped as g}
        <div>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{roleLabel(g.role)} <span class="text-slate-300 dark:text-slate-600">· {g.people.length}</span></h3>
          <ul class="space-y-1.5">
            {#each g.people as m (m.id)}
              <li class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-100 px-3 py-2 text-sm dark:border-slate-800 {m.status === 'paused' ? 'opacity-60' : ''}">
                <a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{m.id}">{displayName(m, $nameOrder, $locale)}</a>
                {#if m.status === 'paused'}<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800">{tr({ en: 'paused', ar: 'متوقّف' }, $locale)}</span>{/if}
                {#if needsClearance && !m.clearanceOk}<span class="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" title={tr({ en: 'No valid safeguarding clearance on file', ar: 'لا يوجد تصريح حماية ساري' }, $locale)}>⚠️ {tr({ en: 'no clearance', ar: 'بلا تصريح' }, $locale)}</span>{/if}
                {#if m.servingSince}<span class="text-xs text-slate-400 force-ltr">{tr({ en: 'since', ar: 'منذ' }, $locale)} {m.servingSince}</span>{/if}
                {#if m.skills?.length}<span class="text-xs text-slate-400">· {m.skills.slice(0, 3).join(', ')}</span>{/if}
                {#if editable}
                  <div class="ms-auto flex items-center gap-1">
                    <select class="input h-8 w-32 py-0 text-xs" value={m.role} onchange={(e) => setRole(m, (e.currentTarget as HTMLSelectElement).value)}>
                      {#each ROLES as r}<option value={r.v}>{tr({ en: r.en, ar: r.ar }, $locale)}</option>{/each}
                    </select>
                    <button class="rounded p-1 text-xs text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" title={tr({ en: 'Pause / resume', ar: 'إيقاف / استئناف' }, $locale)} onclick={() => toggleStatus(m)}>{m.status === 'active' ? '⏸' : '▶'}</button>
                    <button class="rounded p-1 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" title={tr({ en: 'Remove', ar: 'إزالة' }, $locale)} onclick={() => remove(m)}>🗑️</button>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  {/if}
</div>
