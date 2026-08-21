<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';

  let { ministryId }: { ministryId: number } = $props();
  const editable = can('update ministry');

  let assignments = $state<any[]>([]);
  let loading = $state(true);
  let busy = $state(false);

  // new assignment
  let date = $state('');
  let role = $state('');
  let query = $state('');
  let results = $state<any[]>([]);
  let picked = $state<any>(null);
  let timer: ReturnType<typeof setTimeout>;

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 70 * 86400000).toISOString().slice(0, 10);

  async function load() {
    loading = true;
    try { assignments = (await api<{ data: any[] }>(`/ministries/${ministryId}/assignments?from=${from}&to=${to}`)).data; } finally { loading = false; }
  }
  onMount(load);

  function search() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (query.trim().length < 2) { results = []; return; }
      results = (await api<{ data: any[] }>(`/people?search=${encodeURIComponent(query.trim())}&limit=8`)).data;
    }, 220);
  }
  function pick(p: any) { picked = p; query = displayName(p, $nameOrder, $locale); results = []; }

  async function addAssignment() {
    if (!picked || !date) return;
    busy = true;
    try {
      await api(`/ministries/${ministryId}/assignments`, { method: 'POST', body: JSON.stringify({ personId: picked.id, serveDate: date, role: role.trim() || null }) });
      picked = null; query = ''; role = ''; await load();
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); } finally { busy = false; }
  }
  async function setStatus(a: any, status: string) {
    try { await api(`/ministries/${ministryId}/assignments/${a.id}`, { method: 'PUT', body: JSON.stringify({ status }) }); await load(); }
    catch (err) { alert((err as Error).message); }
  }
  async function del(a: any) {
    try { await api(`/ministries/${ministryId}/assignments/${a.id}`, { method: 'DELETE' }); await load(); }
    catch (err) { alert((err as Error).message); }
  }
  async function remind(dateKey: string) {
    if (!confirm(tr({ en: `Send a serving reminder to everyone rostered on ${dateKey}?`, ar: `إرسال تذكير خدمة لكل المُعيّنين في ${dateKey}؟` }, $locale))) return;
    busy = true;
    try {
      const r = await api<{ data: { sent: number; total: number } }>(`/ministries/${ministryId}/assignments/remind`, { method: 'POST', body: JSON.stringify({ serveDate: dateKey }) });
      alert(tr({ en: `Reminders sent to ${r.data.sent} of ${r.data.total}.`, ar: `أُرسلت التذكيرات إلى ${r.data.sent} من ${r.data.total}.` }, $locale));
      await load();
    } catch (err) { alert((err as Error).message); } finally { busy = false; }
  }

  const byDate = $derived.by(() => {
    const map = new Map<string, any[]>();
    for (const a of assignments) { if (!map.has(a.serveDate)) map.set(a.serveDate, []); map.get(a.serveDate)!.push(a); }
    return [...map.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  });
  const statusChip = (s: string) => s === 'confirmed'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    : s === 'declined' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
</script>

<div class="card p-5 sm:p-6">
  <div class="mb-1 flex items-center gap-2">
    <h2 class="font-semibold">🗓️ {tr({ en: 'Serving rota', ar: 'جدول الخدمة' }, $locale)}</h2>
  </div>
  <p class="mb-4 text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'Schedule who serves on which date, then send reminders. Upcoming 10 weeks.', ar: 'حدّد من يخدم في كل تاريخ ثم أرسل التذكيرات. الأسابيع العشرة القادمة.' }, $locale)}</p>

  {#if editable}
    <div class="relative mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
      <label class="space-y-1 text-xs text-slate-500">
        <span class="block">{tr({ en: 'Date', ar: 'التاريخ' }, $locale)}</span>
        <input class="input force-ltr w-40" type="date" bind:value={date} min={from} />
      </label>
      <label class="min-w-[10rem] flex-1 space-y-1 text-xs text-slate-500">
        <span class="block">{tr({ en: 'Person', ar: 'الشخص' }, $locale)}</span>
        <input class="input" bind:value={query} oninput={() => { picked = null; search(); }} placeholder={tr({ en: 'Search…', ar: 'ابحث…' }, $locale)} />
      </label>
      <label class="w-32 space-y-1 text-xs text-slate-500">
        <span class="block">{tr({ en: 'Role', ar: 'الدور' }, $locale)}</span>
        <input class="input" bind:value={role} placeholder={tr({ en: 'e.g. Vocals', ar: 'مثال: كورال' }, $locale)} maxlength="60" />
      </label>
      <button class="btn-primary" onclick={addAssignment} disabled={busy || !picked || !date}>{tr({ en: 'Assign', ar: 'تعيين' }, $locale)}</button>
      {#if results.length}
        <div class="absolute left-40 top-[4.5rem] z-20 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {#each results as p}
            <button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => pick(p)}>{displayName(p, $nameOrder, $locale)}</button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if loading}
    <p class="text-slate-400">{$t('common.loading')}</p>
  {:else if byDate.length === 0}
    <p class="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">{tr({ en: 'No serving dates scheduled yet.', ar: 'لا توجد تواريخ خدمة مجدولة بعد.' }, $locale)}</p>
  {:else}
    <div class="space-y-4">
      {#each byDate as [d, list]}
        <div class="rounded-xl border border-slate-200 dark:border-slate-700">
          <div class="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 dark:border-slate-800">
            <span class="force-ltr text-sm font-semibold">{d}</span>
            {#if editable}<button class="text-xs text-slate-500 hover:underline" onclick={() => remind(d)} disabled={busy}>🔔 {tr({ en: 'Send reminders', ar: 'إرسال التذكيرات' }, $locale)}</button>{/if}
          </div>
          <ul class="divide-y divide-slate-100 dark:divide-slate-800">
            {#each list as a (a.id)}
              <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{a.personId}">{displayName(a, $nameOrder, $locale)}</a>
                {#if a.role}<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{a.role}</span>{/if}
                <span class="rounded-full px-2 py-0.5 text-xs {statusChip(a.status)}">{a.status}</span>
                {#if a.reminderSentAt}<span class="text-xs text-slate-400">🔔</span>{/if}
                {#if editable}
                  <div class="ms-auto flex items-center gap-1">
                    <button class="rounded p-1 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/30" title={tr({ en: 'Confirmed', ar: 'مؤكّد' }, $locale)} onclick={() => setStatus(a, 'confirmed')}>✓</button>
                    <button class="rounded p-1 text-xs hover:bg-rose-50 dark:hover:bg-rose-900/30" title={tr({ en: 'Declined', ar: 'اعتذر' }, $locale)} onclick={() => setStatus(a, 'declined')}>✕</button>
                    <button class="rounded p-1 text-xs text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" title={$t('common.delete')} onclick={() => del(a)}>🗑️</button>
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
