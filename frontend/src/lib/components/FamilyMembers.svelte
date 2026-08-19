<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';

  // In-page family roster: list members, attach existing people (search), quick-add
  // new, or remove. Everything writes people.householdId, so members ↔ families
  // stay in sync automatically.
  let { householdId }: { householdId: number } = $props();

  let members = $state<any[]>([]);
  let loading = $state(true);
  const editable = can('update person');

  // attach existing
  let query = $state('');
  let results = $state<any[]>([]);
  let timer: ReturnType<typeof setTimeout>;
  // quick add new
  let newFirst = $state('');
  let newLast = $state('');
  let busy = $state(false);

  async function load() {
    loading = true;
    try { members = (await api<{ data: any[] }>(`/families/${householdId}/members`)).data; } finally { loading = false; }
  }
  onMount(load);

  function search() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (query.trim().length < 2) { results = []; return; }
      const q = new URLSearchParams({ search: query.trim(), limit: '8' });
      const all = (await api<{ data: any[] }>(`/people?${q}`)).data;
      results = all.filter((p) => !members.some((m) => m.id === p.id));
    }, 250);
  }

  async function attach(p: any) {
    busy = true;
    try { await api(`/people/${p.id}`, { method: 'PUT', body: JSON.stringify({ householdId }) }); query = ''; results = []; await load(); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { busy = false; }
  }

  async function addNew() {
    if (!newFirst.trim()) return;
    busy = true;
    try {
      await api('/people', { method: 'POST', body: JSON.stringify({ givenName: { en: newFirst.trim() }, familyName: { en: newLast.trim() }, householdId }) });
      newFirst = ''; newLast = ''; await load();
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { busy = false; }
  }

  async function remove(m: any) {
    if (!confirm(tr({ en: `Remove ${displayName(m, $nameOrder, $locale)} from this family?`, ar: 'إزالة هذا الشخص من العائلة؟' }, $locale))) return;
    busy = true;
    try { await api(`/people/${m.id}`, { method: 'PUT', body: JSON.stringify({ householdId: null }) }); await load(); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); }
    finally { busy = false; }
  }
</script>

<div class="card p-6">
  <h2 class="mb-3 font-semibold">{tr({ en: 'Family members', ar: 'أفراد العائلة' }, $locale)}</h2>

  {#if loading}
    <p class="text-slate-400">{$t('common.loading')}</p>
  {:else}
    {#if members.length === 0}
      <p class="mb-3 text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'No one in this family yet.', ar: 'لا أحد في هذه العائلة بعد.' }, $locale)}</p>
    {:else}
      <div class="mb-3 divide-y divide-slate-100 dark:divide-slate-800">
        {#each members as m}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm">
            <a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{m.id}">{displayName(m, $nameOrder, $locale)}</a>
            {#if m.householdRole}<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">{m.householdRole}</span>{/if}
            <span class="capitalize text-slate-400">{m.membershipStatus}</span>
            {#if editable}<button class="ms-auto text-xs text-rose-600 hover:underline dark:text-rose-400" onclick={() => remove(m)}>{tr({ en: 'Remove', ar: 'إزالة' }, $locale)}</button>{/if}
            {#if m.mobile || m.email}
              <div class="force-ltr w-full ps-0.5 text-xs text-slate-400">
                {#if m.mobile}<a href="tel:{m.mobile}" class="hover:underline">{m.mobile}</a>{/if}
                {#if m.mobile && m.email}<span class="mx-1">·</span>{/if}
                {#if m.email}<a href="mailto:{m.email}" class="hover:underline">{m.email}</a>{/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if editable}
      <div class="space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <!-- Attach existing -->
        <div class="relative">
          <label class="mb-1 block text-xs text-slate-500">{tr({ en: 'Add an existing person', ar: 'إضافة شخص موجود' }, $locale)}</label>
          <input class="input" bind:value={query} oninput={search} placeholder={tr({ en: 'Search by name…', ar: 'ابحث بالاسم…' }, $locale)} />
          {#if results.length}
            <div class="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow dark:border-slate-700 dark:bg-slate-900">
              {#each results as p}
                <button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => attach(p)}>{displayName(p, $nameOrder, $locale)}</button>
              {/each}
            </div>
          {/if}
        </div>
        <!-- Quick add new -->
        <div>
          <label class="mb-1 block text-xs text-slate-500">{tr({ en: 'Or add someone new', ar: 'أو أضف شخصاً جديداً' }, $locale)}</label>
          <div class="flex flex-wrap gap-2">
            <input class="input flex-1" bind:value={newFirst} placeholder={tr({ en: 'First name', ar: 'الاسم الأول' }, $locale)} />
            <input class="input flex-1" bind:value={newLast} placeholder={tr({ en: 'Last name', ar: 'اسم العائلة' }, $locale)} />
            <button class="btn-primary shrink-0" onclick={addNew} disabled={busy || !newFirst.trim()}>{tr({ en: 'Add', ar: 'إضافة' }, $locale)}</button>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</div>
