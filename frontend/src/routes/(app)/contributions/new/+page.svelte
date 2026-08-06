<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let funds = $state<any[]>([]);
  let error = $state('');
  let saving = $state(false);

  // Person typeahead
  let personQuery = $state('');
  let personResults = $state<any[]>([]);
  let personId = $state<number | null>(null);
  let personLabel = $state('');
  let searchTimer: ReturnType<typeof setTimeout>;
  // Inline "quick create" for a new donor, so the admin never has to leave this
  // form (#23). Gated on `create person` — Finance can record gifts but may not
  // be allowed to add people, in which case the option is simply hidden.
  let creatingPerson = $state(false);

  let form = $state({
    fundId: null as number | null,
    amount: '' as string,
    receivedOn: new Date().toISOString().slice(0, 10),
    method: 'cash',
    reference: '',
    isAnonymous: false,
    notes: '',
  });

  onMount(async () => {
    funds = (await api<{ data: any[] }>('/funds')).data;
    if (funds.length) form.fundId = funds[0].id;
  });

  function searchPeople() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!personQuery.trim()) { personResults = []; return; }
      const q = new URLSearchParams({ search: personQuery.trim(), limit: '8' });
      personResults = (await api<{ data: any[] }>(`/people?${q}`)).data;
    }, 250);
  }
  function pickPerson(p: any) {
    personId = p.id;
    personLabel = `${tr(p.givenName, $locale)} ${tr(p.familyName, $locale)}`.trim();
    personResults = [];
    personQuery = personLabel;
  }

  // Create a new person from the typed name (first token = first name, rest =
  // last name) and select them as the donor. Added as a 'visitor', matching the
  // self-check-in "add new" behaviour.
  async function addPersonFromQuery() {
    const name = personQuery.trim();
    if (!name || creatingPerson) return;
    const parts = name.split(/\s+/);
    const given = parts[0];
    const family = parts.slice(1).join(' ');
    creatingPerson = true; error = '';
    try {
      const { data } = await api<{ data: any }>('/people', {
        method: 'POST',
        body: JSON.stringify({
          givenName: { [$locale]: given },
          familyName: family ? { [$locale]: family } : {},
          membershipStatus: 'visitor',
        }),
      });
      pickPerson(data);
    } catch (err) {
      error = (err as Error).message;
    } finally { creatingPerson = false; }
  }

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      await api('/contributions', {
        method: 'POST',
        body: JSON.stringify({
          fundId: form.fundId,
          personId: form.isAnonymous ? null : personId,
          amount: Number(form.amount),
          receivedOn: form.receivedOn,
          method: form.method,
          reference: form.reference || null,
          isAnonymous: form.isAnonymous,
          notes: form.notes || null,
        }),
      });
      await goto('/contributions');
    } catch (err) {
      error = (err as Error).message;
    } finally { saving = false; }
  }

  const methods = ['cash', 'cheque', 'card', 'bank', 'other'];
</script>

<PageHeader title={tr({ en: 'Record a gift', ar: 'تسجيل عطية' }, $locale)} />

<form class="max-w-xl space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}

  <div class="card space-y-4 p-6">
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Fund', ar: 'الصندوق' }, $locale)}</span>
      <select class="input" bind:value={form.fundId} required>
        {#each funds as f}<option value={f.id}>{tr(f.name, $locale) || f.code}</option>{/each}
      </select>
    </label>

    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" bind:checked={form.isAnonymous} /> {tr({ en: 'Anonymous gift', ar: 'عطية مجهولة' }, $locale)}
    </label>

    {#if !form.isAnonymous}
      <div class="relative space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Donor', ar: 'المتبرّع' }, $locale)}</span>
        <input class="input" bind:value={personQuery} oninput={() => { personId = null; searchPeople(); }} placeholder={$t('common.search')} />
        {#if personQuery.trim() && !personId && (personResults.length || can('create person'))}
          <div class="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow dark:border-slate-700 dark:bg-slate-900">
            {#each personResults as p}
              <button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => pickPerson(p)}>
                {tr(p.givenName, $locale)} {tr(p.familyName, $locale)}
              </button>
            {/each}
            {#if can('create person')}
              <button type="button" class="block w-full border-t border-slate-100 px-3 py-2 text-start text-sm text-primary-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-800 dark:text-primary-300 dark:hover:bg-slate-800" onclick={addPersonFromQuery} disabled={creatingPerson}>
                {creatingPerson ? $t('common.loading') : `+ ${tr({ en: 'Add', ar: 'إضافة' }, $locale)} “${personQuery.trim()}” ${tr({ en: 'as a new person', ar: 'كشخص جديد' }, $locale)}`}
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <div class="grid gap-4 sm:grid-cols-2">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Amount', ar: 'المبلغ' }, $locale)}</span>
        <input class="input force-ltr" type="number" step="0.01" min="0" bind:value={form.amount} required />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Received on', ar: 'تاريخ الاستلام' }, $locale)}</span>
        <input class="input force-ltr" type="date" bind:value={form.receivedOn} required />
      </label>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Method', ar: 'الطريقة' }, $locale)}</span>
        <select class="input capitalize" bind:value={form.method}>{#each methods as m}<option value={m}>{m}</option>{/each}</select>
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Reference', ar: 'المرجع' }, $locale)}</span>
        <input class="input force-ltr" bind:value={form.reference} />
      </label>
    </div>
  </div>

  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/contributions">✕</a>
  </div>
</form>
