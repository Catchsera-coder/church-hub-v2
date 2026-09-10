<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';

  const editable = can('update person');
  const canDelete = can('delete person');

  let removed = $state<any[]>([]);
  let deleted = $state<any[]>([]);
  let groups = $state<any[]>([]);
  let groupBy = $state<'full' | 'last'>('full');
  let loading = $state(true);
  let busy = $state<number | null>(null);

  async function loadRemoved() { try { removed = (await api<{ data: any[] }>('/people/removed-from-family')).data; } catch { removed = []; } }
  async function loadDeleted() { try { deleted = (await api<{ data: any[] }>('/people/deleted')).data; } catch { deleted = []; } }
  async function loadGroups() { try { groups = (await api<{ data: any[] }>(`/people/name-groups?by=${groupBy}`)).data; } catch { groups = []; } }
  async function loadAll() { loading = true; try { await Promise.all([loadRemoved(), loadDeleted(), loadGroups()]); } finally { loading = false; } }
  onMount(loadAll);

  const nm = (p: any) => displayName(p, $nameOrder, $locale);

  async function restoreFamily(p: any) {
    busy = p.id;
    try { await api(`/people/${p.id}`, { method: 'PUT', body: JSON.stringify({ householdId: p.priorHouseholdId }) }); await loadRemoved(); }
    catch (err) { alert((err as Error).message); } finally { busy = null; }
  }
  async function undelete(p: any) {
    busy = p.id;
    try { await api(`/people/${p.id}/undelete`, { method: 'POST', body: '{}' }); await loadDeleted(); }
    catch (err) { alert((err as Error).message); } finally { busy = null; }
  }
  // Split a same-name person into their own household — the low-effort de-merge for
  // people who only share a surname (e.g. a different Ghobrial family).
  async function ownHousehold(p: any) {
    if (!confirm(tr({ en: `Move ${nm(p)} into their own new family?`, ar: `نقل ${nm(p)} إلى عائلته الخاصة الجديدة؟` }, $locale))) return;
    busy = p.id;
    try {
      const name: Record<string, string> = {};
      if (p.familyName?.en) name.en = p.familyName.en;
      if (p.familyName?.ar) name.ar = p.familyName.ar;
      if (!name.en && !name.ar) name.en = nm(p) || 'Family';
      const created = await api<{ data: { id: number } }>('/families', { method: 'POST', body: JSON.stringify({ name, homePhone: p.mobile ?? null }) });
      await api(`/people/${p.id}`, { method: 'PUT', body: JSON.stringify({ householdId: created.data.id, householdRole: 'head' }) });
      await loadGroups();
    } catch (err) { alert((err as Error).message); } finally { busy = null; }
  }
  function setGroupBy(v: 'full' | 'last') { if (v === groupBy) return; groupBy = v; loadGroups(); }
</script>

<PageHeader title={tr({ en: 'Restore & cleanup', ar: 'استعادة وتنظيف' }, $locale)} />

