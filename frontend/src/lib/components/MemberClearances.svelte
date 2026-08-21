<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';

  // Safeguarding clearances for a person (background check / training) with expiry.
  // A children/youth ministry warns when a rostered member has no valid clearance.
  let { personId }: { personId: number } = $props();
  const editable = can('update person');

  let rows = $state<any[]>([]);
  let loading = $state(true);
  let saving = $state(false);

  const TYPES = [
    { v: 'background_check', en: 'Background check', ar: 'فحص خلفية' },
    { v: 'safeguarding_training', en: 'Safeguarding training', ar: 'تدريب حماية' },
    { v: 'other', en: 'Other', ar: 'أخرى' },
  ];
  const typeLabel = (v: string) => { const x = TYPES.find((t2) => t2.v === v); return x ? tr({ en: x.en, ar: x.ar }, $locale) : v; };
  const today = new Date().toISOString().slice(0, 10);
  const isExpired = (c: any) => c.expiresOn && c.expiresOn < today;

  async function load() {
    loading = true;
    try { rows = (await api<{ data: any[] }>(`/people/${personId}/clearances`)).data; } finally { loading = false; }
  }
  onMount(load);

  function add() { rows = [...rows, { type: 'background_check', status: 'valid', issuedOn: today, expiresOn: '', notes: '' }]; }
  function remove(i: number) { rows = rows.filter((_, idx) => idx !== i); }

  async function save() {
    saving = true;
    try {
      const clearances = rows.map((c) => ({
        type: c.type, status: c.status,
        issuedOn: c.issuedOn || null, expiresOn: c.expiresOn || null, notes: c.notes || null,
      }));
      await api(`/people/${personId}/clearances`, { method: 'PUT', body: JSON.stringify({ clearances }) });
      await load();
    } catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); } finally { saving = false; }
  }
</script>

<div class="card p-6">
  <h2 class="mb-1 font-semibold">🛡️ {tr({ en: 'Safeguarding', ar: 'الحماية' }, $locale)}</h2>
  <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Background checks & training. Required to serve with children/youth.', ar: 'فحوص الخلفية والتدريب. مطلوبة للخدمة مع الأطفال/الشباب.' }, $locale)}</p>

  {#if loading}
    <p class="text-slate-400">{$t('common.loading')}</p>
  {:else}
    {#if rows.length === 0}
      <p class="mb-3 rounded-lg bg-slate-50 px-3 py-3 text-center text-xs text-slate-500 dark:bg-slate-800/50">{tr({ en: 'No clearances on file.', ar: 'لا توجد تصاريح.' }, $locale)}</p>
    {:else}
      <div class="mb-3 space-y-3">
        {#each rows as c, i}
          <div class="rounded-lg border border-slate-200 p-3 dark:border-slate-700 {isExpired(c) ? 'border-rose-300 dark:border-rose-800' : ''}">
            {#if editable}
              <div class="grid gap-2 sm:grid-cols-2">
                <select class="input" bind:value={c.type}>{#each TYPES as tt}<option value={tt.v}>{tr({ en: tt.en, ar: tt.ar }, $locale)}</option>{/each}</select>
                <select class="input" bind:value={c.status}>
                  <option value="valid">{tr({ en: 'Valid', ar: 'ساري' }, $locale)}</option>
                  <option value="pending">{tr({ en: 'Pending', ar: 'قيد الانتظار' }, $locale)}</option>
                  <option value="expired">{tr({ en: 'Expired', ar: 'منتهٍ' }, $locale)}</option>
                </select>
                <label class="text-xs text-slate-500">{tr({ en: 'Issued', ar: 'صدر' }, $locale)}<input class="input force-ltr mt-1" type="date" bind:value={c.issuedOn} /></label>
                <label class="text-xs text-slate-500">{tr({ en: 'Expires', ar: 'ينتهي' }, $locale)}<input class="input force-ltr mt-1" type="date" bind:value={c.expiresOn} /></label>
              </div>
              <div class="mt-2 flex items-center justify-between">
                {#if isExpired(c)}<span class="text-xs text-rose-600 dark:text-rose-400">⚠️ {tr({ en: 'Expired', ar: 'منتهٍ' }, $locale)}</span>{:else}<span></span>{/if}
                <button type="button" class="text-xs text-rose-600 hover:underline" onclick={() => remove(i)}>{tr({ en: 'Remove', ar: 'إزالة' }, $locale)}</button>
              </div>
            {:else}
              <div class="flex items-center justify-between text-sm">
                <span>{typeLabel(c.type)}</span>
                <span class="text-xs {isExpired(c) ? 'text-rose-600' : 'text-slate-500'}">{c.status}{#if c.expiresOn} · {c.expiresOn}{/if}</span>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if editable}
      <div class="flex items-center gap-2">
        <button type="button" class="btn-ghost text-sm" onclick={add}>+ {tr({ en: 'Add', ar: 'إضافة' }, $locale)}</button>
        <button type="button" class="btn-primary ms-auto text-sm" onclick={save} disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
      </div>
    {/if}
  {/if}
</div>
