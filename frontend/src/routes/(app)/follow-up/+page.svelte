<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, displayName, personContext } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  const editable = can('update person');
  const canMessage = can('create message');

  // The assimilation pipeline. First stage auto-includes un-staged self-registered
  // newcomers (handled server-side), so new people appear without extra work.
  const STAGES = [
    { v: 'new_visitor', en: 'New / first-time', ar: 'جديد / أول مرة' },
    { v: 'contacted', en: 'Contacted', ar: 'تم التواصل' },
    { v: 'connected', en: 'Connected', ar: 'مندمج' },
    { v: 'regular', en: 'Regular', ar: 'منتظم' },
    { v: 'member', en: 'Member', ar: 'عضو' },
  ];

  let cols = $state<Record<string, any[]>>({});
  let loading = $state(true);
  let busy = $state(false);

  async function loadStage(stage: string) {
    try { return (await api<{ data: any[] }>(`/people?followUpStage=${stage}&limit=100`)).data; }
    catch { return []; }
  }
  async function load() {
    loading = true;
    try {
      const results = await Promise.all(STAGES.map((s) => loadStage(s.v)));
      const next: Record<string, any[]> = {};
      STAGES.forEach((s, i) => { next[s.v] = results[i]; });
      cols = next;
    } finally { loading = false; }
  }
  onMount(load);

  async function move(p: any, stage: string) {
    busy = true;
    try {
      // Setting a stage on an unreviewed newcomer also marks them reviewed so they
      // leave the "needs review" queue as they enter the pipeline.
      const body: Record<string, unknown> = { followUpStage: stage };
      await api(`/people/${p.id}`, { method: 'PUT', body: JSON.stringify(body) });
      if (p.selfRegistered && !p.reviewedAt) { try { await api(`/people/${p.id}/review`, { method: 'POST', body: '{}' }); } catch { /* ok */ } }
      await load();
    } catch (err) { alert((err as Error).message); } finally { busy = false; }
  }
  function messagePerson(p: any) { goto(`/messages/new?people=${p.id}`); }
</script>

<PageHeader title={tr({ en: 'Follow-up', ar: 'المتابعة' }, $locale)} />

<PageHint id="follow-up" text={{ en: 'Turn newcomers into connected members. New/first-time people appear automatically; move each along as you reach out — Contacted → Connected → Regular → Member. Use ✉️ to message or open a card to add a care note.', ar: 'حوّل القادمين الجدد إلى أعضاء مندمجين. يظهر الجدد تلقائياً؛ انقل كلاً مع تواصلك — تم التواصل ← مندمج ← منتظم ← عضو.' }} />

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else}
  <div class="flex gap-3 overflow-x-auto pb-4">
    {#each STAGES as s}
      <div class="w-72 shrink-0">
        <div class="mb-2 flex items-center justify-between px-1">
          <h2 class="text-sm font-semibold">{tr({ en: s.en, ar: s.ar }, $locale)}</h2>
          <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800">{(cols[s.v] ?? []).length}</span>
        </div>
        <div class="space-y-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-800/40">
          {#each cols[s.v] ?? [] as p (p.id)}
            <div class="card p-3">
              <a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{p.id}">{displayName(p, $nameOrder, $locale)}</a>
              {#if personContext(p, $locale)}<div class="mt-0.5 text-xs text-slate-400">{personContext(p, $locale)}</div>{/if}
              {#if p.mobile || p.email}<div class="force-ltr mt-1 text-xs text-slate-500 dark:text-slate-400">{p.mobile || p.email}</div>{/if}
              <div class="mt-2 flex items-center gap-1">
                {#if editable}
                  <select class="input h-8 flex-1 py-0 text-xs" value={p.followUpStage ?? s.v} disabled={busy} onchange={(e) => move(p, (e.currentTarget as HTMLSelectElement).value)}>
                    {#each STAGES as st}<option value={st.v}>{tr({ en: st.en, ar: st.ar }, $locale)}</option>{/each}
                  </select>
                {/if}
                {#if canMessage}<button class="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title={tr({ en: 'Message', ar: 'رسالة' }, $locale)} onclick={() => messagePerson(p)}>✉️</button>{/if}
              </div>
            </div>
          {:else}
            <p class="px-2 py-6 text-center text-xs text-slate-400">{tr({ en: 'Empty', ar: 'فارغ' }, $locale)}</p>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/if}