<PageHint id="cleanup" text={{ en: 'Undo mistakes and tidy your directory: bring back people removed from a family, restore anyone deleted, and split apart people who only share a last name into their own households. Nothing here loses data.', ar: 'تراجع عن الأخطاء ونظّم الدليل: أعِد من أُزيل من عائلة، واستعد من حُذف، وافصل من يتشاركون اللقب فقط إلى عائلات خاصة بهم. لا شيء هنا يفقد بيانات.' }} />

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else}
  <div class="space-y-6">
    <!-- 1. Removed from families -->
    <section class="card p-5">
      <h2 class="mb-1 font-semibold">↩ {tr({ en: 'Removed from a family', ar: 'أُزيل من عائلة' }, $locale)}
        <span class="ms-1 text-sm font-normal text-slate-400">({removed.length})</span></h2>
      <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Still members — restore them to the family they were last in.', ar: 'ما زالوا أعضاء — أعِدهم إلى العائلة التي كانوا بها.' }, $locale)}</p>
      {#if removed.length === 0}
        <p class="rounded-lg bg-slate-50 px-4 py-4 text-center text-sm text-slate-400 dark:bg-slate-800/50">{tr({ en: 'Nobody to restore.', ar: 'لا أحد للاستعادة.' }, $locale)}</p>
      {:else}
        <ul class="space-y-2">
          {#each removed as p (p.id)}
            <li class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{p.id}">{nm(p)}</a>
              <span class="text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'was in', ar: 'كان في' }, $locale)}
                {#if p.priorHouseholdName}👪 {tr(p.priorHouseholdName, $locale)}{:else}—{/if}</span>
              {#if editable && p.priorHouseholdId}
                <button class="ms-auto rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:bg-transparent dark:text-emerald-300" disabled={busy === p.id} onclick={() => restoreFamily(p)}>↩ {tr({ en: 'Restore to family', ar: 'استعادة إلى العائلة' }, $locale)}</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- 2. Recently deleted -->
    <section class="card p-5">
      <h2 class="mb-1 font-semibold">🗑 {tr({ en: 'Recently deleted', ar: 'المحذوفون مؤخراً' }, $locale)}
        <span class="ms-1 text-sm font-normal text-slate-400">({deleted.length})</span></h2>
      <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Deleting is soft — the record is kept and can be restored at any time.', ar: 'الحذف مؤقت — يُحتفظ بالسجل ويمكن استعادته في أي وقت.' }, $locale)}</p>
      {#if deleted.length === 0}
        <p class="rounded-lg bg-slate-50 px-4 py-4 text-center text-sm text-slate-400 dark:bg-slate-800/50">{tr({ en: 'Nothing deleted.', ar: 'لا شيء محذوف.' }, $locale)}</p>
      {:else}
        <ul class="space-y-2">
          {#each deleted as p (p.id)}
            <li class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <span class="font-medium">{nm(p)}</span>
              <span class="force-ltr text-xs text-slate-400">{#if p.email}{p.email}{:else if p.mobile}{p.mobile}{/if}</span>
              {#if p.deletedAt}<span class="force-ltr text-xs text-slate-400">· {String(p.deletedAt).slice(0, 10)}</span>{/if}
              {#if canDelete}
                <button class="ms-auto rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:bg-transparent dark:text-emerald-300" disabled={busy === p.id} onclick={() => undelete(p)}>♻️ {tr({ en: 'Restore', ar: 'استعادة' }, $locale)}</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- 3. Same-name groups -->
    <section class="card p-5">
      <div class="mb-1 flex flex-wrap items-center gap-3">
        <h2 class="font-semibold">👥 {tr({ en: 'Same name', ar: 'أسماء متطابقة' }, $locale)}
          <span class="ms-1 text-sm font-normal text-slate-400">({groups.length})</span></h2>
        <div class="ms-auto inline-flex rounded-lg border border-slate-200 p-0.5 text-xs dark:border-slate-700">
          <button class="rounded-md px-2.5 py-1 font-medium {groupBy === 'full' ? 'bg-primary-600 text-white' : 'text-slate-600 dark:text-slate-300'}" onclick={() => setGroupBy('full')}>{tr({ en: 'Same full name', ar: 'الاسم الكامل' }, $locale)}</button>
          <button class="rounded-md px-2.5 py-1 font-medium {groupBy === 'last' ? 'bg-primary-600 text-white' : 'text-slate-600 dark:text-slate-300'}" onclick={() => setGroupBy('last')}>{tr({ en: 'Same last name', ar: 'اللقب فقط' }, $locale)}</button>
        </div>
      </div>
      <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Same full name may be a duplicate. Same last name is usually different families — use “Own family” to split anyone grouped wrongly.', ar: 'الاسم الكامل المتطابق قد يكون تكراراً. اللقب المتطابق عادةً عائلات مختلفة — استخدم «عائلته الخاصة» لفصل من جُمِع بالخطأ.' }, $locale)}</p>
      {#if groups.length === 0}
        <p class="rounded-lg bg-slate-50 px-4 py-4 text-center text-sm text-slate-400 dark:bg-slate-800/50">{tr({ en: 'No matches.', ar: 'لا تطابقات.' }, $locale)}</p>
      {:else}
        <div class="space-y-3">
          {#each groups as g (g.key)}
            <div class="rounded-xl border border-slate-200 dark:border-slate-700">
              <div class="border-b border-slate-200 px-3 py-2 text-sm font-medium capitalize dark:border-slate-700">{g.key} <span class="text-xs font-normal text-slate-400">· {g.count}</span></div>
              <ul class="divide-y divide-slate-100 dark:divide-slate-800">
                {#each g.people as p (p.id)}
                  <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{p.id}">{nm(p)}</a>
                    <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-500 dark:bg-slate-800 dark:text-slate-400">{p.membershipStatus}</span>
                    {#if p.householdId}
                      <a class="text-xs text-slate-500 hover:underline dark:text-slate-400" href="/families/{p.householdId}">👪 {p.householdName ? tr(p.householdName, $locale) : tr({ en: 'family', ar: 'عائلة' }, $locale)}</a>
                    {:else}
                      <span class="text-xs text-slate-400">{tr({ en: 'no family', ar: 'بدون عائلة' }, $locale)}</span>
                    {/if}
                    {#if p.email || p.mobile}<span class="force-ltr text-xs text-slate-400">{p.email || p.mobile}</span>{/if}
                    {#if editable}
                      <button class="ms-auto rounded-md border border-primary-200 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50 dark:border-primary-800 dark:text-primary-300 dark:hover:bg-primary-900/30" disabled={busy === p.id} onclick={() => ownHousehold(p)} title={tr({ en: 'Move to their own new family', ar: 'نقله إلى عائلته الخاصة الجديدة' }, $locale)}>🏠 {tr({ en: 'Own family', ar: 'عائلته الخاصة' }, $locale)}</button>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
{/if}
