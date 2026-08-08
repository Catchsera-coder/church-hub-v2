<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, LOCALES } from '$lib/i18n.js';

  let { initial = null, id = null }: { initial?: any; id?: number | null } = $props();

  let form = $state({
    name: initial?.name ?? {},
    description: initial?.description ?? {},
    ageGroup: initial?.ageGroup ?? '',
    defaultSchedule: initial?.defaultSchedule ?? '',
    parentId: initial?.parentId ? String(initial.parentId) : '',
    sortOrder: initial?.sortOrder ?? 0,
    isActive: initial?.isActive ?? true,
  });
  let error = $state('');
  let saving = $state(false);

  // Candidate parents: every other ministry, minus this one and its descendants
  // (so you can't create a cycle).
  let parentOptions = $state<any[]>([]);
  onMount(async () => {
    const all = (await api<{ data: any[] }>('/ministries')).data;
    if (id == null) { parentOptions = all; return; }
    const blocked = new Set<number>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const m of all) {
        if (m.parentId != null && blocked.has(m.parentId) && !blocked.has(m.id)) { blocked.add(m.id); grew = true; }
      }
    }
    parentOptions = all.filter((m) => !blocked.has(m.id));
  });

  const AGE_GROUPS = [
    { v: 'children', label: { en: 'Children', ar: 'أطفال' } },
    { v: 'youth', label: { en: 'Youth', ar: 'شباب' } },
    { v: 'adult', label: { en: 'Adults', ar: 'بالغون' } },
  ];

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      const body = {
        ...form,
        ageGroup: form.ageGroup || null,
        defaultSchedule: form.defaultSchedule || null,
        parentId: form.parentId === '' ? null : Number(form.parentId),
        sortOrder: Number(form.sortOrder),
      };
      if (id) await api(`/ministries/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/ministries', { method: 'POST', body: JSON.stringify(body) });
      await goto('/ministries');
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }
</script>

<form class="max-w-lg space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  <div class="card space-y-4 p-6">
    {#each LOCALES as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Name', ar: 'الاسم' }, $locale)} ({l.native})</span>
        <input class="input" dir={l.dir} bind:value={form.name[l.code]} required={l.code === 'en'} />
      </label>
    {/each}

    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Parent group (optional)', ar: 'المجموعة الأم (اختياري)' }, $locale)}</span>
      <select class="input" bind:value={form.parentId}>
        <option value="">{tr({ en: '— None (top-level) —', ar: '— بدون (مستوى أعلى) —' }, $locale)}</option>
        {#each parentOptions as p}<option value={String(p.id)}>{tr(p.name, $locale)}</option>{/each}
      </select>
      <span class="text-xs text-slate-400">{tr({ en: 'Make this a sub-ministry by choosing a parent. A ministry with sub-ministries acts as a group.', ar: 'اجعلها خدمة فرعية باختيار خدمة أم. الخدمة التي لها خدمات فرعية تعمل كمجموعة.' }, $locale)}</span>
    </label>

    {#each LOCALES as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Description', ar: 'الوصف' }, $locale)} ({l.native})</span>
        <textarea class="input" dir={l.dir} rows="2" bind:value={form.description[l.code]}></textarea>
      </label>
    {/each}
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Age group', ar: 'الفئة العمرية' }, $locale)}</span>
      <select class="input" bind:value={form.ageGroup}>
        <option value="">{tr({ en: '— Any —', ar: '— الكل —' }, $locale)}</option>
        {#each AGE_GROUPS as g}<option value={g.v}>{tr(g.label, $locale)}</option>{/each}
      </select>
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Schedule', ar: 'الجدول' }, $locale)}</span>
      <input class="input" bind:value={form.defaultSchedule} placeholder={tr({ en: 'e.g. Sundays 10:00', ar: 'مثال: الأحد 10:00' }, $locale)} />
    </label>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.isActive} /> {tr({ en: 'Active', ar: 'مُفعّل' }, $locale)}</label>
  </div>
  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/ministries">✕</a>
  </div>
</form>
