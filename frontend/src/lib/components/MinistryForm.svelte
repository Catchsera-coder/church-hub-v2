<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, enabledLocales } from '$lib/i18n.js';
  import { resolveStreamLink } from '$lib/stream.js';

  let { initial = null, id = null }: { initial?: any; id?: number | null } = $props();

  let form = $state({
    name: initial?.name ?? {},
    description: initial?.description ?? {},
    ageGroup: initial?.ageGroup ?? '',
    defaultSchedule: initial?.defaultSchedule ?? '',
    streaming: initial?.streaming ?? { mode: 'manual', url: '', youtube: '' },
    parentId: initial?.parentId ? String(initial.parentId) : '',
    sortOrder: initial?.sortOrder ?? 0,
    isActive: initial?.isActive ?? true,
  });
  const resolvedLink = $derived(resolveStreamLink(form.streaming));
  let copied = $state(false);
  async function copyLink() { try { await navigator.clipboard.writeText(resolvedLink); copied = true; setTimeout(() => (copied = false), 1500); } catch { /* ignore */ } }
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
      const hasStream = form.streaming.mode === 'manual' ? form.streaming.url?.trim() : form.streaming.youtube?.trim();
      const body = {
        ...form,
        ageGroup: form.ageGroup || null,
        defaultSchedule: form.defaultSchedule || null,
        streaming: hasStream ? form.streaming : null,
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
    {#each $enabledLocales as l}
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

    {#each $enabledLocales as l}
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

  <!-- Live-stream link: manual URL or a YouTube channel whose /live always points to the current stream -->
  <div class="card space-y-3 p-6">
    <div>
      <h3 class="font-semibold">📺 {tr({ en: 'Live stream', ar: 'البث المباشر' }, $locale)}</h3>
      <p class="text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'Set a link so you can one-click send "Watch live" to members. YouTube channels resolve to the current live stream automatically — set it once.', ar: 'ضع رابطاً لترسل «شاهد البث» للأعضاء بضغطة واحدة. قنوات يوتيوب تُحلّ تلقائياً إلى البث الحالي — اضبطها مرة واحدة.' }, $locale)}</p>
    </div>
    <div class="flex gap-2">
      <button type="button" class="rounded-md border px-3 py-1.5 text-sm {form.streaming.mode === 'manual' ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={form.streaming.mode === 'manual' ? 'background: var(--brand)' : ''} onclick={() => (form.streaming.mode = 'manual')}>{tr({ en: 'Manual link', ar: 'رابط يدوي' }, $locale)}</button>
      <button type="button" class="rounded-md border px-3 py-1.5 text-sm {form.streaming.mode === 'youtube' ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={form.streaming.mode === 'youtube' ? 'background: var(--brand)' : ''} onclick={() => (form.streaming.mode = 'youtube')}>{tr({ en: 'YouTube (auto)', ar: 'يوتيوب (تلقائي)' }, $locale)}</button>
    </div>
    {#if form.streaming.mode === 'manual'}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Stream URL', ar: 'رابط البث' }, $locale)}</span>
        <input class="input force-ltr" placeholder="https://…" bind:value={form.streaming.url} />
      </label>
    {:else}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'YouTube channel handle or ID', ar: 'معرّف قناة يوتيوب' }, $locale)}</span>
        <input class="input force-ltr" placeholder="@YourChurch  ·  or UCxxxx…" bind:value={form.streaming.youtube} />
        <span class="text-xs text-slate-400">{tr({ en: 'We build the channel’s /live link, which YouTube redirects to whatever is live right now.', ar: 'نبني رابط /live للقناة، والذي يوجّهه يوتيوب إلى ما يُبث الآن.' }, $locale)}</span>
      </label>
    {/if}
    {#if resolvedLink}
      <div class="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
        <a href={resolvedLink} target="_blank" rel="noopener" class="force-ltr truncate text-sky-600 hover:underline dark:text-sky-400">{resolvedLink}</a>
        <button type="button" class="ms-auto shrink-0 text-slate-500 hover:underline" onclick={copyLink}>{copied ? tr({ en: 'Copied ✓', ar: 'تم النسخ ✓' }, $locale) : tr({ en: 'Copy', ar: 'نسخ' }, $locale)}</button>
      </div>
    {/if}
  </div>
  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/ministries">✕</a>
  </div>
</form>
