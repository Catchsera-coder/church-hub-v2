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
  // Each stage carries a one-line plain-language description, an icon, and a colour
  // accent so the (deliberately similar) stage names are easy to tell apart.
  const STAGES = [
    { v: 'new_visitor', en: 'New / first-time', ar: 'جديد / أول مرة', icon: '🌱',
      dEn: 'First or second visit — reach out and make them feel welcome.',
      dAr: 'أول أو ثاني زيارة — تواصل ورحّب بهم.',
      dot: 'bg-sky-500', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300', bar: 'bg-sky-400' },
    { v: 'contacted', en: 'Contacted', ar: 'تم التواصل', icon: '📞',
      dEn: "You've reached out — a call, text, or welcome message sent.",
      dAr: 'تم التواصل — مكالمة أو رسالة ترحيب.',
      dot: 'bg-violet-500', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', bar: 'bg-violet-400' },
    { v: 'connected', en: 'Connected', ar: 'مندمج', icon: '🤝',
      dEn: 'Engaging back — joined a group, event, or conversation.',
      dAr: 'بدأ الاندماج — انضم لمجموعة أو فعالية أو حوار.',
      dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', bar: 'bg-amber-400' },
    { v: 'regular', en: 'Regular', ar: 'منتظم', icon: '🔄',
      dEn: 'Attends consistently — part of the rhythm of church life.',
      dAr: 'يحضر بانتظام — جزء من إيقاع حياة الكنيسة.',
      dot: 'bg-teal-500', badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300', bar: 'bg-teal-400' },
    { v: 'member', en: 'Member', ar: 'عضو', icon: '⭐',
      dEn: 'Committed & belonging — has joined the church family.',
      dAr: 'ملتزم ومنتمٍ — أصبح عضواً في عائلة الكنيسة.',
      dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', bar: 'bg-emerald-400' },
  ];

  let cols = $state<Record<string, any[]>>({});
  let loading = $state(true);
  let busy = $state(false);
  // The per-stage description line is dismissible and the choice is remembered.
  let showGuide = $state(true);
  function toggleGuide() { showGuide = !showGuide; try { localStorage.setItem('followup-guide', showGuide ? '1' : '0'); } catch { /* ignore */ } }

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
  onMount(() => {
    try { showGuide = localStorage.getItem('followup-guide') !== '0'; } catch { /* ignore */ }
    load();
  });

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

<PageHeader title={tr({ en: 'Follow-up', ar: 'المتابعة' }, $locale)}>
  {#snippet actions()}
    <button class="btn-ghost text-sm" onclick={toggleGuide}>{showGuide ? tr({ en: 'Hide stage guide', ar: 'إخفاء دليل المراحل' }, $locale) : tr({ en: 'Show stage guide', ar: 'إظهار دليل المراحل' }, $locale)}</button>
  {/snippet}
</PageHeader>

<PageHint id="follow-up" text={{ en: 'Turn newcomers into connected members. New/first-time people appear automatically; move each along as you reach out — Contacted → Connected → Regular → Member. Use ✉️ to message or open a card to add a care note.', ar: 'حوّل القادمين الجدد إلى أعضاء مندمجين. يظهر الجدد تلقائياً؛ انقل كلاً مع تواصلك — تم التواصل ← مندمج ← منتظم ← عضو.' }} />

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else}
  <div class="flex gap-3 overflow-x-auto pb-4">
    {#each STAGES as s, i}
      <div class="w-72 shrink-0">
        <!-- Coloured accent bar gives the pipeline a left-to-right sense of progress. -->
        <div class="h-1 rounded-full {s.bar}"></div>
        <div class="mb-2 mt-2 flex items-center justify-between px-1">
          <h2 class="flex items-center gap-1.5 text-sm font-semibold">
            <span>{s.icon}</span>
            <span>{tr({ en: s.en, ar: s.ar }, $locale)}</span>
          </h2>
          <span class="rounded-full px-2 py-0.5 text-xs font-medium {s.badge}">{(cols[s.v] ?? []).length}</span>
        </div>
        {#if showGuide}
          <div class="mb-2 flex items-start gap-1.5 px-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
            <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full {s.dot}"></span>
            <span class="flex-1">{tr({ en: s.dEn, ar: s.dAr }, $locale)}</span>
            {#if i === 0}<button class="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" title={tr({ en: 'Hide these hints', ar: 'إخفاء التلميحات' }, $locale)} aria-label={tr({ en: 'Hide these hints', ar: 'إخفاء التلميحات' }, $locale)} onclick={toggleGuide}>✕</button>{/if}
          </div>
        {/if}
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
