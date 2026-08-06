<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, LOCALES } from '$lib/i18n.js';

  let { initial = null, id = null }: { initial?: any; id?: number | null } = $props();

  let form = $state({
    title: initial?.title ?? {},
    summary: initial?.summary ?? {},
    speaker: initial?.speaker ?? '',
    preachedOn: initial?.preachedOn ?? new Date().toISOString().slice(0, 10),
    scriptureReference: initial?.scriptureReference ?? '',
    videoUrl: initial?.videoUrl ?? '',
    isPublished: initial?.isPublished ?? false,
  });
  let error = $state('');
  let saving = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      const body = {
        ...form,
        speaker: form.speaker || null,
        scriptureReference: form.scriptureReference || null,
        videoUrl: form.videoUrl || null,
      };
      if (id) await api(`/sermons/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/sermons', { method: 'POST', body: JSON.stringify(body) });
      await goto('/sermons');
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }
</script>

<form class="max-w-lg space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  <div class="card space-y-4 p-6">
    {#each LOCALES as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Title', ar: 'العنوان' }, $locale)} ({l.native})</span>
        <input class="input" dir={l.dir} bind:value={form.title[l.code]} required={l.code === 'en'} />
      </label>
    {/each}
    {#each LOCALES as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Summary', ar: 'الملخص' }, $locale)} ({l.native})</span>
        <textarea class="input" dir={l.dir} rows="3" bind:value={form.summary[l.code]}></textarea>
      </label>
    {/each}
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Speaker', ar: 'المتحدث' }, $locale)}</span>
        <input class="input" bind:value={form.speaker} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Date', ar: 'التاريخ' }, $locale)}</span>
        <input class="input force-ltr" type="date" bind:value={form.preachedOn} required />
      </label>
    </div>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Scripture reference', ar: 'المرجع الكتابي' }, $locale)}</span>
      <input class="input" bind:value={form.scriptureReference} placeholder={tr({ en: 'e.g. John 3:16', ar: 'مثال: يوحنا ٣:١٦' }, $locale)} />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Video URL', ar: 'رابط الفيديو' }, $locale)}</span>
      <input class="input force-ltr" type="url" bind:value={form.videoUrl} placeholder="https://" />
    </label>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.isPublished} /> {tr({ en: 'Published', ar: 'منشور' }, $locale)}</label>
  </div>
  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/sermons">✕</a>
  </div>
</form>
