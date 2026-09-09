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

  async function load() {
    loading = true;
    try { rows = (await api<{ data: Row[] }>(`/people/reengagement?weeks=${weeks}`)).data; }
    finally { loading = false; }
  }
  onMount(load);

  function weeksAgo(iso: string | null): string {
    if (!iso) return '';
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / (7 * 864e5));
    return String(d);
  }
  async function act(r: Row, fn: () => Promise<unknown>) {
    busy = r.id;
    try { await fn(); rows = rows.filter((x) => x.id !== r.id); }
    catch (err) { alert((err as Error).message); } finally { busy = null; }
  }
  const workOnIt = (r: Row) => act(r, () => api(`/people/${r.id}`, { method: 'PUT', body: JSON.stringify({ followUpStage: 'contacted' }) }));
  const snooze = (r: Row) => act(r, () => api(`/people/${r.id}/snooze`, { method: 'POST', body: '{}' }));
  const archive = (r: Row) => { if (!confirm(tr({ en: 'Archive this person? They leave the active lists.', ar: 'أرشفة هذا الشخص؟ سيغادر القوائم النشطة.' }, $locale))) return; return act(r, () => api(`/people/${r.id}/archive`, { method: 'POST', body: '{}' })); };
  const message = (r: Row) => goto(`/messages/new?people=${r.id}`);
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

<PageHint id="reengagement" text={{ en: 'People worth reaching out to: those who used to attend but have gone quiet, and long-time visitors who never got connected. For each, click “Working on it” to start a follow-up, “Snooze” to hide them for 3 months, message them, or archive. The list only shows people not already being followed up or snoozed.', ar: 'أشخاص يستحقون التواصل: من كانوا يحضرون وانقطعوا، والزوار القدامى الذين لم يندمجوا. لكل شخص اضغط «قيد المتابعة» لبدء متابعة، أو «تأجيل» لإخفائه ٣ أشهر، أو راسله، أو أرشفه.' }} />

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else if rows.length === 0}
  <div class="card p-10 text-center text-slate-500">{tr({ en: 'Nobody needs attention right now — everyone’s connected or being followed up. 🎉', ar: 'لا أحد يحتاج متابعة الآن — الجميع مندمج أو قيد المتابعة. 🎉' }, $locale)}</div>
{:else}
  <p class="mb-3 text-sm text-slate-500">{rows.length} {tr({ en: 'people to re-engage', ar: 'شخصاً لإعادة التواصل معهم' }, $locale)}</p>
  <div class="space-y-2">
    {#each rows as r (r.id)}
      <div class="card p-4">
        <div class="flex flex-wrap items-start gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{r.id}">{nm(r)}</a>
              {#if r.reason === 'lapsed'}
                <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">💤 {tr({ en: 'Lapsed', ar: 'انقطع' }, $locale)} · {weeksAgo(r.lastSeen)} {tr({ en: 'wks', ar: 'أسبوع' }, $locale)}</span>
              {:else}
                <span class="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">🌱 {tr({ en: 'Never connected', ar: 'لم يندمج' }, $locale)}{#if r.firstSeenYear} · {tr({ en: 'since', ar: 'منذ' }, $locale)} {r.firstSeenYear}{/if}</span>
              {/if}
              <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-500 dark:bg-slate-800 dark:text-slate-400">{r.membershipStatus}</span>
            </div>
            <div class="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500 dark:text-slate-400">
              {#if r.householdName}<span>👪 {tr(r.householdName, $locale)}</span>{/if}
              {#if r.email}<span class="force-ltr">{r.email}</span>{/if}
              {#if r.mobile}<span class="force-ltr">{r.mobile}</span>{/if}
              {#if r.reason === 'lapsed' && r.lastSeen}<span>{tr({ en: 'last seen', ar: 'آخر حضور' }, $locale)} {r.lastSeen.slice(0, 10)} · {r.visits} {tr({ en: 'visits', ar: 'حضور' }, $locale)}</span>{/if}
              {#if r.sourceList}<span class="text-slate-400">· {r.sourceList}</span>{/if}
            </div>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-1">
            {#if editable}<button class="btn-ghost text-xs" style="color: var(--brand)" disabled={busy === r.id} onclick={() => workOnIt(r)}>👋 {tr({ en: 'Working on it', ar: 'قيد المتابعة' }, $locale)}</button>{/if}
            {#if canMessage}<button class="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title={tr({ en: 'Message', ar: 'رسالة' }, $locale)} onclick={() => message(r)}>✉️</button>{/if}
            {#if editable}<button class="btn-ghost text-xs" disabled={busy === r.id} onclick={() => snooze(r)}>💤 {tr({ en: 'Snooze', ar: 'تأجيل' }, $locale)}</button>{/if}
            {#if editable}<button class="rounded p-1 text-xs text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" title={tr({ en: 'Archive', ar: 'أرشفة' }, $locale)} disabled={busy === r.id} onclick={() => archive(r)}>🗄</button>{/if}
          </div>
        </div>
      </div>
    {/each}
  </div>
{/if}
