<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';

  let { personId }: { personId: number } = $props();

  let ministries = $state<any[]>([]);
  let selected = $state<number[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let saved = $state(false);
  const editable = can('update person');

  onMount(async () => {
    try {
      const [all, mine] = await Promise.all([
        api<{ data: any[] }>('/ministries'),
        api<{ data: any[] }>(`/people/${personId}/ministries`),
      ]);
      ministries = all.data;
      selected = mine.data.map((m) => m.id);
    } finally { loading = false; }
  });

  function toggle(mid: number) {
    saved = false;
    selected = selected.includes(mid) ? selected.filter((x) => x !== mid) : [...selected, mid];
  }

  async function save() {
    saving = true; saved = false;
    try {
      await api(`/people/${personId}/ministries`, { method: 'PUT', body: JSON.stringify({ serviceTypeIds: selected }) });
      saved = true;
    } finally { saving = false; }
  }
</script>

<div class="card space-y-3 p-6">
  <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">{tr({ en: 'Ministry roster', ar: 'الخدمات' }, $locale)}</h2>
  {#if loading}
    <p class="text-sm text-slate-400">{$t('common.loading')}</p>
  {:else if !ministries.length}
    <p class="text-sm text-slate-400">{tr({ en: 'No ministries defined yet.', ar: 'لا توجد خدمات بعد.' }, $locale)}</p>
  {:else}
    <div class="grid gap-2 sm:grid-cols-2">
      {#each ministries as m}
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.includes(m.id)} disabled={!editable} onchange={() => toggle(m.id)} />
          {tr(m.name, $locale)}
        </label>
      {/each}
    </div>
    {#if editable}
      <div class="flex items-center gap-3 pt-2">
        <button class="btn-primary" type="button" onclick={save} disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
        {#if saved}<span class="text-sm text-emerald-600 dark:text-emerald-400">✓</span>{/if}
      </div>
    {/if}
  {/if}
</div>
