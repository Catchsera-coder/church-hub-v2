<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, LOCALES } from '$lib/i18n.js';

  let { initial = null, id = null }: { initial?: any; id?: number | null } = $props();

  let form = $state({
    name: initial?.name ?? '',
    channel: (initial?.channel ?? 'email') as 'email' | 'sms',
    subject: (initial?.subject ?? {}) as Record<string, string>,
    header: (initial?.header ?? {}) as Record<string, string>,
    body: (initial?.body ?? {}) as Record<string, string>,
    footer: (initial?.footer ?? {}) as Record<string, string>,
    isActive: initial?.isActive ?? true,
  });
  let error = $state('');
  let saving = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      if (id) await api(`/message-templates/${id}`, { method: 'PUT', body: JSON.stringify(form) });
      else await api('/message-templates', { method: 'POST', body: JSON.stringify(form) });
      await goto('/messages/templates');
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }
</script>

<form class="max-w-2xl space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  <div class="card space-y-4 p-6">
    <div class="grid grid-cols-2 gap-3">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Template name', ar: 'اسم القالب' }, $locale)}</span>
        <input class="input" bind:value={form.name} required placeholder={tr({ en: 'e.g. Weekly newsletter', ar: 'مثال: النشرة الأسبوعية' }, $locale)} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Channel', ar: 'القناة' }, $locale)}</span>
        <select class="input" bind:value={form.channel}>
          <option value="email">{tr({ en: 'Email', ar: 'بريد إلكتروني' }, $locale)}</option>
          <option value="sms">{tr({ en: 'SMS', ar: 'رسالة نصية' }, $locale)}</option>
        </select>
      </label>
    </div>

    {#if form.channel === 'email'}
      {#each LOCALES as l}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Subject', ar: 'الموضوع' }, $locale)} ({l.native})</span>
          <input class="input" dir={l.dir} bind:value={form.subject[l.code]} />
        </label>
      {/each}
      {#each LOCALES as l}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Branded header', ar: 'ترويسة' }, $locale)} ({l.native})</span>
          <textarea class="input" dir={l.dir} rows="2" bind:value={form.header[l.code]} placeholder={tr({ en: 'e.g. Grace and peace to you from {church}', ar: 'مثال: نعمة لكم وسلام من {church}' }, $locale)}></textarea>
        </label>
      {/each}
    {/if}

    {#each LOCALES as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Body', ar: 'النص' }, $locale)} ({l.native})</span>
        <textarea class="input" dir={l.dir} rows="5" bind:value={form.body[l.code]} required={l.code === 'en'}></textarea>
      </label>
    {/each}

    {#if form.channel === 'email'}
      {#each LOCALES as l}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Branded footer', ar: 'تذييل' }, $locale)} ({l.native})</span>
          <textarea class="input" dir={l.dir} rows="2" bind:value={form.footer[l.code]} placeholder={tr({ en: 'e.g. In Christ, the {church} team', ar: 'مثال: في المسيح، فريق {church}' }, $locale)}></textarea>
        </label>
      {/each}
    {/if}

    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.isActive} /> {tr({ en: 'Active (available when composing)', ar: 'مُفعّل (متاح عند الإنشاء)' }, $locale)}</label>
  </div>

  <p class="text-xs text-slate-500 dark:text-slate-400">
    {tr({ en: 'Templates are reused when composing a message — picking one prefills the subject and body. Header and footer are joined around the body.', ar: 'تُستخدم القوالب عند إنشاء رسالة — اختيار قالب يملأ الموضوع والنص. تُدمج الترويسة والتذييل حول النص.' }, $locale)}
  </p>

  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/messages/templates">✕</a>
  </div>
</form>
